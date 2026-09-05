import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { prisma } from '@/lib/db';
import { normalizeWord } from '@/lib/word';
import { clientIpFrom, recordClick } from '@/lib/clicks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Tracked outbound redirect: /go/<word> -> the current owner's site.
 *
 * The click is attributed to the ownership that is live at this moment, so history stays
 * accurate after a takeover. Tracking never blocks the redirect.
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
    await recordClick({
      ownershipId: word.currentOwnership.id,
      wordId: word.id,
      ip: clientIpFrom(h),
      userAgent: h.get('user-agent') || '',
    });
  } catch (err) {
    console.error('click tracking failed', err);
  }

  redirect(destination);
}
