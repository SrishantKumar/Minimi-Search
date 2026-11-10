import { ulid } from 'ulidx';
import type { StoredClaim, ClaimRepository } from './store/repository.js';
import type { EvidenceItem } from '../search/types.js';

export interface ExtractedClaimInput {
  subject: string;
  attribute: string;
  value: string;
  unit?: string;
  asOf: number;
  volatility: 'static' | 'slow' | 'volatile';
  evidenceUrls: string[];
}

export interface DeltaItem {
  subject: string;
  attribute: string;
  oldValue: string;
  newValue?: string;
  status: 'unchanged' | 'changed' | 'new_development' | 'unverified';
  evidenceIds: string[];
  explanation: string;
}

export class ClaimLedgerService {
  constructor(private readonly claimRepo: ClaimRepository) {}

  /**
   * Fast regex gate to decide if an assistant response contains factual claims worth extracting
   */
  shouldExtractClaims(text: string): boolean {
    const hasNumbersOrCurrency = /[\$€£¥\d]+/.test(text);
    const hasFactualKeywords = /(price|pricing|plan|starts\s+at|version|release|update|tier|per\s+month|\/mo)/i.test(
      text
    );
    const hasCitation = /\[E\d+\]/.test(text);
    return (hasNumbersOrCurrency && hasFactualKeywords) || hasCitation;
  }

  /**
   * Extract claims from assistant text and evidence
   */
  extractClaimsFromText(
    text: string,
    evidence: EvidenceItem[],
    asOf: number
  ): ExtractedClaimInput[] {
    const claims: ExtractedClaimInput[] = [];
    const urls = evidence.map((e) => e.url);

    // Extraction patterns for pricing, versions, and product attributes
    const pricingRegex =
      /([A-Z][a-zA-Z0-9\s]+?)\s+(?:(?:plan|starter|pro|suite|tier|edition)\s+)?(?:starts\s+at|is|costs?)\s+([\$€£]?\d+(?:\.\d+)?)\s*(?:USD)?\s*(?:\/|\s+per\s+)?(user|seat|month|mo|year)?/gi;

    let match: RegExpExecArray | null;
    while ((match = pricingRegex.exec(text)) !== null) {
      const subject = match[1].trim();
      const rawPrice = match[2].trim();
      const unit = match[3] ? `per_${match[3].toLowerCase()}` : 'usd';

      if (subject.length > 2 && subject.length < 50) {
        claims.push({
          subject,
          attribute: 'price_usd',
          value: rawPrice.replace(/[\$€£]/, ''),
          unit,
          asOf,
          volatility: 'volatile',
          evidenceUrls: urls,
        });
      }
    }

    // Fallback: check evidence directly for verified subjects
    for (const ev of evidence) {
      const evMatches = Array.from(
        ev.passage.matchAll(
          /([A-Z][a-zA-Z0-9\s]+?)\s+(?:starts\s+at|is)\s+([\$€£]?\d+(?:\.\d+)?)\s*(?:\/|\s+per\s+)?(seat|user|month)?/gi
        )
      );

      for (const m of evMatches) {
        const subject = m[1].trim();
        const value = m[2].replace(/[\$€£]/, '').trim();
        const unit = m[3] ? `per_${m[3].toLowerCase()}` : 'usd';

        if (!claims.some((c) => c.subject.toLowerCase() === subject.toLowerCase())) {
          claims.push({
            subject,
            attribute: 'price_usd',
            value,
            unit,
            asOf,
            volatility: 'volatile',
            evidenceUrls: [ev.url],
          });
        }
      }
    }

    return claims;
  }

  /**
   * Insert claims with versioning & superseding
   */
  saveClaims(
    userId: string,
    threadId: string,
    turnId: string,
    sourceMessageId: string,
    extracted: ExtractedClaimInput[]
  ): StoredClaim[] {
    const saved: StoredClaim[] = [];

    for (const item of extracted) {
      // Check if an active claim already exists for this subject + attribute
      const existing = this.claimRepo.getBySubject(userId, item.subject);
      const activeMatch = existing.find(
        (c) => c.attribute === item.attribute && c.status === 'active'
      );

      if (activeMatch) {
        this.claimRepo.markSuperseded(activeMatch.id);
      }

      const claimId = `claim_${ulid()}`;
      const newClaim = this.claimRepo.insert({
        id: claimId,
        userId,
        threadId,
        turnId,
        subject: item.subject,
        attribute: item.attribute,
        value: item.value,
        unit: item.unit,
        asOf: item.asOf,
        volatility: item.volatility,
        status: 'active',
        supersedes: activeMatch ? activeMatch.id : undefined,
        sourceMessageId,
        evidenceUrls: item.evidenceUrls,
        createdAt: Date.now(),
        embeddingStatus: 'pending',
      });

      saved.push(newClaim);
    }

    return saved;
  }

  /**
   * Build delta report comparing prior claims against fresh evidence
   */
  computeDeltaReport(
    priorClaims: StoredClaim[],
    freshEvidence: EvidenceItem[]
  ): DeltaItem[] {
    const deltaItems: DeltaItem[] = [];

    for (const claim of priorClaims) {
      // Look for mentions of this subject in fresh evidence
      const subjectTokens = claim.subject.toLowerCase().split(/\s+/);
      const matchingEvidence = freshEvidence.filter((e) =>
        subjectTokens.some((t) => t.length > 3 && e.passage.toLowerCase().includes(t))
      );

      if (matchingEvidence.length === 0) {
        deltaItems.push({
          subject: claim.subject,
          attribute: claim.attribute,
          oldValue: claim.value,
          status: 'unverified',
          evidenceIds: [],
          explanation: 'No recent evidence mentions found in the specified comparison window.',
        });
        continue;
      }

      // Check if price changed
      let detectedNewValue: string | null = null;
      let evidenceId = matchingEvidence[0].id;

      for (const ev of matchingEvidence) {
        const priceMatches = Array.from(
          ev.passage.matchAll(/[\$€£](\d+(?:\.\d+)?)/g)
        );
        for (const pm of priceMatches) {
          const val = pm[1];
          if (val !== claim.value) {
            detectedNewValue = val;
            evidenceId = ev.id;
            break;
          }
        }
        if (detectedNewValue) break;
      }

      if (detectedNewValue) {
        deltaItems.push({
          subject: claim.subject,
          attribute: claim.attribute,
          oldValue: `${claim.value} ${claim.unit || ''}`.trim(),
          newValue: `${detectedNewValue} ${claim.unit || ''}`.trim(),
          status: 'changed',
          evidenceIds: [evidenceId],
          explanation: `Pricing updated from $${claim.value} to $${detectedNewValue}.`,
        });
      } else {
        deltaItems.push({
          subject: claim.subject,
          attribute: claim.attribute,
          oldValue: `${claim.value} ${claim.unit || ''}`.trim(),
          status: 'unchanged',
          evidenceIds: matchingEvidence.map((e) => e.id),
          explanation: 'Pricing verified unchanged according to current published pages.',
        });
      }
    }

    return deltaItems;
  }
}

