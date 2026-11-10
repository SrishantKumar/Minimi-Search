import type { JobQueue, StoredJob } from './job-queue.js';

export interface WorkerPoolConfig {
  concurrency?: number;
  pollIntervalMs?: number;
}

export class WorkerPool {
  private isRunning = false;
  private activeJobs = 0;
  private readonly concurrency: number;
  private readonly pollIntervalMs: number;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly queue: JobQueue,
    private readonly handler: (job: StoredJob) => Promise<void>,
    config?: WorkerPoolConfig
  ) {
    this.concurrency = config?.concurrency ?? 2;
    this.pollIntervalMs = config?.pollIntervalMs ?? 500;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.scheduleNextTick();
  }

  private scheduleNextTick(): void {
    if (!this.isRunning) return;
    this.pollTimer = setTimeout(async () => {
      await this.pump();
      this.scheduleNextTick();
    }, this.pollIntervalMs);
  }

  private async pump(): Promise<void> {
    while (this.isRunning && this.activeJobs < this.concurrency) {
      this.activeJobs++;
      const hasJob = await this.queue.processNext(this.handler).catch((err) => {
        console.error('Job execution error in pool:', err);
        return false;
      });

      this.activeJobs--;
      if (!hasJob) {
        break; // No more pending jobs right now
      }
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    // Wait for active in-flight jobs to conclude
    while (this.activeJobs > 0) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  get isBusy(): boolean {
    return this.activeJobs > 0;
  }
}

