import { z } from 'zod';

export const StatusStageSchema = z.enum([
  'routing',
  'recalling',
  'searching',
  'reading',
  'verifying',
  'synthesizing',
]);
export type StatusStage = z.infer<typeof StatusStageSchema>;

export const TemporalRefSchema = z.object({
  surface: z.string(),
  kind: z.enum(['absolute', 'relative', 'anaphoric']),
  start: z.string(),
  end: z.string(),
  humanLabel: z.string(),
  confidence: z.number(),
  alternates: z
    .array(
      z.object({
        start: z.string(),
        end: z.string(),
        humanLabel: z.string(),
      })
    )
    .optional(),
});
export type TemporalRef = z.infer<typeof TemporalRefSchema>;

export const TemporalFrameSchema = z.object({
  now: z.string(),
  tz: z.string(),
  refs: z.array(TemporalRefSchema),
  usesSince: z.boolean(),
});
export type TemporalFrame = z.infer<typeof TemporalFrameSchema>;

export const PlanIntentSchema = z.enum([
  'chitchat',
  'knowledge_static',
  'research_current',
  'memory_recall',
  'reverify',
  'delta_watch',
  'compound',
]);
export type PlanIntent = z.infer<typeof PlanIntentSchema>;

export const PlanEventSchema = z.object({
  intent: z.array(PlanIntentSchema),
  queries: z.number().default(0),
  needsRecall: z.boolean().default(false),
  needsSearch: z.boolean().default(false),
});
export type PlanEvent = z.infer<typeof PlanEventSchema>;

export const EvidenceItemSchema = z.object({
  id: z.string(),
  url: z.string(),
  domain: z.string(),
  title: z.string(),
  publishedAt: z.string().nullable().optional(),
  retrievedAt: z.string().optional(),
  snippet: z.string().optional(),
  score: z.number().optional(),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const SSEEventSchemaMap = {
  status: z.object({
    stage: StatusStageSchema,
    label: z.string(),
  }),
  frame: z.object({
    refs: z.array(
      z.object({
        surface: z.string(),
        label: z.string(),
        confidence: z.number(),
      })
    ),
  }),
  plan: PlanEventSchema,
  search: z.object({
    id: z.string(),
    query: z.string(),
    state: z.enum(['started', 'done']),
    results: z.number().optional(),
  }),
  sources: z.object({
    evidence: z.array(EvidenceItemSchema),
  }),
  token: z.object({
    t: z.string(),
  }),
  correction: z.object({
    sentenceIndex: z.number(),
    reason: z.string(),
  }),
  done: z.object({
    turnId: z.string(),
    timings: z.record(z.number()).optional(),
    usage: z
      .object({
        promptTokens: z.number().optional(),
        completionTokens: z.number().optional(),
        totalTokens: z.number().optional(),
      })
      .optional(),
  }),
  error: z.object({
    code: z.string(),
    userMessage: z.string(),
  }),
};

export type SSEEventName = keyof typeof SSEEventSchemaMap;
export type SSEEventData<K extends SSEEventName> = z.infer<(typeof SSEEventSchemaMap)[K]>;

