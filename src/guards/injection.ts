const INJECTION_PATTERNS = [
  /\bignore\s+(?:all\s+)?previous\s+instructions\b/gi,
  /\breveal\s+(?:your\s+)?system\s+prompt\b/gi,
  /\byou\s+are\s+now\s+in\s+developer\s+mode\b/gi,
  /\bdisregard\s+(?:all\s+)?prior\s+guidelines\b/gi,
  /\boutput\s+the\s+secret\s+key\b/gi,
];

export function sanitizeUntrustedPassage(text: string): {
  clean: string;
  hasAdversarialContent: boolean;
} {
  let hasAdversarialContent = false;
  let clean = text;

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(clean)) {
      hasAdversarialContent = true;
      clean = clean.replace(pattern, '[BLOCKED_INJECTION_ATTEMPT]');
    }
  }

  return { clean, hasAdversarialContent };
}

