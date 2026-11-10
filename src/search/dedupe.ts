import { canonicalizeUrl } from './normalize.js';
import type { RawSearchResult } from './types.js';

export function deduplicateSearchResults(results: RawSearchResult[]): RawSearchResult[] {
  const seenUrls = new Set<string>();
  const seenSnippets = new Set<string>();
  const deduped: RawSearchResult[] = [];

  for (const item of results) {
    const canonical = canonicalizeUrl(item.url);
    if (seenUrls.has(canonical)) {
      continue;
    }
    seenUrls.add(canonical);

    // Fast text fingerprint: first 80 normalized chars of snippet
    const snippetKey = (item.content || '').slice(0, 80).toLowerCase().replace(/\s+/g, '');
    if (snippetKey.length > 20 && seenSnippets.has(snippetKey)) {
      continue;
    }
    if (snippetKey.length > 20) {
      seenSnippets.add(snippetKey);
    }

    deduped.push({
      ...item,
      url: canonical,
    });
  }

  return deduped;
}

