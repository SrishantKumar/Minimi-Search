import type { SearchProvider } from './adapter.js';
import type { SearchRequest, RawSearchResult } from '../types.js';

export class MockSearchProvider implements SearchProvider {
  readonly name = 'mock';

  constructor(
    private readonly fixtures?: Map<string, RawSearchResult[]>
  ) {}

  async search(req: SearchRequest): Promise<RawSearchResult[]> {
    if (this.fixtures) {
      const match = this.fixtures.get(req.query.toLowerCase().trim());
      if (match) return match;
    }

    // Default synthetic results based on query keywords
    const q = req.query.toLowerCase();
    const isPricing = q.includes('price') || q.includes('pricing') || q.includes('cost');
    const isCRM = q.includes('crm') || q.includes('hubspot') || q.includes('pipedrive') || q.includes('salesforce');

    if (isCRM && isPricing) {
      return [
        {
          url: 'https://www.hubspot.com/pricing/sales',
          title: 'HubSpot Sales Hub Pricing & Plans',
          content: 'HubSpot Sales Hub Starter starts at $20/seat/month billed monthly ($15/seat/month billed annually). Professional is $90/seat/month. Features include simple automation, email tracking, and deal pipelines.',
          publishedDate: '2026-11-04T00:00:00Z',
          score: 0.95,
        },
        {
          url: 'https://www.pipedrive.com/en/pricing',
          title: 'Pipedrive Pricing Plans - Simple CRM Pricing',
          content: 'Pipedrive Essential plan is $14 per user per month billed annually ($24 monthly). Advanced plan is $29/user/month. All plans include 24/7 support and GDPR compliance.',
          publishedDate: '2026-11-02T12:00:00Z',
          score: 0.9,
        },
        {
          url: 'https://www.salesforce.com/editions-pricing/sales-cloud',
          title: 'Salesforce Sales Cloud Pricing',
          content: 'Starter Suite starts at $25 USD/user/month (annual contract). Pro Suite is $100/user/month with expanded workflow customization and sales analytics.',
          publishedDate: '2026-10-28T00:00:00Z',
          score: 0.88,
        },
      ];
    }

    return [
      {
        url: `https://example.com/search?q=${encodeURIComponent(req.query)}`,
        title: `Official information regarding ${req.query}`,
        content: `Comprehensive overview and latest details regarding ${req.query}. Verified information from official release documents and announcements.`,
        publishedDate: new Date().toISOString(),
        score: 0.85,
      },
      {
        url: `https://docs.example.org/${encodeURIComponent(req.query.replace(/\s+/g, '-'))}`,
        title: `${req.query} Documentation & Technical Overview`,
        content: `Technical documentation and specification notes for ${req.query}. Includes feature changelog, version compatibility, and deployment configurations.`,
        publishedDate: new Date().toISOString(),
        score: 0.8,
      },
    ];
  }
}

