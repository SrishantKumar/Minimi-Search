import { ulid } from 'ulidx';
import type { ContextObjectRepository, StoredContextObject } from './store/repository.js';
import type { SearchGateway } from '../search/gateway.js';
import type { EvidenceItem } from '../search/types.js';

export interface ExtractedObjectInput {
  type: string; // 'shortlist' | 'constraint' | 'topic' | 'preference'
  label: string;
  members: string[];
  attributes?: Record<string, unknown>;
}

export class ContextObjectService {
  constructor(private readonly objectRepo: ContextObjectRepository) {}

  /**
   * Fast regex heuristic to identify shortlisted entity groups and constraints
   */
  extractFromText(text: string): ExtractedObjectInput[] {
    const objects: ExtractedObjectInput[] = [];

    // Check for team size / user count constraints (e.g. "20-person sales team", "20 seats")
    const constraintMatch = text.match(/\b(\d+)[-\s]*(?:person|people|seat|seats|user|users)\b/i);
    let attributes: Record<string, unknown> | undefined = undefined;
    if (constraintMatch) {
      attributes = {
        team_size: parseInt(constraintMatch[1], 10),
      };
    }

    // Check for shortlists: "shortlisting X, Y, Z" or "comparing X, Y, and Z"
    const shortlistRegex =
      /\b(?:shortlisting|shortlisted|comparing|evaluating|considering|options?:\s*|tools?:\s*)\s+([A-Za-z0-9\s,\/\+]+?)(?=[\.\?!]|$)/i;

    const match = text.match(shortlistRegex);
    if (match) {
      const rawEntities = match[1];
      const members = rawEntities
        .split(/,|\band\b/i)
        .map((s) => s.trim())
        .filter((s) => s.length > 1 && !/\b(the|our|team|sales)\b/i.test(s));

      if (members.length >= 2) {
        objects.push({
          type: 'shortlist',
          label: 'CRM tools shortlist',
          members,
          attributes,
        });
      }
    }

    return objects;
  }

  saveObjects(
    userId: string,
    threadId: string,
    sourceMessageId: string,
    extracted: ExtractedObjectInput[],
    createdAt = Date.now()
  ): StoredContextObject[] {
    const saved: StoredContextObject[] = [];

    for (const obj of extracted) {
      const savedObj = this.objectRepo.insert({
        id: `obj_${ulid()}`,
        userId,
        threadId,
        type: obj.type,
        label: obj.label,
        members: obj.members,
        attributes: obj.attributes,
        createdAt,
        sourceMessageId,
        embeddingStatus: 'pending',
      });
      saved.push(savedObj);
    }

    return saved;
  }

  /**
   * Pre-seeded parallel research for multi-entity shortlists
   * Generates parallel searches per entity and executes with Promise.allSettled
   */
  async executeParallelShortlistResearch(
    searchGateway: SearchGateway,
    members: string[],
    sinceDate?: string,
    signal?: AbortSignal
  ): Promise<EvidenceItem[]> {
    const queries = members.map((member) => ({
      member,
      query: `${member} pricing plans updates ${sinceDate ? `since ${sinceDate}` : ''}`.trim(),
    }));

    const searchPromises = queries.map((q) =>
      searchGateway
        .search(
          {
            query: q.query,
            since: sinceDate,
            depth: 'quick',
            maxResults: 2,
          },
          signal
        )
        .then((res) => res.evidence)
        .catch(() => [] as EvidenceItem[])
    );

    const settled = await Promise.all(searchPromises);
    const combinedEvidence: EvidenceItem[] = [];

    settled.forEach((items) => {
      combinedEvidence.push(...items);
    });

    // Re-index evidence with unique IDs E1..En
    return combinedEvidence.map((e, idx) => ({
      ...e,
      id: `E${idx + 1}`,
    }));
  }
}
