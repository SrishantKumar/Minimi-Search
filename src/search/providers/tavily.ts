import type { SearchProvider } from './adapter.js';
import type { SearchRequest, RawSearchResult } from '../types.js';

export class TavilySearchProvider implements SearchProvider {
  readonly name = 'tavily';

  constructor(private readonly apiKey: string) {}

  async search(req: SearchRequest, signal?: AbortSignal): Promise<RawSearchResult[]> {
    if (!this.apiKey) {
      throw new Error('Tavily API key is not configured');
    }

    const payload: Record<string, unknown> = {
      api_key: this.apiKey,
      query: req.query,
      search_depth: req.depth === 'deep' ? 'advanced' : 'basic',
      include_answer: false,
      include_raw_content: false,
      max_results: req.maxResults ?? 6,
    };

    if (req.domains?.include && req.domains.include.length > 0) {
      payload.include_domains = req.domains.include;
    }
    if (req.domains?.exclude && req.domains.exclude.length > 0) {
      payload.exclude_domains = req.domains.exclude;
    }

    // Days limit for recency
    if (req.recency === 'day') payload.days = 1;
    else if (req.recency === 'week') payload.days = 7;
    else if (req.recency === 'month') payload.days = 30;
    else if (req.recency === 'year') payload.days = 365;

    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Tavily search failed (${res.status}): ${errText}`);
    }

    interface TavilyResultItem {
      url: string;
      title: string;
      content: string;
      published_date?: string;
      score?: number;
    }

    const json = (await res.json()) as { results?: TavilyResultItem[] };
    const rawItems = json.results || [];

    return rawItems.map((item) => ({
      url: item.url,
      title: item.title,
      content: item.content,
      publishedDate: item.published_date || null,
      score: item.score ?? 0.7,
    }));
  }
}

