import { ulid } from 'ulidx';
import type { Client } from '@libsql/client';

export type JobKind = 'extract_claims' | 'extract_objects' | 'embed';

export interface StoredJob {
  id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  status: 'queued' | 'running' | 'done' | 'failed';
  attempts: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface JobQueue {
  enqueue(kind: JobKind, payload: Record<string, unknown>): Promise<string>;
  processNext(handler: (job: StoredJob) => Promise<void>): Promise<boolean>;
  getPendingCount(): Promise<number>;
}

export class SqliteJobQueue implements JobQueue {
  constructor(private readonly db: Client) {}

  async enqueue(kind: JobKind, payload: Record<string, unknown>): Promise<string> {
    const id = `job_${ulid()}`;
    const now = Date.now();
    await this.db.execute({
      sql: `INSERT INTO jobs (id, kind, payload, status, attempts, created_at, updated_at)
            VALUES (?, ?, ?, 'queued', 0, ?, ?)`,
      args: [id, kind, JSON.stringify(payload), now, now],
    });
    return id;
  }

  async processNext(handler: (job: StoredJob) => Promise<void>): Promise<boolean> {
    const res = await this.db.execute(`
      SELECT id, kind, payload, status, attempts, last_error, created_at, updated_at
      FROM jobs
      WHERE status = 'queued' OR (status = 'failed' AND attempts < 3)
      ORDER BY created_at ASC
      LIMIT 1
    `);

    if (res.rows.length === 0) return false;
    const row: any = res.rows[0];

    const job: StoredJob = {
      id: String(row.id),
      kind: row.kind as JobKind,
      payload: JSON.parse(String(row.payload)),
      status: row.status as 'queued' | 'running' | 'done' | 'failed',
      attempts: Number(row.attempts),
      lastError: row.last_error ? String(row.last_error) : undefined,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };

    const now = Date.now();
    await this.db.execute({
      sql: 'UPDATE jobs SET status = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?',
      args: ['running', now, job.id],
    });

    try {
      await handler(job);
      await this.db.execute({
        sql: 'UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?',
        args: ['done', Date.now(), job.id],
      });
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.db.execute({
        sql: 'UPDATE jobs SET status = ?, last_error = ?, updated_at = ? WHERE id = ?',
        args: ['failed', msg, Date.now(), job.id],
      });
      return false;
    }
  }

  async getPendingCount(): Promise<number> {
    const res = await this.db.execute("SELECT COUNT(*) as count FROM jobs WHERE status IN ('queued', 'running')");
    if (res.rows.length === 0) return 0;
    return Number((res.rows[0] as any).count);
  }
}
