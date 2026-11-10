import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(8787),
  DATABASE_PATH: z.string().default('./data/chronos.db'),
  COOKIE_SECRET: z.string().min(16).default('chronos-dev-secret-key-32-chars-min'),
  DEFAULT_TZ: z.string().default('UTC'),
  LOG_LEVEL: z.string().default('info'),
  WORKER_POOL_SIZE: z.coerce.number().default(2),

  // Search
  TAVILY_API_KEY: z.string().optional(),
  EXA_API_KEY: z.string().optional(),
  BRAVE_API_KEY: z.string().optional(),
  SEARCH_PROVIDER_ORDER: z.string().default('tavily,exa'),
  SEARCH_CACHE_TTL_VOLATILE_MIN: z.coerce.number().default(360),
  EVAL_SEARCH_MODE: z.enum(['record', 'replay', 'live']).default('replay'),

  // LLM Models
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  LLM_FAST: z.string().default('google:gemini-3.1-flash-lite'),
  LLM_MAIN: z.string().default('google:gemini-3.5-flash-lite'),
  LLM_FALLBACK: z.string().default('google:gemini-3.1-flash-lite'),
  EMBEDDING_MODEL: z.string().default('google:text-embedding-004'),
  EMBEDDING_DIM: z.coerce.number().default(768),
});

export type Config = z.infer<typeof envSchema>;

function loadConfig(): Config {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment configuration:', result.error.format());
    throw new Error('Environment variable validation failed');
  }
  return result.data;
}

export const config = loadConfig();

