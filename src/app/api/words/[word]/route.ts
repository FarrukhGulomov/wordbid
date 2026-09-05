import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateWord } from '@/lib/word';
import { minimumBidCents } from '@/lib/pricing';
import { getRank } from '@/lib/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Availability + current price for a word. Used by the claim form as you type. */
export async function GET(_request: Request, ctx: { params: Promise<{ word: string }> }) {
  const { word: raw } = await ctx.params;
  const check = validateWord(decodeURIComponent(raw));
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  const word = await prisma.word.findUnique({
    where: { normalized: check.normalized },
    include: { currentOwnership: { include: { owner: { select: { name: true, url: true } } } } },
  });

  if (!word || word.blocked || !word.currentOwnership) {
    return NextResponse.json({
      normalized: check.normalized,
      display: check.display,
      owned: false,
      valueCents: 0,
      minimumBidCents: minimumBidCents(0),
    });
  }

  return NextResponse.json({
    normalized: word.normalized,
    display: word.display,
    owned: true,
    valueCents: word.valueCents,
    minimumBidCents: minimumBidCents(word.valueCents),
    clickCount: word.clickCount,
    rank: await getRank(word.id),
    owner: { name: word.currentOwnership.owner.name, url: word.currentOwnership.owner.url },
  });
}
