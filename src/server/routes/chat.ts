import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ulid } from 'ulidx';
import { createSSEWriter } from '../sse.js';
import { SystemClock } from '../../time/clock.js';
import { TemporalResolver } from '../../time/resolver.js';
import { createDatabase } from '../../memory/store/db.js';
import {
  ThreadRepository,
  MessageRepository,
  ClaimRepository,
  ContextObjectRepository,
  TurnTraceRepository,
} from '../../memory/store/repository.js';
import { SqliteBlobVectorIndex } from '../../memory/store/vector-index.js';
import { RecallEngine } from '../../memory/recall.js';
import { SearchGateway } from '../../search/gateway.js';
import { TavilySearchProvider } from '../../search/providers/tavily.js';
import { MockSearchProvider } from '../../search/providers/mock.js';
import { LLMGateway } from '../../llm/gateway.js';
import { TurnOrchestrator } from '../../core/orchestrator.js';
import { config } from '../../config.js';

const chatRequestSchema = z.object({
  threadId: z.string().optional(),
  message: z.string().min(1).max(8192),
  tz: z.string().default('UTC'),
  clientNow: z.string().optional(),
});

export const chatRoutes: FastifyPluginAsync = async (fastify) => {
  const clock = new SystemClock();
  const resolver = new TemporalResolver();

  // Storage and repositories
  const db = createDatabase();
  const threadRepo = new ThreadRepository(db);
  const messageRepo = new MessageRepository(db);
  const claimRepo = new ClaimRepository(db);
  const objectRepo = new ContextObjectRepository(db);
  const traceRepo = new TurnTraceRepository(db);
  const vectorIndex = new SqliteBlobVectorIndex(db);

  // Recall Engine
  const recallEngine = new RecallEngine(messageRepo, claimRepo, objectRepo, vectorIndex);

  // Search Gateway
  const searchProviders = [];
  if (config.TAVILY_API_KEY) {
    searchProviders.push(new TavilySearchProvider(config.TAVILY_API_KEY));
  }
  searchProviders.push(new MockSearchProvider());
  const searchGateway = new SearchGateway(searchProviders, config.SEARCH_CACHE_TTL_VOLATILE_MIN);

  // LLM Gateway
  const llmGateway = new LLMGateway();

  // Orchestrator
  const orchestrator = new TurnOrchestrator({
    clock,
    resolver,
    recallEngine,
    searchGateway,
    llmGateway,
    messageRepo,
    objectRepo,
  });

  fastify.post('/api/chat', async (request, reply) => {
    const parseResult = chatRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid request body',
        details: parseResult.error.format(),
      });
    }

    // Anonymous user session from signed cookie or generated ULID
    let userId = request.cookies.chronos_uid;
    if (!userId) {
      userId = `u_${ulid()}`;
      reply.raw.setHeader('Set-Cookie', `chronos_uid=${userId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
    }

    const { message, tz, threadId: requestedThreadId } = parseResult.data;
    const threadId = requestedThreadId || `th_${ulid()}`;

    // Register / update thread in SQLite
    const titleSnippet = message.slice(0, 40) + (message.length > 40 ? '...' : '');
    threadRepo.upsert(threadId, userId, titleSnippet);

    // Hijack response for SSE
    reply.hijack();
    const sse = createSSEWriter(request, reply);

    try {
      await orchestrator.runTurn(
        {
          userId,
          threadId,
          message,
          tz,
        },
        sse
      );
    } finally {
      sse.close();
    }
  });
};
