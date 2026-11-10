import { z } from 'zod';
import { PlanIntentSchema, type TemporalFrame } from './events.js';

export const PlanSchema = z.object({
  intent: z.array(PlanIntentSchema),
  needsRecall: z.boolean(),
  needsSearch: z.boolean(),
  queries: z.array(z.string()).default([]),
  verifyClaims: z.array(z.string()).default([]),
  reasoning: z.string().optional(),
});
export type Plan = z.infer<typeof PlanSchema>;

export function createPlanHeuristic(text: string, frame: TemporalFrame): Plan {
  const lower = text.toLowerCase().trim();

  // Fast-path 1: Obvious pure chitchat
  const isGreeting =
    /^(hi|hello|hey|good\s+(morning|afternoon|evening)|howdy|sup|yo)\b/i.test(lower) &&
    !lower.includes('?') &&
    frame.refs.length === 0;

  if (isGreeting) {
    return {
      intent: ['chitchat'],
      needsRecall: false,
      needsSearch: false,
      queries: [],
      verifyClaims: [],
      reasoning: 'Fast-path greeting',
    };
  }

  // Fast-path 2: Pure memory recall ("What did I ask on 3 November?")
  const isPureRecall =
    frame.refs.length > 0 &&
    /(what\s+did\s+i\s+(ask|say|tell)|did\s+i\s+(ask|mention)|my\s+question\s+on)/i.test(lower) &&
    !lower.includes('still correct') &&
    !lower.includes('changed') &&
    !frame.usesSince;

  if (isPureRecall) {
    return {
      intent: ['memory_recall'],
      needsRecall: true,
      needsSearch: false,
      queries: [],
      verifyClaims: [],
      reasoning: 'Pure historical memory query',
    };
  }

  // Fast-path 3: Delta / Re-verification ("has anything changed since...", "is your answer still correct?")
  const isDelta =
    frame.usesSince ||
    lower.includes('still correct') ||
    lower.includes('changed since') ||
    (frame.refs.length > 0 && (lower.includes('changed') || lower.includes('update') || lower.includes('pricing')));

  if (isDelta) {
    return {
      intent: ['delta_watch', 'reverify'],
      needsRecall: true,
      needsSearch: true,
      queries: [text],
      verifyClaims: [],
      reasoning: 'Change detection and re-verification over prior turns',
    };
  }

  // Fast-path 4: General live research
  return {
    intent: ['research_current'],
    needsRecall: frame.refs.length > 0,
    needsSearch: true,
    queries: [text],
    verifyClaims: [],
    reasoning: 'Information retrieval with web search',
  };
}

