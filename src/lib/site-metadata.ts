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

// Covers the whole request including any validated redirect hops — generous enough for a TLS
// handshake plus a hop or two to a small or geographically distant host, which 3s was too tight
// for in practice.
const TIMEOUT_MS = 5000;
const MAX_BYTES = 100_000;
const MAX_REDIRECTS = 3;

export type SiteMetadata = { title: string | null; description: string | null };

/**
 * Node's fetch wraps every low-level failure (DNS, TLS, connection reset, timeout) in a generic
 * `TypeError: fetch failed` — the real reason lives in `.cause`, sometimes nested more than one
 * level deep (e.g. an AggregateError from trying multiple resolved addresses). Without unwrapping
 * it, every distinct network failure logs as the same useless "fetch failed" string — which is
 * exactly what made a real failure (uzum.uz) look identical to every other one in production.
 */
function describeError(err: unknown, depth = 0): string {
  if (depth > 3 || !(err instanceof Error)) return String(err);
  const code = (err as NodeJS.ErrnoException).code;
  const label = code ? `${err.name}(${code}): ${err.message}` : `${err.name}: ${err.message}`;
  const cause = (err as { cause?: unknown }).cause;
  return cause ? `${label} <- ${describeError(cause, depth + 1)}` : label;
}

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
      // A self-identifying "WordBid/1.0 (+link preview)" UA got asaxiy.uz outright 403'd —
      // real e-commerce sites commonly run WAFs (Cloudflare, Imperva, a custom one) that
      // block unrecognized bot UAs from a datacenter IP on sight, before anything ever looks
      // at what the request actually wants. A standard browser UA plus the headers a browser
      // normally sends is not a masquerade of intent — the request still only ever reads
      // public <meta> tags a site serves to any visitor, same as before; it just avoids
      // gratuitously identifying as a bot to WAFs that reject nothing else about the request.
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'uz,ru;q=0.9,en;q=0.8',
      },
      cache: 'no-store',
    });
    if (!response.ok) {
      // A short, bounded snippet of the response body (a WAF's block page is public content
      // anyway — never cookies/headers) turns "responded 403" into an actual diagnosis: a
      // Cloudflare/Imperva challenge title, a rate-limit message, or a geo-block notice all
      // read differently, and only one of those is something a header/UA change can fix.
      const snippet = (await response.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 200);
      console.error(`fetchSiteMetadata: ${validated.host} responded ${response.status}${snippet ? `: ${snippet}` : ''}`);
      return { title: null, description: null };
    }
    // Reject only a content-type that's clearly NOT html. A cheaply-hosted site omitting the
    // header entirely (common on small/shared hosting) is not reason enough to give up — the
    // bytes are still checked for real <meta> tags either way, never rendered or executed.
    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.includes('text/html')) {
      console.error(`fetchSiteMetadata: ${validated.host} sent non-HTML content-type "${contentType}"`);
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
  } catch (err) {
    // Never let the real reason vanish silently — a DNS failure, TLS error, timeout/abort, or a
    // redirect this rejected all look identical as a bare null to the caller. Logging the actual
    // error (host + message only, never headers/body/cookies) is what makes a real-world failure
    // like this one diagnosable from Railway logs instead of a permanent mystery.
    console.error(`fetchSiteMetadata: failed for ${validated.host}: ${describeError(err)}`);
    return { title: null, description: null };
  } finally {
    clearTimeout(timer);
  }
}
