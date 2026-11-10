import { z } from 'zod';
import { PlanIntentSchema, type TemporalFrame } from './events.js';
import type { RecallBundle } from '../memory/recall.js';

export const PlanSchema = z.object({
  intent: z.array(PlanIntentSchema),
  needsRecall: z.boolean(),
  needsSearch: z.boolean(),
  queries: z.array(z.string()).default([]),
  verifyClaims: z.array(z.string()).default([]),
  reasoning: z.string().optional(),
});
export type Plan = z.infer<typeof PlanSchema>;

export function createPlanHeuristic(
  text: string,
  frame: TemporalFrame,
  recall?: RecallBundle
): Plan {
  const lower = text.toLowerCase().trim();

  // Fast-path 1: Obvious pure chitchat / greetings / pleasantries
  const isGreeting =
    /^(hi|hello|hey|good\s+(morning|afternoon|evening)|howdy|sup|yo|thanks|thank\s+you|ok|okay|got\s+it|bye|goodbye)\b/i.test(lower) &&
    !lower.includes('?') &&
    frame.refs.length === 0;

  if (isGreeting) {
    return {
      intent: ['chitchat'],
      needsRecall: false,
      needsSearch: false,
      queries: [],
      verifyClaims: [],
      reasoning: 'Fast-path greeting / conversational closing',
    };
  }

  // Fast-path 2: Explicit memory recall ("What did I ask on 3 November?", "what did we discuss", "do you remember")
  const isPureRecallIntent =
    /(what\s+did\s+(i|we)\s+(ask|say|tell|discuss|talk\s+about)|did\s+i\s+(ask|mention|tell)|my\s+question|remember\s+when|our\s+discussion|earlier\s+we|last\s+time\s+we|previous(ly)?|we\s+shortlisted|do\s+you\s+remember)/i.test(lower) &&
    !lower.includes('still correct') &&
    !lower.includes('changed') &&
    !lower.includes('update') &&
    !frame.usesSince;

  if (isPureRecallIntent) {
    return {
      intent: ['memory_recall'],
      needsRecall: true,
      needsSearch: false,
      queries: [],
      verifyClaims: [],
      reasoning: 'Explicit conversational memory query',
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

  // Fast-path 4: Chat History / Memory Hit (Prior conversation exists)
  const hasPriorTurns = Boolean(
    recall &&
      recall.turns &&
      recall.turns.filter((t) => t.assistantMsg && t.assistantMsg.content.trim().length > 0).length > 0
  );

  const demandsFreshWebSearch =
    lower.includes('search') ||
    lower.includes('google') ||
    lower.includes('web') ||
    lower.includes('latest') ||
    lower.includes('today') ||
    lower.includes('current') ||
    lower.includes('news') ||
    lower.includes('pricing') ||
    lower.includes('changelog') ||
    lower.includes('browse') ||
    lower.includes('online');

  if (hasPriorTurns && !demandsFreshWebSearch) {
    return {
      intent: ['memory_recall'],
      needsRecall: true,
      needsSearch: false,
      queries: [],
      verifyClaims: [],
      reasoning: 'Relevant chat history found in persistent memory; answering without web search',
    };
  }

  // Fast-path 5: Pure self-contained generation, calculation, or coding tasks
  const isSelfContained =
    /^(write|create|implement|code|generate|calculate|solve|convert|explain|summarize\s+this|draft)\b/i.test(lower) &&
    !demandsFreshWebSearch &&
    frame.refs.length === 0;

  if (isSelfContained) {
    return {
      intent: ['chitchat'],
      needsRecall: hasPriorTurns,
      needsSearch: false,
      queries: [],
      verifyClaims: [],
      reasoning: 'Self-contained reasoning/coding task without web search dependency',
    };
  }

  // Fast-path 6: General live research (when external facts are needed and not in memory)
  return {
    intent: ['research_current'],
    needsRecall: frame.refs.length > 0 || hasPriorTurns,
    needsSearch: true,
    queries: [text],
    verifyClaims: [],
    reasoning: 'Information retrieval with web search',
  };
}
