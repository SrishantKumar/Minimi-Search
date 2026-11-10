import type { SearchRequest, EvidenceItem } from './types.js';

interface CacheEntry {
  evidence: EvidenceItem[];
  expiresAt: number;
}

export class SearchCache {
  private readonly store = new Map<string, CacheEntry>();
  private readonly defaultTtlMs: number;

  constructor(ttlMinutes = 360) {
    this.defaultTtlMs = ttlMinutes * 60 * 1000;
  }

  private makeKey(provider: string, req: SearchRequest): string {
    const q = req.query.trim().toLowerCase().replace(/\s+/g, ' ');
    const recency = req.recency || 'any';
    const since = req.since || '';
    // Date bucket: for volatile/recency searches, 1-hour bucket; otherwise 24-hour bucket
    const bucketHours = req.recency === 'day' || req.since ? 1 : 24;
    const dateBucket = Math.floor(Date.now() / (bucketHours * 3600 * 1000));
    return `${provider}:${q}:${recency}:${since}:${dateBucket}`;
  }

  get(provider: string, req: SearchRequest): EvidenceItem[] | null {
    const key = this.makeKey(provider, req);
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.evidence;
  }

  set(provider: string, req: SearchRequest, evidence: EvidenceItem[], ttlMs = this.defaultTtlMs): void {
    const key = this.makeKey(provider, req);
    this.store.set(key, {
      evidence,
      expiresAt: Date.now() + ttlMs,
    });
  }

  clear(): void {
    this.store.clear();
  }
}

