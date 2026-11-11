import { createClient, type Client } from '@libsql/client';
import path from 'path';
import fs from 'fs';
import { config } from '../../config.js';

export async function createDatabase(customPath?: string): Promise<Client> {
  let url: string;
  let authToken: string | undefined = undefined;

  if (customPath) {
    url = customPath === ':memory:' ? 'file::memory:' : (customPath.startsWith('file:') ? customPath : `file:${customPath}`);
  } else if (config.TURSO_DATABASE_URL) {
    url = config.TURSO_DATABASE_URL;
    authToken = config.TURSO_AUTH_TOKEN;
  } else {
    const dbPath = config.DATABASE_PATH;
    if (dbPath === ':memory:') {
      url = 'file::memory:';
    } else {
      const resolved = dbPath.startsWith('file:') ? dbPath.slice(5) : dbPath;
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      url = `file:${resolved}`;
    }
  }

  const client = createClient({ url, authToken });
  await initSchema(client);
  return client;
}

export async function initSchema(client: Client): Promise<void> {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      tz TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      hour_bucket INTEGER NOT NULL,
      embedding_status TEXT DEFAULT 'pending',
      meta TEXT
    );

    CREATE INDEX IF NOT EXISTS msg_user_bucket ON messages(user_id, hour_bucket);
    CREATE INDEX IF NOT EXISTS msg_user_time   ON messages(user_id, created_at);

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      content='messages',
      content_rowid='rowid'
    );

    CREATE TABLE IF NOT EXISTS message_embeddings (
      message_id TEXT PRIMARY KEY,
      dim INTEGER NOT NULL,
      vec BLOB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      attribute TEXT NOT NULL,
      value TEXT NOT NULL,
      unit TEXT,
      as_of INTEGER NOT NULL,
      volatility TEXT NOT NULL,
      status TEXT NOT NULL,
      supersedes TEXT,
      source_message_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      evidence_urls TEXT,
      created_at INTEGER NOT NULL,
      hour_bucket INTEGER NOT NULL,
      embedding_status TEXT DEFAULT 'pending'
    );

    CREATE INDEX IF NOT EXISTS claims_user_subject ON claims(user_id, subject);

    CREATE TABLE IF NOT EXISTS context_objects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      members TEXT NOT NULL,
      attributes TEXT,
      created_at INTEGER NOT NULL,
      hour_bucket INTEGER NOT NULL,
      source_message_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      embedding_status TEXT DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS search_cache (
      key TEXT PRIMARY KEY,
      response TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS turn_traces (
      turn_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}
