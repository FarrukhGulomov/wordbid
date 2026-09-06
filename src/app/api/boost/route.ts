import { NextResponse } from 'next/server';
import { PaymentKind } from '@prisma/client';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { boostSchema } from '@/lib/validation';
import { normalizeWord } from '@/lib/word';
import { minimumBidCents } from '@/lib/pricing';
import { getPaymentProvider } from '@/lib/payments';
import { rateLimit } from '@/lib/ratelimit';
import { clientIpFrom } from '@/lib/clicks';
import { formatUsd } from '@/lib/money';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Starts a BOOST — the CURRENT owner raising their own word's value to move up the leaderboard.
 *
 * This is deliberately not the checkout route: a boost never collects a brand name, a URL or a
 * description, because it can only ever apply to the word's existing owner. That owner is looked
 * up here, from the word's live current ownership — never taken from the request — so there is
 * no way to boost a word on someone else's behalf, even though this product has no login.
 *
 * Like checkout, NOTHING about ranking changes here — the word's value only moves once the
 * webhook confirms the money arrived. See confirmPayment's BOOST branch in src/lib/ownership.ts.
 */
export async function POST(request: Request) {
  const ip = clientIpFrom(request.headers);
  const limited = rateLimit(`boost:${ip}`, 8, 10 * 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again in a few minutes.' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const parsed = boostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Check the request and try again.' },
      { status: 400 },
    );
  }
  const input = parsed.data;
  const normalized = normalizeWord(input.word);

  const word = await prisma.word.findUnique({
    where: { normalized },
    include: { currentOwnership: { include: { owner: true } } },
  });

  if (!word || word.blocked) {
    return NextResponse.json({ error: 'That word is not available.' }, { status: 400 });
  }
  if (!word.currentOwnership) {
    return NextResponse.json(
      { error: 'This word is not owned yet. Use CLAIM instead of BOOST.' },
      { status: 400 },
    );
  }
  if (word.currentOwnership.owner.blocked) {
    return NextResponse.json({ error: 'This brand has been suspended.' }, { status: 403 });
  }

  if (input.targetValueCents > config.maxAmountCents) {
    return NextResponse.json(
      { error: `The maximum word value is ${formatUsd(config.maxAmountCents)}.` },
      { status: 400 },
    );
  }

  // Same step minimumBidCents already uses for a takeover, applied to the word's own value —
  // the floor a boost must clear. Re-checked against the LIVE value, never the value shown
  // when the boost buttons were rendered.
  const minimum = minimumBidCents(word.valueCents);
  if (input.targetValueCents < minimum) {
    return NextResponse.json(
      {
        error: `The price moved. Boosting now needs a target of at least ${formatUsd(minimum)}.`,
        minimumBoostTargetCents: minimum,
      },
      { status: 409 },
    );
  }

  const differenceCents = input.targetValueCents - word.valueCents;
  const owner = word.currentOwnership.owner;

  // The provider reference is only known after the session exists, so start with a
  // placeholder that still satisfies the unique constraint.
  const payment = await prisma.payment.create({
    data: {
      amountCents: differenceCents,
      provider: config.paymentProvider,
      providerReference: `pending:${crypto.randomUUID()}`,
      wordId: word.id,
      ownerId: owner.id,
      baselineValueCents: word.valueCents,
      kind: PaymentKind.BOOST,
    },
  });

  try {
    const provider = getPaymentProvider();
    const session = await provider.createCheckout({
      paymentId: payment.id,
      amountCents: differenceCents,
      wordDisplay: word.display,
      brandName: owner.name,
      successUrl: `${config.siteUrl}/checkout/result?payment=${payment.id}`,
      cancelUrl: `${config.siteUrl}/word/${word.normalized}/analytics?canceled=1`,
    });

    await prisma.payment.update({
      where: { id: payment.id },
      data: { providerReference: session.reference },
    });

    return NextResponse.json({ redirectUrl: session.redirectUrl, paymentId: payment.id });
  } catch (err) {
    console.error('boost: provider failed', err);
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', failureReason: 'Checkout could not be started.' },
    });
    return NextResponse.json(
      { error: 'Payment could not be started. Nothing was charged. Please try again.' },
      { status: 502 },
    );
  }
}
