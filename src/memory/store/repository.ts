import crypto from 'crypto';
import type Database from 'better-sqlite3';

export interface StoredMessage {
  id: string;
  threadId: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  contentHash: string;
  createdAt: number;
  hourBucket: number;
  embeddingStatus: 'pending' | 'done' | 'failed';
  meta?: Record<string, unknown>;
}

export interface StoredClaim {
  id: string;
  userId: string;
  threadId: string;
  turnId: string;
  subject: string;
  attribute: string;
  value: string;
  unit?: string;
  asOf: number;
  volatility: 'static' | 'slow' | 'volatile';
  status: 'active' | 'superseded' | 'refuted';
  supersedes?: string;
  sourceMessageId: string;
  contentHash: string;
  evidenceUrls: string[];
  createdAt: number;
  hourBucket: number;
  embeddingStatus: 'pending' | 'done' | 'failed';
}

export interface StoredContextObject {
  id: string;
  userId: string;
  threadId: string;
  type: string; // 'shortlist' | 'constraint' | 'topic' | 'preference'
  label: string;
  members: string[];
  attributes?: Record<string, unknown>;
  createdAt: number;
  hourBucket: number;
  sourceMessageId: string;
  contentHash: string;
  embeddingStatus: 'pending' | 'done' | 'failed';
}

export interface StoredThread {
  id: string;
  userId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoredTurnTrace {
  turnId: string;
  userId: string;
  json: Record<string, unknown>;
  createdAt: number;
}

export function computeContentHash(text: string): string {
  return crypto.createHash('sha256').update(text.trim()).digest('hex');
}

export function computeHourBucket(timestampMs: number): number {
  return Math.floor(timestampMs / (3600 * 1000));
}

export class ThreadRepository {
  constructor(private readonly db: Database.Database) {}

  upsert(id: string, userId: string, title?: string): StoredThread {
    const now = Date.now();
    const existing = this.getById(id);

    if (existing) {
      const updatedTitle = title || existing.title;
      this.db
        .prepare('UPDATE threads SET title = ?, updated_at = ? WHERE id = ?')
        .run(updatedTitle, now, id);
      return { ...existing, title: updatedTitle, updatedAt: now };
    }

    const newTitle = title || 'New Conversation';
    this.db
      .prepare(
        'INSERT INTO threads (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(id, userId, newTitle, now, now);

    return {
      id,
      userId,
      title: newTitle,
      createdAt: now,
      updatedAt: now,
    };
  }

  listByUser(userId: string): StoredThread[] {
    const stmt = this.db.prepare(
      'SELECT id, user_id, title, created_at, updated_at FROM threads WHERE user_id = ? ORDER BY updated_at DESC'
    );
    const rows = stmt.all(userId) as Array<{
      id: string;
      user_id: string;
      title: string;
      created_at: number;
      updated_at: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      title: r.title,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  getById(id: string): StoredThread | null {
    const stmt = this.db.prepare(
      'SELECT id, user_id, title, created_at, updated_at FROM threads WHERE id = ?'
    );
    const row = stmt.get(id) as
      | {
          id: string;
          user_id: string;
          title: string;
          created_at: number;
          updated_at: number;
        }
      | undefined;

    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  delete(id: string): boolean {
    this.db.prepare('DELETE FROM messages WHERE thread_id = ?').run(id);
    this.db.prepare('DELETE FROM claims WHERE thread_id = ?').run(id);
    this.db.prepare('DELETE FROM context_objects WHERE thread_id = ?').run(id);
    const res = this.db.prepare('DELETE FROM threads WHERE id = ?').run(id);
    return res.changes > 0;
  }
}

export class TurnTraceRepository {
  constructor(private readonly db: Database.Database) {}

  save(turnId: string, userId: string, traceJson: Record<string, unknown>): void {
    const now = Date.now();
    this.db
      .prepare('INSERT OR REPLACE INTO turn_traces (turn_id, user_id, json, created_at) VALUES (?, ?, ?, ?)')
      .run(turnId, userId, JSON.stringify(traceJson), now);
  }

  getById(turnId: string): StoredTurnTrace | null {
    const row = this.db
      .prepare('SELECT turn_id, user_id, json, created_at FROM turn_traces WHERE turn_id = ?')
      .get(turnId) as { turn_id: string; user_id: string; json: string; created_at: number } | undefined;

    if (!row) return null;
    return {
      turnId: row.turn_id,
      userId: row.user_id,
      json: JSON.parse(row.json),
      createdAt: row.created_at,
    };
  }
}

export class MessageRepository {
  constructor(private readonly db: Database.Database) {}

  insert(msg: Omit<StoredMessage, 'contentHash' | 'hourBucket'>): StoredMessage {
    const contentHash = computeContentHash(msg.content);
    const hourBucket = computeHourBucket(msg.createdAt);

    const fullMsg: StoredMessage = {
      ...msg,
      contentHash,
      hourBucket,
    };

    const stmt = this.db.prepare(`
      INSERT INTO messages (
        id, thread_id, user_id, role, content, content_hash,
        created_at, hour_bucket, embedding_status, meta
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      fullMsg.id,
      fullMsg.threadId,
      fullMsg.userId,
      fullMsg.role,
      fullMsg.content,
      fullMsg.contentHash,
      fullMsg.createdAt,
      fullMsg.hourBucket,
      fullMsg.embeddingStatus,
      fullMsg.meta ? JSON.stringify(fullMsg.meta) : null
    );

    // Keep FTS updated
    const ftsStmt = this.db.prepare(`
      INSERT INTO messages_fts (rowid, content)
      SELECT rowid, content FROM messages WHERE id = ?
    `);
    ftsStmt.run(fullMsg.id);

    return fullMsg;
  }

  getByTimeWindow(userId: string, startMs: number, endMs: number): StoredMessage[] {
    const startBucket = computeHourBucket(startMs);
    const endBucket = computeHourBucket(endMs);

    // Step 1: Bucket-pruned scan
    // Step 2: Exact timestamp filter
    const stmt = this.db.prepare(`
      SELECT id, thread_id, user_id, role, content, content_hash,
             created_at, hour_bucket, embedding_status, meta
      FROM messages
      WHERE user_id = ?
        AND hour_bucket >= ? AND hour_bucket <= ?
        AND created_at >= ? AND created_at <= ?
      ORDER BY created_at ASC
    `);

    const rows = stmt.all(userId, startBucket, endBucket, startMs, endMs) as Array<{
      id: string;
      thread_id: string;
      user_id: string;
      role: 'user' | 'assistant';
      content: string;
      content_hash: string;
      created_at: number;
      hour_bucket: number;
      embedding_status: 'pending' | 'done' | 'failed';
      meta: string | null;
    }>;

    return rows.map((r) => ({
      id: r.id,
      threadId: r.thread_id,
      userId: r.user_id,
      role: r.role,
      content: r.content,
      contentHash: r.content_hash,
      createdAt: r.created_at,
      hourBucket: r.hour_bucket,
      embeddingStatus: r.embedding_status,
      meta: r.meta ? JSON.parse(r.meta) : undefined,
    }));
  }

  searchFts(userId: string, query: string, limit = 10): StoredMessage[] {
    const sanitized = query
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .map((w) => `"${w}"*`)
      .join(' OR ');

    if (!sanitized) return [];

    const stmt = this.db.prepare(`
      SELECT m.id, m.thread_id, m.user_id, m.role, m.content, m.content_hash,
             m.created_at, m.hour_bucket, m.embedding_status, m.meta
      FROM messages m
      JOIN messages_fts f ON m.rowid = f.rowid
      WHERE m.user_id = ? AND messages_fts MATCH ?
      ORDER BY bm25(messages_fts)
      LIMIT ?
    `);

    try {
      const rows = stmt.all(userId, sanitized, limit) as Array<{
        id: string;
        thread_id: string;
        user_id: string;
        role: 'user' | 'assistant';
        content: string;
        content_hash: string;
        created_at: number;
        hour_bucket: number;
        embedding_status: 'pending' | 'done' | 'failed';
        meta: string | null;
      }>;

      return rows.map((r) => ({
        id: r.id,
        threadId: r.thread_id,
        userId: r.user_id,
        role: r.role,
        content: r.content,
        contentHash: r.content_hash,
        createdAt: r.created_at,
        hourBucket: r.hour_bucket,
        embeddingStatus: r.embedding_status,
        meta: r.meta ? JSON.parse(r.meta) : undefined,
      }));
    } catch {
      return [];
    }
  }

  getThreadMessages(threadId: string): StoredMessage[] {
    const stmt = this.db.prepare(`
      SELECT id, thread_id, user_id, role, content, content_hash,
             created_at, hour_bucket, embedding_status, meta
      FROM messages
      WHERE thread_id = ?
      ORDER BY created_at ASC
    `);

    const rows = stmt.all(threadId) as Array<{
      id: string;
      thread_id: string;
      user_id: string;
      role: 'user' | 'assistant';
      content: string;
      content_hash: string;
      created_at: number;
      hour_bucket: number;
      embedding_status: 'pending' | 'done' | 'failed';
      meta: string | null;
    }>;

    return rows.map((r) => ({
      id: r.id,
      threadId: r.thread_id,
      userId: r.user_id,
      role: r.role,
      content: r.content,
      contentHash: r.content_hash,
      createdAt: r.created_at,
      hourBucket: r.hour_bucket,
      embeddingStatus: r.embedding_status,
      meta: r.meta ? JSON.parse(r.meta) : undefined,
    }));
  }

  deleteThread(threadId: string): void {
    this.db.prepare('DELETE FROM messages WHERE thread_id = ?').run(threadId);
    this.db.prepare('DELETE FROM claims WHERE thread_id = ?').run(threadId);
    this.db.prepare('DELETE FROM context_objects WHERE thread_id = ?').run(threadId);
    this.db.prepare('DELETE FROM threads WHERE id = ?').run(threadId);
  }
}

export class ClaimRepository {
  constructor(private readonly db: Database.Database) {}

  insert(claim: Omit<StoredClaim, 'contentHash' | 'hourBucket'>): StoredClaim {
    const contentHash = computeContentHash(`${claim.subject}:${claim.attribute}:${claim.value}`);
    const hourBucket = computeHourBucket(claim.createdAt);

    const fullClaim: StoredClaim = {
      ...claim,
      contentHash,
      hourBucket,
    };

    const stmt = this.db.prepare(`
      INSERT INTO claims (
        id, user_id, thread_id, turn_id, subject, attribute, value, unit,
        as_of, volatility, status, supersedes, source_message_id, content_hash,
        evidence_urls, created_at, hour_bucket, embedding_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const asOfMs =
      typeof fullClaim.asOf === 'number'
        ? fullClaim.asOf
        : typeof (fullClaim.asOf as any)?.toMillis === 'function'
          ? (fullClaim.asOf as any).toMillis()
          : new Date(fullClaim.asOf).getTime();

    const vals = [
      fullClaim.id,
      fullClaim.userId,
      fullClaim.threadId,
      fullClaim.turnId,
      fullClaim.subject,
      fullClaim.attribute,
      fullClaim.value,
      fullClaim.unit || null,
      asOfMs,
      fullClaim.volatility,
      fullClaim.status,
      fullClaim.supersedes || null,
      fullClaim.sourceMessageId || null,
      fullClaim.contentHash,
      JSON.stringify(fullClaim.evidenceUrls || []),
      fullClaim.createdAt,
      fullClaim.hourBucket,
      fullClaim.embeddingStatus,
    ];

    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      const type = typeof v;
      if (v !== null && type !== 'number' && type !== 'string' && type !== 'bigint' && !Buffer.isBuffer(v)) {
        throw new Error(`Claim insert parameter at index ${i} has invalid type ${type}: ${JSON.stringify(v)}`);
      }
    }

    stmt.run(...vals);

    return fullClaim;
  }

  getBySubject(userId: string, subject: string): StoredClaim[] {
    const stmt = this.db.prepare(`
      SELECT id, user_id, thread_id, turn_id, subject, attribute, value, unit,
             as_of, volatility, status, supersedes, source_message_id, content_hash,
             evidence_urls, created_at, hour_bucket, embedding_status
      FROM claims
      WHERE user_id = ? AND subject LIKE ? AND status = 'active'
      ORDER BY as_of DESC
    `);

    const rows = stmt.all(userId, `%${subject}%`) as Array<{
      id: string;
      user_id: string;
      thread_id: string;
      turn_id: string;
      subject: string;
      attribute: string;
      value: string;
      unit: string | null;
      as_of: number;
      volatility: 'static' | 'slow' | 'volatile';
      status: 'active' | 'superseded' | 'refuted';
      supersedes: string | null;
      source_message_id: string;
      content_hash: string;
      evidence_urls: string;
      created_at: number;
      hour_bucket: number;
      embedding_status: 'pending' | 'done' | 'failed';
    }>;

    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      threadId: r.thread_id,
      turnId: r.turn_id,
      subject: r.subject,
      attribute: r.attribute,
      value: r.value,
      unit: r.unit || undefined,
      asOf: r.as_of,
      volatility: r.volatility,
      status: r.status,
      supersedes: r.supersedes || undefined,
      sourceMessageId: r.source_message_id,
      contentHash: r.content_hash,
      evidenceUrls: JSON.parse(r.evidence_urls || '[]'),
      createdAt: r.created_at,
      hourBucket: r.hour_bucket,
      embeddingStatus: r.embedding_status,
    }));
  }

  markSuperseded(id: string): void {
    this.db.prepare("UPDATE claims SET status = 'superseded' WHERE id = ?").run(id);
  }

  getVolatileClaims(olderThanMs: number, limit = 20): StoredClaim[] {
    const stmt = this.db.prepare(`
      SELECT id, user_id, thread_id, turn_id, subject, attribute, value, unit,
             as_of, volatility, status, supersedes, source_message_id, content_hash,
             evidence_urls, created_at, hour_bucket, embedding_status
      FROM claims
      WHERE status = 'active' AND volatility = 'volatile' AND as_of <= ?
      ORDER BY as_of ASC
      LIMIT ?
    `);

    const rows = stmt.all(olderThanMs, limit) as Array<{
      id: string;
      user_id: string;
      thread_id: string;
      turn_id: string;
      subject: string;
      attribute: string;
      value: string;
      unit: string | null;
      as_of: number;
      volatility: 'static' | 'slow' | 'volatile';
      status: 'active' | 'superseded' | 'refuted';
      supersedes: string | null;
      source_message_id: string;
      content_hash: string;
      evidence_urls: string;
      created_at: number;
      hour_bucket: number;
      embedding_status: 'pending' | 'done' | 'failed';
    }>;

    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      threadId: r.thread_id,
      turnId: r.turn_id,
      subject: r.subject,
      attribute: r.attribute,
      value: r.value,
      unit: r.unit || undefined,
      asOf: r.as_of,
      volatility: r.volatility,
      status: r.status,
      supersedes: r.supersedes || undefined,
      sourceMessageId: r.source_message_id,
      contentHash: r.content_hash,
      evidenceUrls: JSON.parse(r.evidence_urls || '[]'),
      createdAt: r.created_at,
      hourBucket: r.hour_bucket,
      embeddingStatus: r.embedding_status,
    }));
  }
}

export class ContextObjectRepository {
  constructor(private readonly db: Database.Database) {}

  insert(obj: Omit<StoredContextObject, 'contentHash' | 'hourBucket'>): StoredContextObject {
    const contentHash = computeContentHash(`${obj.type}:${obj.label}:${obj.members.join(',')}`);
    const hourBucket = computeHourBucket(obj.createdAt);

    const fullObj: StoredContextObject = {
      ...obj,
      contentHash,
      hourBucket,
    };

    const stmt = this.db.prepare(`
      INSERT INTO context_objects (
        id, user_id, thread_id, type, label, members, attributes,
        created_at, hour_bucket, source_message_id, content_hash, embedding_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      fullObj.id,
      fullObj.userId,
      fullObj.threadId,
      fullObj.type,
      fullObj.label,
      JSON.stringify(fullObj.members),
      fullObj.attributes ? JSON.stringify(fullObj.attributes) : null,
      fullObj.createdAt,
      fullObj.hourBucket,
      fullObj.sourceMessageId,
      fullObj.contentHash,
      fullObj.embeddingStatus
    );

    return fullObj;
  }

  getByType(userId: string, type: string): StoredContextObject[] {
    const stmt = this.db.prepare(`
      SELECT id, user_id, thread_id, type, label, members, attributes,
             created_at, hour_bucket, source_message_id, content_hash, embedding_status
      FROM context_objects
      WHERE user_id = ? AND type = ?
      ORDER BY created_at DESC
    `);

    const rows = stmt.all(userId, type) as Array<{
      id: string;
      user_id: string;
      thread_id: string;
      type: string;
      label: string;
      members: string;
      attributes: string | null;
      created_at: number;
      hour_bucket: number;
      source_message_id: string;
      content_hash: string;
      embedding_status: 'pending' | 'done' | 'failed';
    }>;

    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      threadId: r.thread_id,
      type: r.type,
      label: r.label,
      members: JSON.parse(r.members || '[]'),
      attributes: r.attributes ? JSON.parse(r.attributes) : undefined,
      createdAt: r.created_at,
      hourBucket: r.hour_bucket,
      sourceMessageId: r.source_message_id,
      contentHash: r.content_hash,
      embeddingStatus: r.embedding_status,
    }));
  }
}
