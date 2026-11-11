import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDatabase } from './store/db.js';
import { ContextObjectRepository } from './store/repository.js';
import { ContextObjectService } from './objects.js';
import { SearchGateway } from '../search/gateway.js';
import { MockSearchProvider } from '../search/providers/mock.js';
import type { Client } from '@libsql/client';

describe('Phase 6: Context Objects & CRM Shortlist Pipeline', () => {
  let db: Client;
  let objectRepo: ContextObjectRepository;
  let objectService: ContextObjectService;
  let searchGateway: SearchGateway;

  beforeEach(async () => {
    db = await createDatabase(':memory:');
    objectRepo = new ContextObjectRepository(db);
    objectService = new ContextObjectService(objectRepo);
    searchGateway = new SearchGateway([new MockSearchProvider()]);
  });

  it('extracts shortlist members and team size constraints from natural chat', () => {
    const text =
      "we're a 20-person sales team, shortlisting HubSpot, Pipedrive, Salesforce, Zoho, Close";

    const extracted = objectService.extractFromText(text);
    expect(extracted.length).toBe(1);

    const obj = extracted[0];
    expect(obj.type).toBe('shortlist');
    expect(obj.members).toContain('HubSpot');
    expect(obj.members).toContain('Pipedrive');
    expect(obj.members).toContain('Salesforce');
    expect(obj.members).toContain('Zoho');
    expect(obj.members).toContain('Close');
    expect(obj.attributes).toEqual({ team_size: 20 });
  });

  it('executes parallel per-entity research across shortlisted members', async () => {
    const members = ['HubSpot', 'Pipedrive', 'Salesforce', 'Zoho', 'Close'];
    const searchSpy = vi.spyOn(searchGateway, 'search');

    const evidence = await objectService.executeParallelShortlistResearch(
      searchGateway,
      members,
      '2026-11-09'
    );

    // Verified parallel search calls for each entity
    expect(searchSpy).toHaveBeenCalledTimes(5);
    expect(evidence.length).toBeGreaterThanOrEqual(5);

    // Numbered IDs E1..En
    expect(evidence[0].id).toBe('E1');
    expect(evidence[evidence.length - 1].id).toBe(`E${evidence.length}`);
  });
});
