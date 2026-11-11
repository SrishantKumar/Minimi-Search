import crypto from 'crypto';
import type { Client } from '@libsql/client';

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
  type: string;
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
  constructor(private readonly db: Client) {}

  async upsert(id: string, userId: string, title?: string): Promise<StoredThread> {
    const now = Date.now();
    const existing = await this.getById(id);

    if (existing) {
      const updatedTitle = title || existing.title;
      await this.db.execute({
        sql: 'UPDATE threads SET title = ?, updated_at = ? WHERE id = ?',
        args: [updatedTitle, now, id],
      });
      return { ...existing, title: updatedTitle, updatedAt: now };
    }

    const newTitle = title || 'New Conversation';
    await this.db.execute({
      sql: 'INSERT INTO threads (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      args: [id, userId, newTitle, now, now],
    });

    return {
      id,
      userId,
      title: newTitle,
      createdAt: now,
      updatedAt: now,
    };
  }

  async listByUser(userId: string): Promise<StoredThread[]> {
    const res = await this.db.execute({
      sql: 'SELECT id, user_id, title, created_at, updated_at FROM threads WHERE user_id = ? ORDER BY updated_at DESC',
      args: [userId],
    });

    return res.rows.map((r: any) => ({
      id: String(r.id),
      userId: String(r.user_id),
      title: String(r.title),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    }));
  }

  async getById(id: string): Promise<StoredThread | null> {
    const res = await this.db.execute({
      sql: 'SELECT id, user_id, title, created_at, updated_at FROM threads WHERE id = ?',
      args: [id],
    });

    if (res.rows.length === 0) return null;
    const r: any = res.rows[0];
    return {
      id: String(r.id),
      userId: String(r.user_id),
      title: String(r.title),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };
  }

  async delete(id: string): Promise<boolean> {
    await this.db.batch([
      { sql: 'DELETE FROM messages WHERE thread_id = ?', args: [id] },
      { sql: 'DELETE FROM claims WHERE thread_id = ?', args: [id] },
      { sql: 'DELETE FROM context_objects WHERE thread_id = ?', args: [id] },
      { sql: 'DELETE FROM threads WHERE id = ?', args: [id] },
    ], 'write');
    return true;
  }
}

export class TurnTraceRepository {
  constructor(private readonly db: Client) {}

  async save(turnId: string, userId: string, traceJson: Record<string, unknown>): Promise<void> {
    const now = Date.now();
    await this.db.execute({
      sql: 'INSERT OR REPLACE INTO turn_traces (turn_id, user_id, json, created_at) VALUES (?, ?, ?, ?)',
      args: [turnId, userId, JSON.stringify(traceJson), now],
    });
  }

  async getById(turnId: string): Promise<StoredTurnTrace | null> {
    const res = await this.db.execute({
      sql: 'SELECT turn_id, user_id, json, created_at FROM turn_traces WHERE turn_id = ?',
      args: [turnId],
    });

    if (res.rows.length === 0) return null;
    const r: any = res.rows[0];
    return {
      turnId: String(r.turn_id),
      userId: String(r.user_id),
      json: JSON.parse(String(r.json)),
      createdAt: Number(r.created_at),
    };
  }
}

export class MessageRepository {
  constructor(private readonly db: Client) {}

  async insert(msg: Omit<StoredMessage, 'contentHash' | 'hourBucket'>): Promise<StoredMessage> {
    const contentHash = computeContentHash(msg.content);
    const hourBucket = computeHourBucket(msg.createdAt);

    const fullMsg: StoredMessage = {
      ...msg,
      contentHash,
      hourBucket,
    };

    await this.db.batch([
      {
        sql: `INSERT INTO messages (
          id, thread_id, user_id, role, content, content_hash,
          created_at, hour_bucket, embedding_status, meta
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          fullMsg.id,
          fullMsg.threadId,
          fullMsg.userId,
          fullMsg.role,
          fullMsg.content,
          fullMsg.contentHash,
          fullMsg.createdAt,
          fullMsg.hourBucket,
          fullMsg.embeddingStatus,
          fullMsg.meta ? JSON.stringify(fullMsg.meta) : null,
        ],
      },
      {
        sql: `INSERT INTO messages_fts (rowid, content) SELECT rowid, content FROM messages WHERE id = ?`,
        args: [fullMsg.id],
      },
    ], 'write');

    return fullMsg;
  }

  async getByTimeWindow(userId: string, startMs: number, endMs: number): Promise<StoredMessage[]> {
    const startBucket = computeHourBucket(startMs);
    const endBucket = computeHourBucket(endMs);

    const res = await this.db.execute({
      sql: `SELECT id, thread_id, user_id, role, content, content_hash,
                   created_at, hour_bucket, embedding_status, meta
            FROM messages
            WHERE user_id = ?
              AND hour_bucket >= ? AND hour_bucket <= ?
              AND created_at >= ? AND created_at <= ?
            ORDER BY created_at ASC`,
      args: [userId, startBucket, endBucket, startMs, endMs],
    });

    return res.rows.map((r: any) => ({
      id: String(r.id),
      threadId: String(r.thread_id),
      userId: String(r.user_id),
      role: r.role as 'user' | 'assistant',
      content: String(r.content),
      contentHash: String(r.content_hash),
      createdAt: Number(r.created_at),
      hourBucket: Number(r.hour_bucket),
      embeddingStatus: r.embedding_status as 'pending' | 'done' | 'failed',
      meta: r.meta ? JSON.parse(String(r.meta)) : undefined,
    }));
  }

  async searchFts(userId: string, query: string, limit = 10): Promise<StoredMessage[]> {
    const sanitized = query
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .map((w) => `"${w}"*`)
      .join(' OR ');

    if (!sanitized) return [];

    try {
      const res = await this.db.execute({
        sql: `SELECT m.id, m.thread_id, m.user_id, m.role, m.content, m.content_hash,
                     m.created_at, m.hour_bucket, m.embedding_status, m.meta
              FROM messages m
              JOIN messages_fts f ON m.rowid = f.rowid
              WHERE m.user_id = ? AND messages_fts MATCH ?
              ORDER BY bm25(messages_fts)
              LIMIT ?`,
        args: [userId, sanitized, limit],
      });

      return res.rows.map((r: any) => ({
        id: String(r.id),
        threadId: String(r.thread_id),
        userId: String(r.user_id),
        role: r.role as 'user' | 'assistant',
        content: String(r.content),
        contentHash: String(r.content_hash),
        createdAt: Number(r.created_at),
        hourBucket: Number(r.hour_bucket),
        embeddingStatus: r.embedding_status as 'pending' | 'done' | 'failed',
        meta: r.meta ? JSON.parse(String(r.meta)) : undefined,
      }));
    } catch {
      return [];
    }
  }

  async getThreadMessages(threadId: string): Promise<StoredMessage[]> {
    const res = await this.db.execute({
      sql: `SELECT id, thread_id, user_id, role, content, content_hash,
                   created_at, hour_bucket, embedding_status, meta
            FROM messages
            WHERE thread_id = ?
            ORDER BY created_at ASC`,
      args: [threadId],
    });

    return res.rows.map((r: any) => ({
      id: String(r.id),
      threadId: String(r.thread_id),
      userId: String(r.user_id),
      role: r.role as 'user' | 'assistant',
      content: String(r.content),
      contentHash: String(r.content_hash),
      createdAt: Number(r.created_at),
      hourBucket: Number(r.hour_bucket),
      embeddingStatus: r.embedding_status as 'pending' | 'done' | 'failed',
      meta: r.meta ? JSON.parse(String(r.meta)) : undefined,
    }));
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.db.batch([
      { sql: 'DELETE FROM messages WHERE thread_id = ?', args: [threadId] },
      { sql: 'DELETE FROM claims WHERE thread_id = ?', args: [threadId] },
      { sql: 'DELETE FROM context_objects WHERE thread_id = ?', args: [threadId] },
      { sql: 'DELETE FROM threads WHERE id = ?', args: [threadId] },
    ], 'write');
  }
}

export class ClaimRepository {
  constructor(private readonly db: Client) {}

  async insert(claim: Omit<StoredClaim, 'contentHash' | 'hourBucket'>): Promise<StoredClaim> {
    const contentHash = computeContentHash(`${claim.subject}:${claim.attribute}:${claim.value}`);
    const hourBucket = computeHourBucket(claim.createdAt);

    const fullClaim: StoredClaim = {
      ...claim,
      contentHash,
      hourBucket,
    };

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

    await this.db.execute({
      sql: `INSERT INTO claims (
        id, user_id, thread_id, turn_id, subject, attribute, value, unit,
        as_of, volatility, status, supersedes, source_message_id, content_hash,
        evidence_urls, created_at, hour_bucket, embedding_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: vals,
    });

    return fullClaim;
  }

  async getBySubject(userId: string, subject: string): Promise<StoredClaim[]> {
    const res = await this.db.execute({
      sql: `SELECT id, user_id, thread_id, turn_id, subject, attribute, value, unit,
                   as_of, volatility, status, supersedes, source_message_id, content_hash,
                   evidence_urls, created_at, hour_bucket, embedding_status
            FROM claims
            WHERE user_id = ? AND subject LIKE ? AND status = 'active'
            ORDER BY as_of DESC`,
      args: [userId, `%${subject}%`],
    });

    return res.rows.map((r: any) => ({
      id: String(r.id),
      userId: String(r.user_id),
      threadId: String(r.thread_id),
      turnId: String(r.turn_id),
      subject: String(r.subject),
      attribute: String(r.attribute),
      value: String(r.value),
      unit: r.unit ? String(r.unit) : undefined,
      asOf: Number(r.as_of),
      volatility: r.volatility as 'static' | 'slow' | 'volatile',
      status: r.status as 'active' | 'superseded' | 'refuted',
      supersedes: r.supersedes ? String(r.supersedes) : undefined,
      sourceMessageId: String(r.source_message_id),
      contentHash: String(r.content_hash),
      evidenceUrls: JSON.parse(String(r.evidence_urls || '[]')),
      createdAt: Number(r.created_at),
      hourBucket: Number(r.hour_bucket),
      embeddingStatus: r.embedding_status as 'pending' | 'done' | 'failed',
    }));
  }

  async markSuperseded(id: string): Promise<void> {
    await this.db.execute({
      sql: "UPDATE claims SET status = 'superseded' WHERE id = ?",
      args: [id],
    });
  }

  async getVolatileClaims(olderThanMs: number, limit = 20): Promise<StoredClaim[]> {
    const res = await this.db.execute({
      sql: `SELECT id, user_id, thread_id, turn_id, subject, attribute, value, unit,
                   as_of, volatility, status, supersedes, source_message_id, content_hash,
                   evidence_urls, created_at, hour_bucket, embedding_status
            FROM claims
            WHERE status = 'active' AND volatility = 'volatile' AND as_of <= ?
            ORDER BY as_of ASC
            LIMIT ?`,
      args: [olderThanMs, limit],
    });

    return res.rows.map((r: any) => ({
      id: String(r.id),
      userId: String(r.user_id),
      threadId: String(r.thread_id),
      turnId: String(r.turn_id),
      subject: String(r.subject),
      attribute: String(r.attribute),
      value: String(r.value),
      unit: r.unit ? String(r.unit) : undefined,
      asOf: Number(r.as_of),
      volatility: r.volatility as 'static' | 'slow' | 'volatile',
      status: r.status as 'active' | 'superseded' | 'refuted',
      supersedes: r.supersedes ? String(r.supersedes) : undefined,
      sourceMessageId: String(r.source_message_id),
      contentHash: String(r.content_hash),
      evidenceUrls: JSON.parse(String(r.evidence_urls || '[]')),
      createdAt: Number(r.created_at),
      hourBucket: Number(r.hour_bucket),
      embeddingStatus: r.embedding_status as 'pending' | 'done' | 'failed',
    }));
  }
}

export class ContextObjectRepository {
  constructor(private readonly db: Client) {}

  async insert(obj: Omit<StoredContextObject, 'contentHash' | 'hourBucket'>): Promise<StoredContextObject> {
    const contentHash = computeContentHash(`${obj.type}:${obj.label}:${obj.members.join(',')}`);
    const hourBucket = computeHourBucket(obj.createdAt);

    const fullObj: StoredContextObject = {
      ...obj,
      contentHash,
      hourBucket,
    };

    await this.db.execute({
      sql: `INSERT INTO context_objects (
        id, user_id, thread_id, type, label, members, attributes,
        created_at, hour_bucket, source_message_id, content_hash, embedding_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
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
        fullObj.embeddingStatus,
      ],
    });

    return fullObj;
  }

  async getByType(userId: string, type: string): Promise<StoredContextObject[]> {
    const res = await this.db.execute({
      sql: `SELECT id, user_id, thread_id, type, label, members, attributes,
                   created_at, hour_bucket, source_message_id, content_hash, embedding_status
            FROM context_objects
            WHERE user_id = ? AND type = ?
            ORDER BY created_at DESC`,
      args: [userId, type],
    });

    return res.rows.map((r: any) => ({
      id: String(r.id),
      userId: String(r.user_id),
      threadId: String(r.thread_id),
      type: String(r.type),
      label: String(r.label),
      members: JSON.parse(String(r.members || '[]')),
      attributes: r.attributes ? JSON.parse(String(r.attributes)) : undefined,
      createdAt: Number(r.created_at),
      hourBucket: Number(r.hour_bucket),
      sourceMessageId: String(r.source_message_id),
      contentHash: String(r.content_hash),
      embeddingStatus: r.embedding_status as 'pending' | 'done' | 'failed',
    }));
  }
}
