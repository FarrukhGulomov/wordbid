import { NextResponse } from 'next/server';
import { clientIpFrom, looksLikeBot } from '@/lib/clicks';
import { rateLimit } from '@/lib/ratelimit';
import {
  VISITOR_COOKIE,
  VISITOR_COOKIE_MAX_AGE_SECONDS,
  newVisitorId,
  recordHeartbeat,
} from '@/lib/attention';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The heartbeat behind every "online now" / "visitors" number on the site.
 *
 * Called only from client-side JavaScript (VisitorHeartbeat component), on page load and then
 * every ~60s while the tab stays open. Most bots and crawlers never execute this at all; the
 * User-Agent check below catches the ones that do. No number this feeds is ever inflated,
 * estimated, or seeded — a visitor exists here only because a real request created it.
 */
export async function POST(request: Request) {
  const userAgent = request.headers.get('user-agent') || '';
  if (looksLikeBot(userAgent)) {
    return new NextResponse(null, { status: 204 });
  }

  // Caps how many distinct visitor ids one IP can mint — real traffic behind a shared IP sends
  // its cookie back and just refreshes lastSeenAt, which this same limit also happily covers.
  const ip = clientIpFrom(request.headers);
  const limited = rateLimit(`visit:${ip}`, 30, 60_000);
  if (!limited.ok) {
    return new NextResponse(null, { status: 204 });
  }

  // Read the cookie straight off the request headers rather than next/headers' `cookies()`,
  // which requires Next's own request-scoped context and cannot be exercised in a plain unit
  // test calling this handler directly — this Web-standard approach works identically both ways.
  const cookieHeader = request.headers.get('cookie') ?? '';
  const existing = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${VISITOR_COOKIE}=`))
    ?.slice(VISITOR_COOKIE.length + 1);

  const visitorId = existing || newVisitorId();
  await recordHeartbeat(visitorId);

  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(VISITOR_COOKIE, visitorId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: VISITOR_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
