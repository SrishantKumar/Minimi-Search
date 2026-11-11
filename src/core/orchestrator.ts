import { streamText } from 'ai';
import { ulid } from 'ulidx';
import type { Clock } from '../time/clock.js';
import type { TemporalResolver } from '../time/resolver.js';
import type { RecallEngine, RecallBundle } from '../memory/recall.js';
import type { SearchGateway } from '../search/gateway.js';
import type { LLMGateway } from '../llm/gateway.js';
import type { MessageRepository, ContextObjectRepository } from '../memory/store/repository.js';
import type { SSEWriter } from '../server/sse.js';
import { createPlanHeuristic } from './plan.js';
import { PromptBuilder } from './context.js';
import { ContextObjectService } from '../memory/objects.js';
import { filterValidCitations } from '../guards/citations.js';
import { checkNumericGrounding } from '../guards/numbers.js';
import { sanitizeUntrustedPassage } from '../guards/injection.js';
import type { EvidenceItem } from '../search/types.js';

export interface OrchestratorDependencies {
  clock: Clock;
  resolver: TemporalResolver;
  recallEngine: RecallEngine;
  searchGateway: SearchGateway;
  llmGateway: LLMGateway;
  messageRepo: MessageRepository;
  objectRepo?: ContextObjectRepository;
}

export interface TurnInput {
  userId: string;
  threadId: string;
  message: string;
  tz?: string;
  clientNow?: string;
}

export class TurnOrchestrator {
  private readonly objectService?: ContextObjectService;

  constructor(private readonly deps: OrchestratorDependencies) {
    if (deps.objectRepo) {
      this.objectService = new ContextObjectService(deps.objectRepo);
    }
  }

  async runTurn(input: TurnInput, sse: SSEWriter): Promise<void> {
    const startTime = this.deps.clock.nowMs();
    let ttftMs: number | null = null;
    const turnId = `turn_${ulid()}`;
    const tz = input.tz || 'UTC';
    const currentDt = this.deps.clock.now().setZone(tz);
    const nowIso = currentDt.toISO() ?? new Date().toISOString();
    const weekday = currentDt.toFormat('cccc');

    try {
      // S0: Ingest
      const userMsgId = `msg_${ulid()}`;
      await this.deps.messageRepo.insert({
        id: userMsgId,
        threadId: input.threadId,
        userId: input.userId,
        role: 'user',
        content: input.message,
        createdAt: startTime,
        embeddingStatus: 'pending',
      });

      // Extract context objects if present in user message
      if (this.objectService) {
        const extractedObjs = this.objectService.extractFromText(input.message);
        if (extractedObjs.length > 0) {
          await this.objectService.saveObjects(input.userId, input.threadId, `msg_${ulid()}`, extractedObjs, startTime);
        }
      }

      // S1: Temporal Resolve (Deterministic, 0ms LLM)
      sse.emit('status', { stage: 'routing', label: 'Resolving temporal references...' });
      const frame = this.deps.resolver.resolve(input.message, {
        now: currentDt,
        tz,
      });

      if (frame.refs.length > 0) {
        sse.emit('frame', {
          refs: frame.refs.map((r) => ({
            surface: r.surface,
            label: r.humanLabel,
            confidence: r.confidence,
          })),
        });
      }

      if (sse.signal.aborted) return;

      // S2: Recall Engine
      sse.emit('status', { stage: 'recalling', label: 'Retrieving relevant past turns & claims...' });

      const recallBundle = await (frame.refs.length > 0 || input.message.length > 3
        ? this.deps.recallEngine.recall(input.userId, input.message, frame.refs[0])
        : Promise.resolve({
            window: null,
            turns: [],
            objects: [],
            claims: [],
            completeness: 'none' as const,
          }));

      // Filter out turns without completed assistant responses and exclude the current message
      const validPriorTurns = recallBundle.turns.filter(
        (t) => t.assistantMsg && t.assistantMsg.content.trim().length > 0 && t.userMsg.id !== userMsgId
      );

      const effectiveRecall: RecallBundle = {
        ...recallBundle,
        turns: validPriorTurns,
      };

      // S3: Plan using recall context (memory-first evaluation)
      const plan = createPlanHeuristic(input.message, frame, effectiveRecall);

      sse.emit('plan', {
        intent: plan.intent,
        queries: plan.needsSearch ? 1 : 0,
        needsRecall: plan.needsRecall,
        needsSearch: plan.needsSearch,
      });

      if (sse.signal.aborted) return;

      // Fast-path: If chitchat or memory recall without search
      if (!plan.needsSearch) {
        const statusLabel =
          validPriorTurns.length > 0
            ? 'Answering from stored conversation memory...'
            : 'Composing direct response...';
        sse.emit('status', { stage: 'synthesizing', label: statusLabel });

        const systemPrompt = PromptBuilder.buildSystemPrompt({
          nowIso,
          tz,
          weekday,
          frame,
          recall: effectiveRecall,
        });

        const model = this.deps.llmGateway.getMainModel();
        const result = await streamText({
          model,
          system: systemPrompt,
          messages: [{ role: 'user', content: input.message }],
          abortSignal: sse.signal,
        });

        let accumulatedContent = '';
        for await (const chunk of result.textStream) {
          if (sse.signal.aborted) break;
          if (ttftMs === null) {
            ttftMs = this.deps.clock.nowMs() - startTime;
          }
          accumulatedContent += chunk;
          sse.emit('token', { t: chunk });
        }

        if (!sse.signal.aborted) {
          // S8: Persist
          await this.deps.messageRepo.insert({
            id: `msg_${ulid()}`,
            threadId: input.threadId,
            userId: input.userId,
            role: 'assistant',
            content: accumulatedContent,
            createdAt: this.deps.clock.nowMs(),
            embeddingStatus: 'pending',
            meta: { turnId, plan: plan.intent },
          });

          sse.emit('done', {
            turnId,
            timings: {
              ttftMs: ttftMs || 0,
              totalMs: this.deps.clock.nowMs() - startTime,
            },
          });
        }
        return;
      }

      // S5: Research Loop
      let rawEvidence: EvidenceItem[] = [];

      // Determine 'since' date bound from recalled claims or temporal frame
      let sinceParam: string | undefined = undefined;
      if (frame.usesSince && recallBundle.claims.length > 0) {
        sinceParam = new Date(recallBundle.claims[0].asOf).toISOString().slice(0, 10);
      } else if (frame.refs.length > 0) {
        sinceParam = frame.refs[0].start.slice(0, 10);
      }

      // Check if multi-entity shortlist exists (Sample Prompt 1: 5 CRM tools)
      const shortlistObj = recallBundle.objects.find((o) => o.type === 'shortlist');

      if (shortlistObj && shortlistObj.members.length > 0 && this.objectService) {
        sse.emit('status', {
          stage: 'searching',
          label: `Executing parallel searches across ${shortlistObj.members.length} entities (${shortlistObj.members.join(', ')})...`,
        });

        rawEvidence = await this.objectService.executeParallelShortlistResearch(
          this.deps.searchGateway,
          shortlistObj.members,
          sinceParam,
          sse.signal
        );
      } else {
        const searchQuery = plan.queries[0] || input.message;
        sse.emit('status', { stage: 'searching', label: `Searching web for: "${searchQuery.slice(0, 45)}..."` });
        sse.emit('search', { id: 's1', query: searchQuery, state: 'started' });

        const searchResp = await this.deps.searchGateway.search(
          {
            query: searchQuery,
            since: sinceParam,
            depth: plan.intent.includes('delta_watch') ? 'deep' : 'quick',
            maxResults: 6,
          },
          sse.signal
        );

        rawEvidence = searchResp.evidence;

        sse.emit('search', {
          id: 's1',
          query: searchQuery,
          state: 'done',
          results: searchResp.evidence.length,
        });
      }

      // Apply injection defense to sanitize untrusted web content
      const collectedEvidence = rawEvidence.map((e) => ({
        ...e,
        passage: sanitizeUntrustedPassage(e.passage).clean,
      }));

      sse.emit('sources', {
        evidence: collectedEvidence.map((e) => ({
          id: e.id,
          url: e.url,
          domain: e.domain,
          title: e.title,
          publishedAt: e.publishedAt,
          snippet: e.passage.slice(0, 250),
          score: e.score,
        })),
      });

      if (sse.signal.aborted) return;

      // S4: Context Build
      sse.emit('status', { stage: 'reading', label: `Reading and ranking ${collectedEvidence.length} sources...` });
      sse.emit('status', { stage: 'synthesizing', label: 'Synthesizing response with citations...' });

      const systemPrompt = PromptBuilder.buildSystemPrompt({
        nowIso,
        tz,
        weekday,
        frame,
        recall: effectiveRecall,
        evidence: collectedEvidence,
      });

      // S6: Synthesize
      const model = this.deps.llmGateway.getMainModel();
      const result = await streamText({
        model,
        system: systemPrompt,
        messages: [{ role: 'user', content: input.message }],
        abortSignal: sse.signal,
      });

      let accumulatedContent = '';
      for await (const chunk of result.textStream) {
        if (sse.signal.aborted) break;
        if (ttftMs === null) {
          ttftMs = this.deps.clock.nowMs() - startTime;
        }
        accumulatedContent += chunk;
        sse.emit('token', { t: chunk });
      }

      if (!sse.signal.aborted) {
        // Output Guard: Filter hallucinated citations
        const validIds = new Set(collectedEvidence.map((e) => e.id));
        const { cleanText } = filterValidCitations(accumulatedContent, validIds);

        // S7: Post-Gate - Number Grounding Check
        const allowedCorpus = [
          ...collectedEvidence.map((e) => e.passage),
          ...recallBundle.claims.map((c) => `${c.value} ${c.unit || ''}`),
        ];

        const numericViolations = checkNumericGrounding(cleanText, allowedCorpus);
        if (numericViolations.length > 0) {
          sse.emit('correction', {
            sentenceIndex: numericViolations[0].sentenceIndex,
            reason: `ungrounded_number: ${numericViolations[0].ungroundedNumbers.join(', ')}`,
          });
        }

        // S8: Persist
        await this.deps.messageRepo.insert({
          id: `msg_${ulid()}`,
          threadId: input.threadId,
          userId: input.userId,
          role: 'assistant',
          content: cleanText,
          createdAt: this.deps.clock.nowMs(),
          embeddingStatus: 'pending',
          meta: {
            turnId,
            plan: plan.intent,
            evidenceIds: collectedEvidence.map((e) => e.id),
          },
        });

        sse.emit('done', {
          turnId,
          timings: {
            ttftMs: ttftMs || 0,
            totalMs: this.deps.clock.nowMs() - startTime,
          },
        });
      }
    } catch (err: unknown) {
      if (!sse.signal.aborted) {
        console.error('TurnOrchestrator error:', err);
        sse.emit('error', {
          code: 'ORCHESTRATOR_ERROR',
          userMessage: err instanceof Error ? err.message : 'An unexpected error occurred.',
        });
      }
    }
  }
}
