/**
 * Destination URL validation.
 *
 * Owners link out to their own site, so the only URLs we accept are public http(s)
 * addresses. Anything that could point back inside our own network is rejected.
 */

const BLOCKED_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i,
];

/** Schemes that can execute or read local resources. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export type UrlValidation =
  | { ok: true; url: string; host: string }
  | { ok: false; error: string };

/** Validates and canonicalises a destination URL. Adds https:// when no scheme is given. */
export function validateDestinationUrl(input: string): UrlValidation {
  const raw = (input || '').trim();
  if (!raw) return { ok: false, error: 'Enter your website URL.' };
  if (raw.length > 2000) return { ok: false, error: 'That URL is too long.' };

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ok: false, error: 'That does not look like a valid URL.' };
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, error: 'Only http:// and https:// links are allowed.' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'URLs with credentials are not allowed.' };
  }

  const host = parsed.hostname;
  // A hostname with no dot is either a bare local name or an internal alias.
  if (!host.includes('.') && !host.startsWith('[')) {
    return { ok: false, error: 'Enter a full public domain, for example example.com.' };
  }
  if (BLOCKED_HOST_PATTERNS.some((re) => re.test(host))) {
    return { ok: false, error: 'That URL is not allowed.' };
  }

  // Drop the fragment; keep path and query so deep links work.
  parsed.hash = '';
  return { ok: true, url: parsed.toString(), host };
}

/**
 * Canonical identity for a destination: the hostname with a leading "www." stripped and
 * lowercased. "devx.com" and "www.devx.com" are the same brand for our purposes.
 */
export function canonicalDomain(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/** Best-effort favicon for a destination, via a public resolver. Never blocks a claim. */
export function faviconUrlFor(destination: string): string | null {
  try {
    const host = new URL(destination).hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  } catch {
    return null;
  }
}
