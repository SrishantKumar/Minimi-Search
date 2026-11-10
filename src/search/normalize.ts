export function canonicalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    // Remove query tracking params
    const trackingParams = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'fbclid',
      'gclid',
      'ref',
      'source',
    ];
    for (const param of trackingParams) {
      url.searchParams.delete(param);
    }
    // Remove hash fragment
    url.hash = '';
    // Strip trailing slash on path if root-less
    let clean = url.toString();
    if (clean.endsWith('/') && url.pathname !== '/') {
      clean = clean.slice(0, -1);
    }
    return clean;
  } catch {
    return rawUrl;
  }
}

export function extractDomain(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

export function cleanPassage(text: string, maxChars = 3600): string {
  if (!text) return '';
  // Strip inline formatting tags without space to preserve punctuation
  let cleaned = text.replace(/<\/?(b|i|strong|em|span|a)[^>]*>/gi, '');
  // Replace block tags with a space
  cleaned = cleaned.replace(/<[^>]*>/g, ' ');
  // Normalize whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  // Truncate to limit if needed
  if (cleaned.length > maxChars) {
    return cleaned.slice(0, maxChars) + '…';
  }
  return cleaned;
}
