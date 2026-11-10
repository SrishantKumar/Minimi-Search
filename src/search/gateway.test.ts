import { describe, it, expect, vi } from 'vitest';
import { SearchGateway } from './gateway.js';
import { canonicalizeUrl, extractDomain, cleanPassage } from './normalize.js';
import { deduplicateSearchResults } from './dedupe.js';
import { rankSearchResults } from './rank.js';
import { MockSearchProvider } from './providers/mock.js';
import type { SearchProvider } from './providers/adapter.js';

describe('Search Normalization & Utilities', () => {
  it('canonicalizes URLs by removing tracking params and hash fragments', () => {
    const raw = 'https://www.example.com/pricing/?utm_source=google&utm_medium=cpc#plan-pro';
    const clean = canonicalizeUrl(raw);
    expect(clean).toBe('https://www.example.com/pricing');
  });

  it('extracts bare domain name accurately', () => {
    expect(extractDomain('https://www.hubspot.com/pricing')).toBe('hubspot.com');
    expect(extractDomain('https://sub.domain.co.uk/path')).toBe('sub.domain.co.uk');
  });

  it('cleans passage HTML and normalizes whitespace', () => {
    const dirty = '<p>Pricing starts at <b>$20/mo</b>.</p>\n\n  <div>All features included.</div>';
    const clean = cleanPassage(dirty);
    expect(clean).toBe('Pricing starts at $20/mo. All features included.');
  });
});

describe('Search Deduplication & Ranking', () => {
  it('deduplicates identical canonical URLs', () => {
    const raw = [
      { url: 'https://hubspot.com/pricing?utm_source=ad', title: 'HubSpot', content: 'Starter $20' },
      { url: 'https://hubspot.com/pricing#top', title: 'HubSpot Pro', content: 'Starter $20/month plan' },
    ];
    const deduped = deduplicateSearchResults(raw);
    expect(deduped.length).toBe(1);
    expect(deduped[0].url).toBe('https://hubspot.com/pricing');
  });

  it('boosts high-authority paths (/pricing) over aggregators', () => {
    const raw = [
      { url: 'https://g2.com/products/hubspot/pricing', title: 'G2 Reviews', content: 'HubSpot pricing review' },
      { url: 'https://hubspot.com/pricing', title: 'HubSpot Official Pricing', content: 'Official HubSpot Starter is $20' },
    ];
    const ranked = rankSearchResults(raw, 'hubspot pricing');
    expect(ranked[0].result.url).toBe('https://hubspot.com/pricing');
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });
});

describe('SearchGateway Provider Fallback & Cache', () => {
  it('falls back to secondary provider if primary fails', async () => {
    const failingPrimary: SearchProvider = {
      name: 'broken-primary',
      search: vi.fn().mockRejectedValue(new Error('500 Service Unavailable')),
    };

    const secondary = new MockSearchProvider();

    const gateway = new SearchGateway([failingPrimary, secondary]);
    const response = await gateway.search({ query: 'hubspot pricing' });

    expect(failingPrimary.search).toHaveBeenCalled();
    expect(response.provider).toBe('mock');
    expect(response.evidence.length).toBeGreaterThan(0);
    expect(response.evidence[0].id).toBe('E1');
  });

  it('serves cached results on identical second request', async () => {
    const mockProvider = new MockSearchProvider();
    const spy = vi.spyOn(mockProvider, 'search');

    const gateway = new SearchGateway([mockProvider]);

    const first = await gateway.search({ query: 'salesforce pricing' });
    expect(first.cached).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);

    const second = await gateway.search({ query: 'salesforce pricing' });
    expect(second.cached).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1); // Cached, no second call
    expect(second.evidence).toEqual(first.evidence);
  });
});

