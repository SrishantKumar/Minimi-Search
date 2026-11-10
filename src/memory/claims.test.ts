import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabase } from './store/db.js';
import { ClaimRepository } from './store/repository.js';
import { ClaimLedgerService } from './claims.js';
import { SqliteJobQueue } from '../workers/job-queue.js';
import type Database from 'better-sqlite3';

describe('Phase 5: Claim Ledger & Delta Engine', () => {
  let db: Database.Database;
  let claimRepo: ClaimRepository;
  let claimsService: ClaimLedgerService;
  let jobQueue: SqliteJobQueue;

  const userId = 'user_claims_eval';
  const threadId = 'th_postgres_01';

  beforeEach(() => {
    db = createDatabase(':memory:');
    claimRepo = new ClaimRepository(db);
    claimsService = new ClaimLedgerService(claimRepo);
    jobQueue = new SqliteJobQueue(db);
  });

  it('extracts pricing claims from text with currency and rate heuristics', () => {
    const text =
      'Supabase Pro starts at $25/month. Neon Launch plan is $19/month billed annually. [E1] [E2]';
    const shouldExtract = claimsService.shouldExtractClaims(text);
    expect(shouldExtract).toBe(true);

    const extracted = claimsService.extractClaimsFromText(text, [], Date.now());
    expect(extracted.length).toBeGreaterThan(0);

    const supabase = extracted.find((c) => c.subject.includes('Supabase'));
    expect(supabase).toBeDefined();
    expect(supabase!.value).toBe('25');
  });

  it('supersedes previous active claim when a new claim for the same subject is recorded', () => {
    // Initial claim on 3 Nov 2026
    const nov3 = new Date('2026-11-03T10:00:00Z').getTime();
    claimsService.saveClaims(userId, threadId, 'turn_1', 'msg_1', [
      {
        subject: 'Supabase Pro',
        attribute: 'price_usd',
        value: '25',
        unit: 'per_month',
        asOf: nov3,
        volatility: 'volatile',
        evidenceUrls: ['https://supabase.com/pricing'],
      },
    ]);

    const activeBefore = claimRepo.getBySubject(userId, 'Supabase Pro');
    expect(activeBefore.length).toBe(1);
    expect(activeBefore[0].value).toBe('25');
    const firstClaimId = activeBefore[0].id;

    // Mutated update on 10 Nov 2026
    const nov10 = new Date('2026-11-10T12:00:00Z').getTime();
    claimsService.saveClaims(userId, threadId, 'turn_2', 'msg_2', [
      {
        subject: 'Supabase Pro',
        attribute: 'price_usd',
        value: '29',
        unit: 'per_month',
        asOf: nov10,
        volatility: 'volatile',
        evidenceUrls: ['https://supabase.com/pricing'],
      },
    ]);

    // Active claim is now the updated one, linking back via supersedes
    const activeAfter = claimRepo.getBySubject(userId, 'Supabase Pro');
    expect(activeAfter[0].value).toBe('29');
    expect(activeAfter[0].supersedes).toBe(firstClaimId);
  });

  it('detects changes vs fresh mutated evidence in sample prompt 3 (Postgres hosting delta)', () => {
    const asOfNov3 = new Date('2026-11-03T10:00:00Z').getTime();

    // 1. Prior recorded claims from 3 Nov
    const priorClaims = [
      claimRepo.insert({
        id: 'claim_supabase',
        userId,
        threadId,
        turnId: 'turn_1',
        subject: 'Supabase Pro',
        attribute: 'price_usd',
        value: '25',
        unit: 'per_month',
        asOf: asOfNov3,
        volatility: 'volatile',
        status: 'active',
        sourceMessageId: 'msg_1',
        evidenceUrls: ['https://supabase.com/pricing'],
        createdAt: asOfNov3,
        embeddingStatus: 'done',
      }),
      claimRepo.insert({
        id: 'claim_neon',
        userId,
        threadId,
        turnId: 'turn_1',
        subject: 'Neon Launch',
        attribute: 'price_usd',
        value: '19',
        unit: 'per_month',
        asOf: asOfNov3,
        volatility: 'volatile',
        status: 'active',
        sourceMessageId: 'msg_1',
        evidenceUrls: ['https://neon.tech/pricing'],
        createdAt: asOfNov3,
        embeddingStatus: 'done',
      }),
    ];

    // 2. Fresh evidence retrieved on 10 Nov (Supabase changed to $29; Neon unchanged at $19)
    const freshEvidence = [
      {
        id: 'E1',
        url: 'https://supabase.com/pricing',
        canonicalUrl: 'https://supabase.com/pricing',
        domain: 'supabase.com',
        title: 'Supabase Pricing',
        publishedAt: '2026-11-09T08:00:00Z',
        retrievedAt: '2026-11-10T14:00:00Z',
        passage:
          'Supabase Pro plan has been upgraded with dedicated compute and is now $29 per month with 8GB storage.',
        provider: 'mock',
        score: 0.95,
      },
      {
        id: 'E2',
        url: 'https://neon.tech/pricing',
        canonicalUrl: 'https://neon.tech/pricing',
        domain: 'neon.tech',
        title: 'Neon Pricing',
        publishedAt: '2026-11-01T00:00:00Z',
        retrievedAt: '2026-11-10T14:00:00Z',
        passage:
          'Neon Launch plan starts at $19 per month for serverless Postgres with instant branching.',
        provider: 'mock',
        score: 0.9,
      },
    ];

    // 3. Compute delta
    const deltaReport = claimsService.computeDeltaReport(priorClaims, freshEvidence);
    expect(deltaReport.length).toBe(2);

    const supabaseDelta = deltaReport.find((d) => d.subject.includes('Supabase'));
    expect(supabaseDelta).toBeDefined();
    expect(supabaseDelta!.status).toBe('changed');
    expect(supabaseDelta!.oldValue).toContain('25');
    expect(supabaseDelta!.newValue).toContain('29');
    expect(supabaseDelta!.evidenceIds).toContain('E1');

    const neonDelta = deltaReport.find((d) => d.subject.includes('Neon'));
    expect(neonDelta).toBeDefined();
    expect(neonDelta!.status).toBe('unchanged');
    expect(neonDelta!.evidenceIds).toContain('E2');
  });

  it('persists background extraction jobs in SqliteJobQueue across restarts', async () => {
    const jobId = await jobQueue.enqueue('extract_claims', {
      turnId: 'turn_10',
      messageText: 'HubSpot Starter is $20',
    });

    expect(jobId).toBeDefined();
    expect(jobQueue.getPendingCount()).toBe(1);

    let processed = false;
    const handled = await jobQueue.processNext(async (job) => {
      expect(job.id).toBe(jobId);
      expect(job.kind).toBe('extract_claims');
      processed = true;
    });

    expect(handled).toBe(true);
    expect(processed).toBe(true);
    expect(jobQueue.getPendingCount()).toBe(0);
  });
});

