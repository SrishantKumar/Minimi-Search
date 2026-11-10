import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabase } from './store/db.js';
import {
  MessageRepository,
  ClaimRepository,
  ContextObjectRepository,
} from './store/repository.js';
import { SqliteBlobVectorIndex } from './store/vector-index.js';
import { RecallEngine } from './recall.js';
import { TemporalResolver } from '../time/resolver.js';
import type Database from 'better-sqlite3';

describe('Phase 3: Store & RecallEngine', () => {
  let db: Database.Database;
  let messageRepo: MessageRepository;
  let claimRepo: ClaimRepository;
  let objectRepo: ContextObjectRepository;
  let vectorIndex: SqliteBlobVectorIndex;
  let recallEngine: RecallEngine;
  const resolver = new TemporalResolver();

  const userId = 'user_eval_01';
  const nowFixed = '2026-11-10T14:00:00Z'; // Tuesday 10 Nov

  beforeEach(() => {
    db = createDatabase(':memory:');
    messageRepo = new MessageRepository(db);
    claimRepo = new ClaimRepository(db);
    objectRepo = new ContextObjectRepository(db);
    vectorIndex = new SqliteBlobVectorIndex(db);
    recallEngine = new RecallEngine(messageRepo, claimRepo, objectRepo, vectorIndex);
  });

  it('correctly recalls past conversation by exact date without web search', async () => {
    // Seed a past turn on Tuesday, 3 Nov 2026 10:15:00 UTC
    const nov3Timestamp = new Date('2026-11-03T10:15:00Z').getTime();
    const threadId = 'thread_nov3';

    messageRepo.insert({
      id: 'msg_u1',
      threadId,
      userId,
      role: 'user',
      content: 'What are the best Postgres hosting options for a high-growth startup?',
      createdAt: nov3Timestamp,
      embeddingStatus: 'done',
    });

    messageRepo.insert({
      id: 'msg_a1',
      threadId,
      userId,
      role: 'assistant',
      content:
        'Supabase Pro is $25/month with 8GB disk. Neon Launch plan starts at $19/month with autoscaling storage.',
      createdAt: nov3Timestamp + 2000,
      embeddingStatus: 'done',
    });

    // Also record structured claim from that answer
    claimRepo.insert({
      id: 'claim_1',
      userId,
      threadId,
      turnId: 'turn_nov3',
      subject: 'Supabase Pro',
      attribute: 'price_usd_month',
      value: '25',
      unit: 'USD',
      asOf: nov3Timestamp,
      volatility: 'volatile',
      status: 'active',
      sourceMessageId: 'msg_a1',
      evidenceUrls: ['https://supabase.com/pricing'],
      createdAt: nov3Timestamp,
      embeddingStatus: 'done',
    });

    // Now resolve "What did I ask you on 3 November?"
    const frame = resolver.resolve('What did I ask you on 3 November?', {
      now: nowFixed,
      tz: 'UTC',
    });

    expect(frame.refs.length).toBeGreaterThan(0);
    const bundle = await recallEngine.recall(
      userId,
      'What did I ask you on 3 November?',
      frame.refs[0]
    );

    expect(bundle.completeness).toBe('exact');
    expect(bundle.turns.length).toBe(1);
    expect(bundle.turns[0].userMsg.content).toBe(
      'What are the best Postgres hosting options for a high-growth startup?'
    );
    expect(bundle.turns[0].assistantMsg?.content).toContain('Supabase Pro is $25/month');
  });

  it('returns completeness: "none" when searching an empty historical window (prevents memory fabrication)', async () => {
    const frame = resolver.resolve('What did I ask you on 15 October?', {
      now: nowFixed,
      tz: 'UTC',
    });

    const bundle = await recallEngine.recall(
      userId,
      'What did I ask you on 15 October?',
      frame.refs[0]
    );

    expect(bundle.completeness).toBe('none');
    expect(bundle.turns.length).toBe(0);
  });

  it('performs vector insertion and brute-force cosine nearest neighbor retrieval', () => {
    // Dimension 4 test vectors
    const v1 = new Float32Array([1.0, 0.0, 0.0, 0.0]); // Vector 1
    const v2 = new Float32Array([0.9, 0.1, 0.0, 0.0]); // Very close to v1
    const v3 = new Float32Array([0.0, 1.0, 0.0, 0.0]); // Orthogonal to v1

    vectorIndex.insert('doc_1', v1);
    vectorIndex.insert('doc_2', v2);
    vectorIndex.insert('doc_3', v3);

    const matches = vectorIndex.search(v1, 2);
    expect(matches.length).toBe(2);
    expect(matches[0].id).toBe('doc_1');
    expect(matches[0].score).toBeCloseTo(1.0, 3);
    expect(matches[1].id).toBe('doc_2');
    expect(matches[1].score).toBeGreaterThan(0.9);
  });
});

