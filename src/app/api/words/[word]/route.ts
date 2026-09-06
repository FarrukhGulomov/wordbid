import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateWord } from '@/lib/word';
import { minimumBidCents } from '@/lib/pricing';
import { getRank, getProjectedRank } from '@/lib/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Availability + current price for a word, used by the claim form as you type. Also accepts an
 * optional `?amount=<cents>` — when present, the response includes `projectedRank`: where that
 * amount would rank TODAY, so a buyer sees their expected position BEFORE paying, not just the
 * price. See getProjectedRank for why this can only ever be a live snapshot, never a promise.
 */
export async function GET(request: Request, ctx: { params: Promise<{ word: string }> }) {
  const { word: raw } = await ctx.params;
  const check = validateWord(decodeURIComponent(raw));
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  const amountParam = new URL(request.url).searchParams.get('amount');
  const amountCents = amountParam ? Number.parseInt(amountParam, 10) : NaN;
  const requestedAmount = Number.isFinite(amountCents) && amountCents > 0 ? amountCents : null;

  const word = await prisma.word.findUnique({
    where: { normalized: check.normalized },
    include: { currentOwnership: { include: { owner: { select: { name: true, url: true } } } } },
  });

  const projectedRank =
    requestedAmount !== null ? await getProjectedRank(requestedAmount, word?.id) : null;

  if (!word || word.blocked || !word.currentOwnership) {
    return NextResponse.json({
      normalized: check.normalized,
      display: check.display,
      owned: false,
      valueCents: 0,
      minimumBidCents: minimumBidCents(0),
      projectedRank,
    });
  }

  return NextResponse.json({
    normalized: word.normalized,
    display: word.display,
    owned: true,
    valueCents: word.valueCents,
    minimumBidCents: minimumBidCents(word.valueCents),
    // Clicks earned by the current owner only — see getLeaderboard for the same rule.
    clickCount: word.currentOwnership.clickCount,
    rank: await getRank(word.id),
    projectedRank,
    owner: { name: word.currentOwnership.owner.name, url: word.currentOwnership.owner.url },
  });
}
