import { extractDomain } from './normalize.js';
import type { RawSearchResult } from './types.js';

const HIGH_AUTHORITY_PATHS = ['/pricing', '/changelog', '/release-notes', '/docs', '/blog'];
const AGGREGATOR_DOMAINS = [
  'g2.com',
  'capterra.com',
  'trustradius.com',
  'softwareadvice.com',
  'reddit.com',
  'quora.com',
];

export interface ScoredResult {
  result: RawSearchResult;
  score: number;
}

export function rankSearchResults(
  results: RawSearchResult[],
  query: string,
  sinceDate?: string
): ScoredResult[] {
  const domainCounts = new Map<string, number>();

  return results
    .map((res) => {
      const domain = extractDomain(res.url);
      const urlPath = safePath(res.url);

      // 1. Relevance: base score from search engine or lexical overlap
      const rawRelevance = res.score ?? 0.7;
      const relevance = Math.min(Math.max(rawRelevance, 0), 1);

      // 2. Authority: boost for official paths, penalty for aggregators
      let authority = 0.5;
      if (HIGH_AUTHORITY_PATHS.some((p) => urlPath.includes(p))) {
        authority += 0.35;
      }
      if (AGGREGATOR_DOMAINS.includes(domain)) {
        authority -= 0.2;
      }
      authority = Math.min(Math.max(authority, 0), 1);

      // 3. Freshness: check published date vs sinceDate or recency
      let freshness = 0.5;
      if (res.publishedDate) {
        const pubTime = new Date(res.publishedDate).getTime();
        if (!isNaN(pubTime)) {
          const now = Date.now();
          const ageDays = Math.max(0, (now - pubTime) / (1000 * 60 * 60 * 24));
          freshness = Math.exp(-ageDays / 180); // Half-life ~180 days

          if (sinceDate) {
            const sinceTime = new Date(sinceDate).getTime();
            if (!isNaN(sinceTime)) {
              if (pubTime >= sinceTime) {
                freshness = 1.0;
              } else {
                freshness = 0.2; // Older than requested since window
              }
            }
          }
        }
      }

      // 4. Diversity: demote subsequent results from the same domain
      const count = domainCounts.get(domain) ?? 0;
      domainCounts.set(domain, count + 1);
      const diversity = 1.0 / (1 + count * 0.5);

      // Combined formula: 0.45*relevance + 0.25*authority + 0.20*freshness + 0.10*diversity
      const compositeScore =
        0.45 * relevance + 0.25 * authority + 0.2 * freshness + 0.1 * diversity;

      return {
        result: res,
        score: Math.round(compositeScore * 1000) / 1000,
      };
    })
    .sort((a, b) => b.score - a.score);
}

function safePath(urlStr: string): string {
  try {
    return new URL(urlStr).pathname.toLowerCase();
  } catch {
    return '';
  }
}

