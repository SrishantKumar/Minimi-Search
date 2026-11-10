import type { FastifyPluginAsync } from 'fastify';
import { ulid } from 'ulidx';
import { createDatabase } from '../../memory/store/db.js';
import {
  ThreadRepository,
  MessageRepository,
  TurnTraceRepository,
} from '../../memory/store/repository.js';

export const threadRoutes: FastifyPluginAsync = async (fastify) => {
  const db = createDatabase();
  const threadRepo = new ThreadRepository(db);
  const messageRepo = new MessageRepository(db);
  const traceRepo = new TurnTraceRepository(db);

  // List threads for user
  fastify.get('/api/threads', async (request, reply) => {
    let userId = request.cookies.chronos_uid;
    if (!userId) {
      userId = `u_${ulid()}`;
      reply.raw.setHeader('Set-Cookie', `chronos_uid=${userId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
    }
    const threads = threadRepo.listByUser(userId);
    return { threads };
  });

  // Get specific thread with messages
  fastify.get<{ Params: { id: string } }>('/api/threads/:id', async (request, reply) => {
    const thread = threadRepo.getById(request.params.id);
    if (!thread) {
      return reply.status(404).send({ error: 'Thread not found' });
    }
    const messages = messageRepo.getThreadMessages(request.params.id);
    return {
      thread,
      messages,
    };
  });

  // Delete thread
  fastify.delete<{ Params: { id: string } }>('/api/threads/:id', async (request, reply) => {
    const success = threadRepo.delete(request.params.id);
    if (!success) {
      return reply.status(404).send({ error: 'Thread not found' });
    }
    return { success: true };
  });

  // Dev trace inspection endpoint
  fastify.get<{ Params: { turnId: string } }>('/api/trace/:turnId', async (request, reply) => {
    const trace = traceRepo.getById(request.params.turnId);
    if (!trace) {
      return reply.status(404).send({ error: 'Turn trace not found' });
    }
    return { trace };
  });
};
