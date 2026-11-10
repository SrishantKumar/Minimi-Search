import { tool } from 'ai';
import { z } from 'zod';
import type { SearchGateway } from './gateway.js';
import type { EvidenceItem } from './types.js';

export const WebSearchInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(250)
    .describe('The search query. Be specific, include entity names and key attributes.'),
  recency: z
    .enum(['day', 'week', 'month', 'year', 'any'])
    .optional()
    .describe('Optional freshness constraint for time-sensitive or news queries.'),
  since: z
    .string()
    .optional()
    .describe('Optional ISO date (YYYY-MM-DD) to search for changes or articles published after this date.'),
  until: z
    .string()
    .optional()
    .describe('Optional ISO date (YYYY-MM-DD) upper bound for historical search.'),
  domains: z
    .object({
      include: z.array(z.string()).optional(),
      exclude: z.array(z.string()).optional(),
    })
    .optional(),
  depth: z
    .enum(['quick', 'deep'])
    .optional()
    .describe('Search depth. Deep runs comprehensive retrieval for complex comparisons.'),
});

export type WebSearchInput = z.infer<typeof WebSearchInputSchema>;

export interface WebSearchOutput {
  evidence: EvidenceItem[];
  note?: string;
}

export function createWebSearchTool(
  searchGateway: SearchGateway,
  onSearchExecuted?: (query: string, resultsCount: number) => void
) {
  return tool({
    description:
      'Search the public live web for up-to-date facts, current pricing, changelogs, product details, and verified news. Returns a numbered evidence list [E1, E2, ...]. Always cite facts using these IDs.',
    parameters: WebSearchInputSchema,
    execute: async (args: WebSearchInput): Promise<WebSearchOutput> => {
      const response = await searchGateway.search({
        query: args.query,
        recency: args.recency,
        since: args.since,
        until: args.until,
        domains: args.domains,
        depth: args.depth || 'quick',
      });

      if (onSearchExecuted) {
        onSearchExecuted(args.query, response.evidence.length);
      }

      return {
        evidence: response.evidence,
        note: response.cached ? 'Results served from fast cache' : undefined,
      };
    },
  });
}
