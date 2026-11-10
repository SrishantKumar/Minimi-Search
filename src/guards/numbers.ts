export interface NumericViolation {
  sentenceIndex: number;
  sentence: string;
  ungroundedNumbers: string[];
}

export function checkNumericGrounding(
  answerText: string,
  allowedSources: string[]
): NumericViolation[] {
  const violations: NumericViolation[] = [];
  const corpus = allowedSources.join(' ').toLowerCase();

  // Split answer into sentences
  const sentences = answerText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Match numbers with optional currency symbols, commas, decimals, percentages
  const numberRegex = /[\$€£¥]?\d+(?:[\.,]\d+)?%?/g;

  sentences.forEach((sentence, idx) => {
    const numbersInSentence = Array.from(sentence.matchAll(numberRegex)).map((m) => m[0]);
    const ungrounded: string[] = [];

    for (const num of numbersInSentence) {
      // Strip currency symbols and percentage for pure numeric check
      const rawDigits = num.replace(/[\$€£¥%,]/g, '');

      // Allow trivial single digits (0, 1, 2)
      if (rawDigits === '0' || rawDigits === '1' || rawDigits === '2') {
        continue;
      }

      // Check if rawDigits or num appears in corpus
      if (!corpus.includes(rawDigits) && !corpus.includes(num.toLowerCase())) {
        ungrounded.push(rawDigits);
      }
    }

    if (ungrounded.length > 0) {
      violations.push({
        sentenceIndex: idx,
        sentence,
        ungroundedNumbers: ungrounded,
      });
    }
  });

  return violations;
}
