import { describe, it, expect } from 'vitest';
import { createDatabase } from './store/db.js';
import { ClaimRepository, MessageRepository, ThreadRepository } from './store/repository.js';
import { ClaimLedgerService } from './claims.js';
import { ClaimWatcher } from './watcher.js';
import { SearchGateway } from '../search/gateway.js';
import { MockSearchProvider } from '../search/providers/mock.js';
import { FixedClock } from '../time/clock.js';

describe('ClaimWatcher', () => {
  it('identifies and updates stale volatile claims', async () => {
    const db = await createDatabase(':memory:');

    const threadRepo = new ThreadRepository(db);
    const messageRepo = new MessageRepository(db);
    const claimRepo = new ClaimRepository(db);
    const claimLedger = new ClaimLedgerService(claimRepo);

    const clock = new FixedClock(Date.parse('2026-11-10T12:00:00Z'));
    const thread = await threadRepo.upsert('th1', 'u1', 'Pricing Thread');
    const msg = await messageRepo.insert({
      id: 'm1',
      threadId: thread.id,
      userId: 'u1',
      role: 'assistant',
      content: 'HubSpot Starter is $20/mo [E1]',
      createdAt: clock.nowMs() - 48 * 3600 * 1000, // 2 days ago
      embeddingStatus: 'done',
    });

    // Seed old volatile claim
    await claimRepo.insert({
      id: 'c1',
      userId: 'u1',
      threadId: thread.id,
      turnId: 't1',
      subject: 'HubSpot',
      attribute: 'price_usd',
      value: '20',
      unit: '/mo',
      asOf: clock.nowMs() - 48 * 3600 * 1000,
      volatility: 'volatile',
      status: 'active',
      sourceMessageId: msg.id,
      evidenceUrls: ['https://hubspot.com/pricing'],
      createdAt: clock.nowMs() - 48 * 3600 * 1000,
      embeddingStatus: 'done',
    });

    const fixtures = new Map([
      [
        'hubspot starter tier pricing',
        [
          {
            url: 'https://hubspot.com/pricing',
            title: 'HubSpot Pricing 2026',
            content: 'HubSpot Starter tier is now $15/month per seat.',
            publishedDate: '2026-11-09T00:00:00Z',
            score: 0.95,
          },
        ],
      ],
    ]);

    const mockProvider = new MockSearchProvider(fixtures);
    const searchGateway = new SearchGateway([mockProvider]);

    const watcher = new ClaimWatcher(claimRepo, claimLedger, searchGateway, clock, {
      maxAgeMs: 24 * 3600 * 1000,
      limitPerTick: 5,
    });

    const result = await watcher.checkStaleClaims();
    expect(result.checkedCount).toBe(1);
    expect(result.changedCount).toBe(1);
    expect(result.deltas[0].status).toBe('changed');
    expect(result.deltas[0].newValue).toBe('15 /mo');

    // Confirm old claim was superseded and new claim active
    const activeClaims = await claimRepo.getBySubject('u1', 'HubSpot');
    expect(activeClaims.length).toBe(1);
    expect(activeClaims[0].value).toBe('15');
    expect(activeClaims[0].supersedes).toBe('c1');
  });
});
