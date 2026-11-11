import type { Clock } from '../time/clock.js';
import type { ClaimRepository, StoredClaim } from './store/repository.js';
import type { ClaimLedgerService, DeltaItem } from './claims.js';
import type { SearchGateway } from '../search/gateway.js';

export interface WatcherConfig {
  maxAgeMs?: number; // Check claims older than this (default: 24 hours)
  intervalMs?: number; // How often the watcher ticks (default: 1 hour)
  limitPerTick?: number; // Max claims to re-verify per tick (default: 5)
}

export interface WatcherResult {
  checkedCount: number;
  changedCount: number;
  deltas: DeltaItem[];
}

/**
 * ponytail: Proactive background claim freshness watcher.
 * Periodically identifies volatile claims (pricing, version numbers) that have aged
 * past maxAgeMs and runs targeted searches to keep the ledger updated before the user asks.
 */
export class ClaimWatcher {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly claimRepo: ClaimRepository,
    private readonly claimLedger: ClaimLedgerService,
    private readonly searchGateway: SearchGateway,
    private readonly clock: Clock,
    private readonly config?: WatcherConfig
  ) {}

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    const interval = this.config?.intervalMs ?? 3600000;

    this.timer = setInterval(async () => {
      try {
        await this.checkStaleClaims();
      } catch (err) {
        console.error('[ClaimWatcher] Error during freshness tick:', err);
      }
    }, interval);
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * One-shot check for stale volatile claims
   */
  async checkStaleClaims(): Promise<WatcherResult> {
    const now = this.clock.nowMs();
    const maxAge = this.config?.maxAgeMs ?? 86400000; // 24 hours
    const limit = this.config?.limitPerTick ?? 5;
    const cutoff = now - maxAge;

    const staleClaims = await this.claimRepo.getVolatileClaims(cutoff, limit);
    if (staleClaims.length === 0) {
      return { checkedCount: 0, changedCount: 0, deltas: [] };
    }

    const allDeltas: DeltaItem[] = [];
    let changedCount = 0;

    for (const claim of staleClaims) {
      const query = `${claim.subject} ${claim.attribute} pricing`;
      const searchRes = await this.searchGateway.search({
        query,
        recency: 'month',
        depth: 'quick',
        maxResults: 3,
      });

      const deltas = this.claimLedger.computeDeltaReport([claim], searchRes.evidence);
      for (const d of deltas) {
        allDeltas.push(d);
        if (d.status === 'changed' && d.newValue) {
          const rawValue = d.newValue.replace(/[^\d.]/g, '');
          await this.claimLedger.saveClaims(
            claim.userId,
            claim.threadId,
            claim.turnId,
            claim.sourceMessageId,
            [
              {
                subject: claim.subject,
                attribute: claim.attribute,
                value: rawValue || d.newValue,
                unit: claim.unit,
                asOf: now,
                volatility: claim.volatility,
                evidenceUrls: claim.evidenceUrls,
              },
            ]
          );
          changedCount++;
        }
      }
    }

    return {
      checkedCount: staleClaims.length,
      changedCount,
      deltas: allDeltas,
    };
  }
}
