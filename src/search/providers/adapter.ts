import type { SearchRequest, RawSearchResult } from '../types.js';

export interface SearchProvider {
  readonly name: string;
  search(req: SearchRequest, signal?: AbortSignal): Promise<RawSearchResult[]>;
}

