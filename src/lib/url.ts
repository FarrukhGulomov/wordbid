import net from 'node:net';
import { isPrivateIPv4, isPrivateIPv6 } from './ip-guard';

/**
 * Destination URL validation.
 *
 * Owners link out to their own site, so the only URLs we accept are public http(s)
 * addresses. Anything that could point back inside our own network is rejected.
 */

// Only for hostnames that are NOT literal IP addresses — a name like "db.internal" that a
// literal-IP check can never catch. A hostname that IS a literal IPv4/IPv6 address is checked
// against isPrivateIPv4/isPrivateIPv6 below instead (see F03: this used to also carry its own
// separate, less complete IPv6 regexes, which is exactly how a literal IPv6 address written in a
// form those regexes didn't anticipate could slip through).
const BLOCKED_HOST_NAME_PATTERNS: RegExp[] = [/^localhost$/i, /\.local$/i, /\.internal$/i];

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
  // The WHATWG URL parser always returns a bracketed literal for an IPv6 host (e.g. "[::1]");
  // strip the brackets to get the address text isPrivateIPv6 actually parses.
  const bareHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const ipVersion = net.isIP(bareHost);

  if (ipVersion === 4) {
    if (isPrivateIPv4(bareHost)) return { ok: false, error: 'That URL is not allowed.' };
  } else if (ipVersion === 6) {
    if (isPrivateIPv6(bareHost)) return { ok: false, error: 'That URL is not allowed.' };
  } else {
    // A hostname with no dot is either a bare local name or an internal alias.
    if (!host.includes('.')) {
      return { ok: false, error: 'Enter a full public domain, for example example.com.' };
    }
    if (BLOCKED_HOST_NAME_PATTERNS.some((re) => re.test(host))) {
      return { ok: false, error: 'That URL is not allowed.' };
    }
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

/**
 * Best-effort favicon for a destination. Never blocks a claim.
 *
 * Site-relative on purpose: /api/logo fetches the icon from the public resolver server-side, so a
 * visitor's browser never contacts that resolver and never discloses to it which brands they are
 * looking at here. See src/app/api/logo/route.ts.
 */
export function faviconUrlFor(destination: string): string | null {
  try {
    const host = new URL(destination).hostname;
    return `/api/logo?domain=${encodeURIComponent(host)}`;
  } catch {
    return null;
  }
}

/**
 * Renders a stored Owner.logoUrl as something safe to put in an <img src>.
 *
 * Rows written before the proxy existed hold the resolver's own absolute URL. Rewriting them here,
 * at read time, closes the same leak for existing owners without a data migration — and keeps
 * working if a row is ever written by an older deploy. Anything else is passed through untouched:
 * only this one known third-party shape is redirected.
 */
export function displayLogoUrl(stored: string | null | undefined): string | null {
  if (!stored) return null;
  try {
    const parsed = new URL(stored, 'https://placeholder.invalid');
    if (parsed.hostname.endsWith('google.com') && parsed.pathname === '/s2/favicons') {
      const domain = parsed.searchParams.get('domain');
      return domain ? `/api/logo?domain=${encodeURIComponent(domain)}` : null;
    }
  } catch {
    return stored;
  }
  return stored;
}
