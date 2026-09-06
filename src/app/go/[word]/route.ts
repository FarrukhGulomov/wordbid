import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { prisma } from '@/lib/db';
import { normalizeWord } from '@/lib/word';
import { clientIpFrom, recordClick } from '@/lib/clicks';
import { rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Tracked outbound redirect: /go/<word> -> the current owner's site.
 *
 * The click is attributed to the ownership that is live at this moment, so history stays
 * accurate after a takeover. Tracking never blocks the redirect — a rate-limited or failed
 * write only means the click isn't counted; the visitor is sent on regardless.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ word: string }> }) {
  const { word: raw } = await ctx.params;
  const normalized = normalizeWord(decodeURIComponent(raw));

  const word = await prisma.word.findUnique({
    where: { normalized },
    include: { currentOwnership: { include: { owner: true } } },
  });

  if (!word || word.blocked || !word.currentOwnership || word.currentOwnership.owner.blocked) {
    redirect('/');
  }

  const destination = word.currentOwnership.owner.url;

  try {
    const h = await headers();
    const ip = clientIpFrom(h);
    // Blunts a script hammering this endpoint to inflate Trending/Hidden Gems. A real visitor
    // never clicks VISIT this often; the existing per-visitor dedupe window (see recordClick)
    // already governs whether a click within the limit counts publicly.
    const limited = rateLimit(`click:${ip}`, 20, 60_000);
    if (limited.ok) {
      await recordClick({
        ownershipId: word.currentOwnership.id,
        wordId: word.id,
        ip,
        userAgent: h.get('user-agent') || '',
        referrer: h.get('referer'),
      });
    }
  } catch (err) {
    console.error('click tracking failed', err);
  }

  redirect(destination);
}
