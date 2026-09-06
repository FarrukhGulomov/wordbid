import { validateDestinationUrl } from './url';
import { safeFetch } from './safe-fetch';

/**
 * Best-effort title/description for a destination, so claiming needs no profile writing.
 *
 * Safety rules, because this fetches a URL the user chose:
 *   - the URL is validated first (no internal hosts, no non-http schemes);
 *   - a redirect is followed only after its OWN target has passed that same validation — see
 *     fetchWithValidatedRedirects. A destination is never handed to fetch()'s built-in
 *     redirect:'follow', which would let a server bounce us anywhere without our SSRF checks
 *     ever seeing the real target;
 *   - a short timeout and a read cap keep a hostile server from tying up a request.
 *
 * Any failure returns nulls. Fetching metadata must never block a claim.
 */

const TIMEOUT_MS = 3000;
const MAX_BYTES = 100_000;
const MAX_REDIRECTS = 3;

export type SiteMetadata = { title: string | null; description: string | null };

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

/**
 * Removes any "<...>" sequence. A meta tag's content attribute should never contain markup, but
 * a malformed page could still smuggle one in (raw, or revealed by decoding entities above) —
 * this is belt-and-suspenders on top of React already escaping every string it renders as text.
 */
function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, ' ');
}

/** Normalizes, strips markup, and bounds a candidate value. Empty/whitespace-only => null. */
function clean(value: string | undefined, max: number): string | null {
  if (!value) return null;
  const text = stripHtml(decodeEntities(value)).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * Reads one HTML attribute's value out of a single already-isolated tag, quoted or not
 * (`attr="x"`, `attr='x'`, `attr=x`) — independent of where else in the tag it sits.
 */
function attrValue(tag: string, attr: string): string | undefined {
  const match = new RegExp(`${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  if (!match) return undefined;
  return match[1] ?? match[2] ?? match[3];
}

/**
 * Finds the first `<meta>` tag whose `attr` matches `value` and returns its `content`. Scans
 * each tag as a whole and reads its attributes independently, so it doesn't matter whether
 * content, name or property come first, last, or in between — real pages write these in either
 * order (a real-world site with content-before-property is exactly what motivated this).
 */
function findMetaContent(html: string, attr: 'property' | 'name', value: string): string | undefined {
  // A quoted attribute value can itself contain ">" (e.g. unescaped markup smuggled into
  // content="...") — matching a run of non-quote characters OR a fully-quoted string, rather
  // than just "up to the next >", keeps such a ">" from prematurely ending the tag match.
  const metaTags = html.match(/<meta\b(?:[^"'>]|"[^"]*"|'[^']*')*>/gi) ?? [];
  for (const tag of metaTags) {
    if (attrValue(tag, attr)?.toLowerCase() === value) {
      const content = attrValue(tag, 'content');
      if (content !== undefined) return content;
    }
  }
  return undefined;
}

/**
 * Extracts and sanitizes title/description from raw HTML. Pure and network-free — the fetch
 * wrapper below is the only caller in production, but keeping this separate lets the extraction
 * and sanitization rules (source preference, HTML stripping, length bounds, empty rejection) be
 * tested directly against crafted HTML, without a network round-trip.
 *
 * og:description is preferred over the plain meta description when both are present — it's the
 * value a site curated for how it wants to be shown when shared, generally more reliable than an
 * SEO meta description.
 */
export function parseSiteMetadata(html: string): SiteMetadata {
  const ogTitle = findMetaContent(html, 'property', 'og:title');
  const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
  const ogDescription = findMetaContent(html, 'property', 'og:description');
  const metaDescription = findMetaContent(html, 'name', 'description');

  return {
    title: clean(ogTitle ?? titleTag, 60),
    description: clean(ogDescription ?? metaDescription, 160),
  };
}

/**
 * Follows a redirect chain by hand, one hop at a time, instead of handing the destination to
 * fetch()'s own redirect:'follow'. That option would let a server's Location header take us
 * anywhere with no chance for our own checks to see the real target first. Here, every hop's
 * target is re-run through validateDestinationUrl — the exact same public-URL/SSRF check the
 * original owner-submitted URL went through — before it's ever fetched. A destination that
 * redirects to something disallowed (an internal host, a non-http(s) scheme, credentials in the
 * URL, too many hops) simply stops the chain; the caller's try/catch turns that into nulls.
 */
async function fetchWithValidatedRedirects(
  url: string,
  init: RequestInit,
  hopsLeft: number = MAX_REDIRECTS,
): Promise<Response> {
  const response = await safeFetch(url, { ...init, redirect: 'manual' });

  const isRedirect = response.status >= 300 && response.status < 400;
  const location = response.headers.get('location');
  if (!isRedirect || !location) return response;

  if (hopsLeft <= 0) throw new Error('Too many redirects');

  const nextUrl = new URL(location, url).toString();
  const revalidated = validateDestinationUrl(nextUrl);
  if (!revalidated.ok) throw new Error('Redirect target failed validation');

  return fetchWithValidatedRedirects(revalidated.url, init, hopsLeft - 1);
}

export async function fetchSiteMetadata(rawUrl: string): Promise<SiteMetadata> {
  const validated = validateDestinationUrl(rawUrl);
  if (!validated.ok) return { title: null, description: null };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetchWithValidatedRedirects(validated.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'WordBid/1.0 (+link preview)', Accept: 'text/html' },
      cache: 'no-store',
    });
    if (!response.ok) return { title: null, description: null };
    if (!(response.headers.get('content-type') || '').includes('text/html')) {
      return { title: null, description: null };
    }

    // Read at most MAX_BYTES — the metadata we want lives in <head>.
    const reader = response.body?.getReader();
    if (!reader) return { title: null, description: null };

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
    }
    await reader.cancel().catch(() => {});

    const html = new TextDecoder().decode(
      chunks.reduce((acc, chunk) => {
        const merged = new Uint8Array(acc.length + chunk.length);
        merged.set(acc);
        merged.set(chunk, acc.length);
        return merged;
      }, new Uint8Array()),
    );

    return parseSiteMetadata(html);
  } catch {
    return { title: null, description: null };
  } finally {
    clearTimeout(timer);
  }
}
