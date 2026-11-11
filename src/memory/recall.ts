import type { MessageRepository, ClaimRepository, ContextObjectRepository, StoredMessage, StoredClaim, StoredContextObject } from './store/repository.js';
import type { VectorIndex } from './store/vector-index.js';
import type { TemporalRef } from '../core/events.js';

export interface RecalledTurn {
  threadId: string;
  userMsg: StoredMessage;
  assistantMsg?: StoredMessage;
  at: number;
  score: number;
}

export interface RecallBundle {
  window: { start: string; end: string; label: string } | null;
  turns: RecalledTurn[];
  objects: StoredContextObject[];
  claims: StoredClaim[];
  completeness: 'exact' | 'partial' | 'fuzzy' | 'none';
  recalledSummary?: string;
}

export class RecallEngine {
  constructor(
    private readonly messageRepo: MessageRepository,
    private readonly claimRepo: ClaimRepository,
    private readonly objectRepo: ContextObjectRepository,
    private readonly vectorIndex?: VectorIndex
  ) {}

  async recall(
    userId: string,
    query: string,
    temporalRef?: TemporalRef
  ): Promise<RecallBundle> {
    let windowInfo: { start: string; end: string; label: string } | null = null;
    let windowMessages: StoredMessage[] = [];
    let isFuzzy = false;

    // Strategy 1: Time-window retrieval if temporalRef exists
    if (temporalRef && temporalRef.start && temporalRef.end) {
      const startMs = new Date(temporalRef.start).getTime();
      const endMs = new Date(temporalRef.end).getTime();

      windowInfo = {
        start: temporalRef.start,
        end: temporalRef.end,
        label: temporalRef.humanLabel,
      };

      if (!isNaN(startMs) && !isNaN(endMs)) {
        windowMessages = await this.messageRepo.getByTimeWindow(userId, startMs, endMs);
      }
    }

    // Strategy 2: Lexical FTS5 retrieval
    const ftsMessages = await this.messageRepo.searchFts(userId, query, 10);

    // Combine & deduplicate messages with Reciprocal Rank Fusion (RRF)
    const scoredMap = new Map<string, { msg: StoredMessage; score: number }>();

    // RRF rank constant
    const K = 60;

    // Window messages get a strong boost
    windowMessages.forEach((msg, idx) => {
      const rrf = 1 / (K + idx) + 1.5; // +1.5 hard boost for items inside temporal window
      scoredMap.set(msg.id, { msg, score: rrf });
    });

    // FTS messages
    ftsMessages.forEach((msg, idx) => {
      const existing = scoredMap.get(msg.id);
      const rrf = 1 / (K + idx);
      if (existing) {
        existing.score += rrf;
      } else {
        scoredMap.set(msg.id, { msg, score: rrf });
      }
    });

    let candidates = Array.from(scoredMap.values())
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.msg);

    // If temporal window was explicitly asked for, but windowMessages is empty:
    // Try fuzzy fallback outside the window by topic
    if (temporalRef && windowMessages.length === 0) {
      if (ftsMessages.length > 0) {
        candidates = ftsMessages;
        isFuzzy = true;
      }
    }

    if (candidates.length === 0) {
      return {
        window: windowInfo,
        turns: [],
        objects: [],
        claims: [],
        completeness: 'none',
      };
    }

    // Pair user and assistant messages into chronological Turns
    const turns: RecalledTurn[] = [];
    const threadMap = new Map<string, StoredMessage[]>();

    // Fetch full thread contexts for candidates to pair Q & A correctly
    for (const msg of candidates) {
      if (!threadMap.has(msg.threadId)) {
        threadMap.set(msg.threadId, await this.messageRepo.getThreadMessages(msg.threadId));
      }
    }

    for (const msg of candidates) {
      if (msg.role === 'user') {
        const threadMsgs = threadMap.get(msg.threadId) || [];
        const userIdx = threadMsgs.findIndex((m) => m.id === msg.id);
        const assistantMsg =
          userIdx !== -1 && userIdx + 1 < threadMsgs.length && threadMsgs[userIdx + 1].role === 'assistant'
            ? threadMsgs[userIdx + 1]
            : undefined;

        if (!turns.some((t) => t.userMsg.id === msg.id)) {
          turns.push({
            threadId: msg.threadId,
            userMsg: msg,
            assistantMsg,
            at: msg.createdAt,
            score: scoredMap.get(msg.id)?.score ?? 1.0,
          });
        }
      }
    }

    // Retrieve associated context objects (e.g. shortlists)
    const objects = await this.objectRepo.getByType(userId, 'shortlist');

    // Retrieve associated claims
    const claims: StoredClaim[] = [];
    for (const turn of turns) {
      if (turn.assistantMsg) {
        // Find claims from this turn or thread
        const found = await this.claimRepo.getBySubject(userId, '');
        claims.push(...found.filter((c) => c.threadId === turn.threadId));
      }
    }

    let completeness: 'exact' | 'partial' | 'fuzzy' | 'none' = 'exact';
    if (isFuzzy) {
      completeness = 'fuzzy';
    } else if (temporalRef && windowMessages.length > 0 && turns.length === 0) {
      completeness = 'partial';
    }

    return {
      window: windowInfo,
      turns,
      objects,
      claims,
      completeness,
    };
  }
}

