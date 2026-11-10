import type { SearchProvider } from './providers/adapter.js';
import type { SearchRequest, EvidenceItem, SearchResponse } from './types.js';
import { SearchCache } from './cache.js';
import { canonicalizeUrl, extractDomain, cleanPassage } from './normalize.js';
import { deduplicateSearchResults } from './dedupe.js';
import { rankSearchResults } from './rank.js';

export class SearchGateway {
  private readonly providers: SearchProvider[] = [];
  private readonly cache: SearchCache;

  constructor(providers: SearchProvider[], cacheTtlMinutes = 360) {
    this.providers = providers;
    this.cache = new SearchCache(cacheTtlMinutes);
  }

  async search(req: SearchRequest, signal?: AbortSignal): Promise<SearchResponse> {
    if (this.providers.length === 0) {
      throw new Error('No search providers configured in SearchGateway');
    }

    const primaryProvider = this.providers[0];

    // Check cache first
    const cached = this.cache.get(primaryProvider.name, req);
    if (cached) {
      return {
        evidence: cached,
        provider: primaryProvider.name,
        cached: true,
      };
    }

    let lastError: Error | null = null;
    let successfulProvider = primaryProvider.name;
    let rawResults = null;

    // Ordered provider fallback
    for (const provider of this.providers) {
      if (signal?.aborted) {
        throw new Error('Search aborted by client');
      }

      try {
        rawResults = await provider.search(req, signal);
        successfulProvider = provider.name;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`Search provider [${provider.name}] failed:`, lastError.message);
      }
    }

    if (!rawResults) {
      throw lastError || new Error('All search providers failed to execute search');
    }

    // 1. Deduplicate
    const deduped = deduplicateSearchResults(rawResults);

    // 2. Rank & score
    const scored = rankSearchResults(deduped, req.query, req.since);

    // 3. Slice to maxResults and format into EvidenceItem with E1..En IDs
    const limit = req.maxResults ?? 6;
    const topScored = scored.slice(0, limit);
    const nowIso = new Date().toISOString();

    const evidence: EvidenceItem[] = topScored.map((item, idx) => ({
      id: `E${idx + 1}`,
      url: item.result.url,
      canonicalUrl: canonicalizeUrl(item.result.url),
      domain: extractDomain(item.result.url),
      title: item.result.title,
      publishedAt: item.result.publishedDate || null,
      retrievedAt: nowIso,
      passage: cleanPassage(item.result.content),
      provider: successfulProvider,
      score: item.score,
    }));

    // Save to cache
    this.cache.set(successfulProvider, req, evidence);

    return {
      evidence,
      provider: successfulProvider,
      cached: false,
    };
  }

  clearCache(): void {
    this.cache.clear();
  }
}

