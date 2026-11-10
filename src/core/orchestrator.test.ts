import { describe, it, expect, vi } from 'vitest';
import { TurnOrchestrator } from './orchestrator.js';
import { FixedClock } from '../time/clock.js';
import { TemporalResolver } from '../time/resolver.js';
import { createDatabase } from '../memory/store/db.js';
import {
  MessageRepository,
  ClaimRepository,
  ContextObjectRepository,
} from '../memory/store/repository.js';
import { SqliteBlobVectorIndex } from '../memory/store/vector-index.js';
import { RecallEngine } from '../memory/recall.js';
import { SearchGateway } from '../search/gateway.js';
import { MockSearchProvider } from '../search/providers/mock.js';
import { LLMGateway } from '../llm/gateway.js';
import type { SSEWriter } from '../server/sse.js';
import type { SSEEventName, SSEEventData } from './events.js';

describe('Phase 4: TurnOrchestrator', () => {
  const clock = new FixedClock('2026-11-10T14:00:00Z');
  const resolver = new TemporalResolver();
  const db = createDatabase(':memory:');
  const messageRepo = new MessageRepository(db);
  const claimRepo = new ClaimRepository(db);
  const objectRepo = new ContextObjectRepository(db);
  const vectorIndex = new SqliteBlobVectorIndex(db);
  const recallEngine = new RecallEngine(messageRepo, claimRepo, objectRepo, vectorIndex);

  const mockSearch = new MockSearchProvider();
  const searchSpy = vi.spyOn(mockSearch, 'search');
  const searchGateway = new SearchGateway([mockSearch]);
  const llmGateway = new LLMGateway({ mainModelSpec: 'mock:test-model' });

  const orchestrator = new TurnOrchestrator({
    clock,
    resolver,
    recallEngine,
    searchGateway,
    llmGateway,
    messageRepo,
  });

  function createMockSSEWriter(): {
    writer: SSEWriter;
    emittedEvents: Array<{ event: string; data: unknown }>;
    abort: () => void;
  } {
    const emittedEvents: Array<{ event: string; data: unknown }> = [];
    const abortController = new AbortController();

    const writer: SSEWriter = {
      emit: <K extends SSEEventName>(event: K, data: SSEEventData<K>) => {
        emittedEvents.push({ event, data });
      },
      comment: () => {},
      close: () => {},
      isClosed: false,
      signal: abortController.signal,
    };

    return {
      writer,
      emittedEvents,
      abort: () => abortController.abort(),
    };
  }

  it('handles chitchat without performing any search calls', async () => {
    searchSpy.mockClear();
    const { writer, emittedEvents } = createMockSSEWriter();

    await orchestrator.runTurn(
      {
        userId: 'user_1',
        threadId: 'th_chitchat',
        message: 'hello there!',
      },
      writer
    );

    // Assert zero searches
    expect(searchSpy).not.toHaveBeenCalled();

    // Verify events
    const planEvent = emittedEvents.find((e) => e.event === 'plan');
    expect(planEvent).toBeDefined();
    expect((planEvent!.data as { needsSearch: boolean }).needsSearch).toBe(false);

    const doneEvent = emittedEvents.find((e) => e.event === 'done');
    expect(doneEvent).toBeDefined();
    expect((doneEvent!.data as { timings: { ttftMs: number } }).timings.ttftMs).toBeGreaterThanOrEqual(0);
  });

  it('executes search, emits sources, and streams cited tokens for research queries', async () => {
    searchSpy.mockClear();
    const { writer, emittedEvents } = createMockSSEWriter();

    await orchestrator.runTurn(
      {
        userId: 'user_1',
        threadId: 'th_research',
        message: 'What is HubSpot Starter pricing?',
      },
      writer
    );

    // Search was triggered
    expect(searchSpy).toHaveBeenCalled();

    // Emitted plan requires search
    const planEvent = emittedEvents.find((e) => e.event === 'plan');
    expect((planEvent!.data as { needsSearch: boolean }).needsSearch).toBe(true);

    // Sources were emitted
    const sourcesEvent = emittedEvents.find((e) => e.event === 'sources');
    expect(sourcesEvent).toBeDefined();
    const evidence = (sourcesEvent!.data as { evidence: Array<{ id: string }> }).evidence;
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence[0].id).toBe('E1');

    // Token was streamed
    const tokenEvents = emittedEvents.filter((e) => e.event === 'token');
    expect(tokenEvents.length).toBeGreaterThan(0);

    // Assistant response was saved to messageRepo
    const msgs = messageRepo.getThreadMessages('th_research');
    expect(msgs.length).toBe(2); // 1 user + 1 assistant
    expect(msgs[1].role).toBe('assistant');
  });

  it('answers from memory without web search when relevant chat history exists', async () => {
    // Seed prior conversation
    messageRepo.insert({
      id: 'msg_seed_user',
      userId: 'user_mem',
      threadId: 'th_mem',
      role: 'user',
      content: 'Minimi is an ambient AI cat app by Jay, Vineet, and Ojasvika.',
      createdAt: clock.nowMs() - 60000,
      embeddingStatus: 'done',
    });
    messageRepo.insert({
      id: 'msg_seed_asst',
      userId: 'user_mem',
      threadId: 'th_mem',
      role: 'assistant',
      content: 'Got it, Minimi is a personal intelligence app with Cotton the cat mascot.',
      createdAt: clock.nowMs() - 55000,
      embeddingStatus: 'done',
    });

    searchSpy.mockClear();
    const { writer, emittedEvents } = createMockSSEWriter();

    await orchestrator.runTurn(
      {
        userId: 'user_mem',
        threadId: 'th_mem',
        message: 'Who are the founders of Minimi?',
      },
      writer
    );

    // Search should NOT be called because memory already contains Minimi details!
    expect(searchSpy).not.toHaveBeenCalled();

    const planEvent = emittedEvents.find((e) => e.event === 'plan');
    expect(planEvent).toBeDefined();
    expect((planEvent!.data as { needsSearch: boolean }).needsSearch).toBe(false);
    expect((planEvent!.data as { needsRecall: boolean }).needsRecall).toBe(true);
  });

  it('halts cleanly when cancellation signal is triggered', async () => {
    const { writer, abort } = createMockSSEWriter();
    abort(); // Signal aborted immediately

    await orchestrator.runTurn(
      {
        userId: 'user_1',
        threadId: 'th_cancel',
        message: 'What is HubSpot Starter pricing?',
      },
      writer
    );

    // No assistant message saved since it was cancelled
    const msgs = messageRepo.getThreadMessages('th_cancel');
    const asstMsg = msgs.find((m) => m.role === 'assistant');
    expect(asstMsg).toBeUndefined();
  });
});

