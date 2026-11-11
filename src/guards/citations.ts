export function filterValidCitations(
  text: string,
  validIds: Set<string>
): { cleanText: string; strippedIds: string[] } {
  const strippedIds: string[] = [];

  const cleanText = text.replace(/\[E(\d+)\]/g, (match, digits) => {
    const id = `E${digits}`;
    if (validIds.has(id)) {
      return match;
    }
    strippedIds.push(id);
    return ''; // Strip hallucinated citation ID
  });

  // Clean any resulting double horizontal spaces only, preserving newlines and markdown structure
  return {
    cleanText: cleanText.replace(/[ \t]{2,}/g, ' '),
    strippedIds,
  };
}

