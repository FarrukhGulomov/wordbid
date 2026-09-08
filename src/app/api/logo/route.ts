import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/** Longest plausible hostname; anything beyond this is not a real domain. */
const MAX_HOST_LENGTH = 253;
/** A hostname, loosely: labels of letters/digits/hyphens with at least one dot. */
const HOSTNAME = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;
/** Give up rather than let a slow third party hold a request open. */
const FETCH_TIMEOUT_MS = 4000;
/** Favicons change rarely; a day of caching keeps this off the hot path. */
const CACHE_SECONDS = 86_400;

/**
 * Server-side favicon proxy.
 *
 * Brand logos come from a public favicon resolver. Pointing every visitor's browser straight at
 * that resolver meant each page view told a third party exactly which brands the visitor was
 * looking at on WordBid — a real leak of reading behaviour that nobody opted into, and one that
 * also made the logos vanish for anyone running a content blocker. Fetching them here instead
 * means the visitor only ever talks to WordBid.
 *
 * There is no SSRF surface: the upstream URL is built here from a fixed host, and `domain` is
 * only ever interpolated as an encoded query parameter after being checked to look like a public
 * hostname. Nothing the caller sends can change WHICH host is contacted.
 */
export async function GET(request: Request) {
  const domain = new URL(request.url).searchParams.get('domain')?.toLowerCase() ?? '';

  if (!domain || domain.length > MAX_HOST_LENGTH || !HOSTNAME.test(domain)) {
    return new NextResponse(null, { status: 400 });
  }

  const upstream = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;

  try {
    const res = await fetch(upstream, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      // Never forward the visitor's cookies, referrer or anything else identifying.
      headers: { accept: 'image/*' },
      cache: 'force-cache',
      next: { revalidate: CACHE_SECONDS },
    });

    const contentType = res.headers.get('content-type') ?? '';
    if (!res.ok || !contentType.startsWith('image/')) {
      // BrandLogo draws its monogram on any non-image response, so a miss is a normal outcome.
      return new NextResponse(null, { status: 404 });
    }

    return new NextResponse(await res.arrayBuffer(), {
      status: 200,
      headers: {
        'content-type': contentType,
        'cache-control': `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}, immutable`,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    // Timeout, DNS failure, upstream down — all the same to the caller.
    return new NextResponse(null, { status: 404 });
  }
}
