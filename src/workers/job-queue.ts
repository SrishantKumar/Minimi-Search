import { ulid } from 'ulidx';
import type Database from 'better-sqlite3';

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
  getPendingCount(): number;
}

export class SqliteJobQueue implements JobQueue {
  private readonly insertStmt: Database.Statement;
  private readonly selectNextStmt: Database.Statement;
  private readonly markRunningStmt: Database.Statement;
  private readonly markDoneStmt: Database.Statement;
  private readonly markFailedStmt: Database.Statement;
  private readonly countPendingStmt: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO jobs (id, kind, payload, status, attempts, created_at, updated_at)
      VALUES (?, ?, ?, 'queued', 0, ?, ?)
    `);

    this.selectNextStmt = db.prepare(`
      SELECT id, kind, payload, status, attempts, last_error, created_at, updated_at
      FROM jobs
      WHERE status = 'queued' OR (status = 'failed' AND attempts < 3)
      ORDER BY created_at ASC
      LIMIT 1
    `);

    this.markRunningStmt = db.prepare(`
      UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ?
      WHERE id = ?
    `);

    this.markDoneStmt = db.prepare(`
      UPDATE jobs SET status = 'done', updated_at = ?
      WHERE id = ?
    `);

    this.markFailedStmt = db.prepare(`
      UPDATE jobs SET status = 'failed', last_error = ?, updated_at = ?
      WHERE id = ?
    `);

    this.countPendingStmt = db.prepare(`
      SELECT COUNT(*) as count FROM jobs WHERE status IN ('queued', 'running')
    `);
  }

  async enqueue(kind: JobKind, payload: Record<string, unknown>): Promise<string> {
    const id = `job_${ulid()}`;
    const now = Date.now();
    this.insertStmt.run(id, kind, JSON.stringify(payload), now, now);
    return id;
  }

  async processNext(handler: (job: StoredJob) => Promise<void>): Promise<boolean> {
    const row = this.selectNextStmt.get() as
      | {
          id: string;
          kind: JobKind;
          payload: string;
          status: 'queued' | 'running' | 'done' | 'failed';
          attempts: number;
          last_error: string | null;
          created_at: number;
          updated_at: number;
        }
      | undefined;

    if (!row) return false;

    const job: StoredJob = {
      id: row.id,
      kind: row.kind,
      payload: JSON.parse(row.payload),
      status: row.status,
      attempts: row.attempts,
      lastError: row.last_error || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    const now = Date.now();
    this.markRunningStmt.run(now, job.id);

    try {
      await handler(job);
      this.markDoneStmt.run(Date.now(), job.id);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.markFailedStmt.run(msg, Date.now(), job.id);
      return false;
    }
  }

  getPendingCount(): number {
    const res = this.countPendingStmt.get() as { count: number };
    return res.count;
  }
}

