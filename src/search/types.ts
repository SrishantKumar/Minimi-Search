import { z } from 'zod';

export const SearchRecencySchema = z.enum(['day', 'week', 'month', 'year', 'any']);
export type SearchRecency = z.infer<typeof SearchRecencySchema>;

export const SearchDepthSchema = z.enum(['quick', 'deep']);
export type SearchDepth = z.infer<typeof SearchDepthSchema>;

export const SearchRequestSchema = z.object({
  query: z.string().min(1).max(250),
  recency: SearchRecencySchema.optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  domains: z
    .object({
      include: z.array(z.string()).optional(),
      exclude: z.array(z.string()).optional(),
    })
    .optional(),
  depth: SearchDepthSchema.optional(),
  maxResults: z.number().int().min(1).max(20).optional(),
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;

export interface RawSearchResult {
  url: string;
  title: string;
  content: string;
  publishedDate?: string | null;
  score?: number;
}

export interface EvidenceItem {
  id: string; // E1, E2, ...
  url: string;
  canonicalUrl: string;
  domain: string;
  title: string;
  publishedAt: string | null;
  retrievedAt: string;
  passage: string;
  provider: string;
  score: number;
}

export interface SearchResponse {
  evidence: EvidenceItem[];
  provider: string;
  cached: boolean;
  note?: string;
}
