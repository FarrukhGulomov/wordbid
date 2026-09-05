import { validateDestinationUrl } from './url';

/**
 * Best-effort title/description for a destination, so claiming needs no profile writing.
 *
 * Safety rules, because this fetches a URL the user chose:
 *   - the URL is validated first (no internal hosts, no non-http schemes);
 *   - redirects are NOT followed, so a public URL cannot bounce us to an internal one;
 *   - a short timeout and a read cap keep a hostile server from tying up a request.
 *
 * Any failure returns nulls. Fetching metadata must never block a claim.
 */

const TIMEOUT_MS = 3000;
const MAX_BYTES = 100_000;

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

function clean(value: string | undefined, max: number): string | null {
  if (!value) return null;
  const text = decodeEntities(value).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export async function fetchSiteMetadata(rawUrl: string): Promise<SiteMetadata> {
  const validated = validateDestinationUrl(rawUrl);
  if (!validated.ok) return { title: null, description: null };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(validated.url, {
      signal: controller.signal,
      redirect: 'error',
      headers: { 'User-Agent': 'OwnTheInternet/1.0 (+link preview)', Accept: 'text/html' },
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

    const ogTitle = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i.exec(html);
    const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
    const ogDescription = /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i.exec(html);
    const metaDescription = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html);

    return {
      title: clean(ogTitle?.[1] ?? titleTag?.[1], 60),
      description: clean(ogDescription?.[1] ?? metaDescription?.[1], 160),
    };
  } catch {
    return { title: null, description: null };
  } finally {
    clearTimeout(timer);
  }
}
