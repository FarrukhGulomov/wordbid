import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clientIpFrom, looksLikeBot } from '@/lib/clicks';
import { rateLimit } from '@/lib/ratelimit';
import { recordImpressions } from '@/lib/ownership-stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ words: z.array(z.string().min(1).max(60)).max(200) });

/**
 * Records an impression for each currently-owned word in the request — one listing shown to
 * one real visitor, once per page load. Called only from ImpressionBeacon, client-side, so a
 * crawler that never runs JavaScript never inflates this at all; the User-Agent check below
 * catches the ones that do.
 *
 * Unlike clicks, impressions are intentionally NOT deduplicated per visitor — a reload is a
 * genuinely new impression, same as any ad-impression count. "Unique clicks" is what CTR uses
 * for the "how many distinct people" side of the ratio.
 */
export async function POST(request: Request) {
  const userAgent = request.headers.get('user-agent') || '';
  if (looksLikeBot(userAgent)) {
    return new NextResponse(null, { status: 204 });
  }

  const ip = clientIpFrom(request.headers);
  const limited = rateLimit(`impression:${ip}`, 30, 60_000);
  if (!limited.ok) {
    return new NextResponse(null, { status: 204 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return new NextResponse(null, { status: 204 });
  }

  await recordImpressions(parsed.data.words);
  return new NextResponse(null, { status: 204 });
}
