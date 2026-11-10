import fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { config } from '../config.js';
import { chatRoutes } from './routes/chat.js';
import { threadRoutes } from './routes/threads.js';

export async function createServer() {
  const app = fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  await app.register(cookie, {
    secret: config.COOKIE_SECRET,
  });

  app.get('/api/health', async () => {
    return {
      status: 'ok',
      service: 'chronos',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    };
  });

  app.get('/api/settings', async () => {
    const hasGoogle = Boolean(
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      config.GOOGLE_GENERATIVE_AI_API_KEY
    );
    const hasOpenAI = Boolean(process.env.OPENAI_API_KEY || config.OPENAI_API_KEY);
    const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY || config.ANTHROPIC_API_KEY);
    const hasTavily = Boolean(process.env.TAVILY_API_KEY || config.TAVILY_API_KEY);

    let provider = 'mock';
    if (hasGoogle) provider = 'google';
    else if (hasOpenAI) provider = 'openai';
    else if (hasAnthropic) provider = 'anthropic';

    return {
      hasGoogle,
      hasOpenAI,
      hasAnthropic,
      hasTavily,
      activeProvider: provider,
      fastModel: config.LLM_FAST,
      mainModel: config.LLM_MAIN,
    };
  });

  app.post('/api/settings', async (request) => {
    const body = (request.body || {}) as {
      geminiKey?: string;
      openaiKey?: string;
      tavilyKey?: string;
    };

    if (body.geminiKey !== undefined) {
      const k = body.geminiKey.trim();
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = k;
      process.env.GEMINI_API_KEY = k;
    }
    if (body.openaiKey !== undefined) {
      process.env.OPENAI_API_KEY = body.openaiKey.trim();
    }
    if (body.tavilyKey !== undefined) {
      process.env.TAVILY_API_KEY = body.tavilyKey.trim();
    }

    return { success: true };
  });

  await app.register(chatRoutes);
  await app.register(threadRoutes);

  return app;
}

async function start() {
  try {
    const server = await createServer();
    await server.listen({ port: config.PORT, host: '0.0.0.0' });
    console.log(`🚀 Minimi Search server listening on http://localhost:${config.PORT}`);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Auto-run if main entry
if (process.argv[1]?.endsWith('src/server/index.ts') || process.argv[1]?.endsWith('src/server/index.js')) {
  start();
}

