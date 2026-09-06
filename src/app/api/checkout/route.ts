import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { checkoutSchema } from '@/lib/validation';
import { validateWord } from '@/lib/word';
import { validateDestinationUrl, faviconUrlFor, canonicalDomain } from '@/lib/url';
import { minimumBidCents } from '@/lib/pricing';
import { getPaymentProvider } from '@/lib/payments';
import { rateLimit } from '@/lib/ratelimit';
import { clientIpFrom } from '@/lib/clicks';
import { formatUsd } from '@/lib/money';
import { fetchSiteMetadata } from '@/lib/site-metadata';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Starts a claim or takeover.
 *
 * Creates an Owner and a PENDING Payment, then hands the buyer to the payment provider.
 * NOTHING about ranking changes here — the word's value and owner only move when the
 * webhook confirms the money arrived.
 */
export async function POST(request: Request) {
  const ip = clientIpFrom(request.headers);
  const limited = rateLimit(`checkout:${ip}`, 8, 10 * 60_000);
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

  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const wordCheck = validateWord(input.word);
  if (!wordCheck.ok) return NextResponse.json({ error: wordCheck.error }, { status: 400 });

  const urlCheck = validateDestinationUrl(input.url);
  if (!urlCheck.ok) return NextResponse.json({ error: urlCheck.error }, { status: 400 });

  if (input.amountCents > config.maxAmountCents) {
    return NextResponse.json(
      { error: `The maximum single claim is ${formatUsd(config.maxAmountCents)}.` },
      { status: 400 },
    );
  }

  // Create the word row on demand. An unclaimed word carries no value and no owner, so it
  // stays off the leaderboard until a payment confirms.
  const word = await prisma.word.upsert({
    where: { normalized: wordCheck.normalized },
    update: {},
    create: { normalized: wordCheck.normalized, display: wordCheck.display },
  });

  if (word.blocked) {
    return NextResponse.json({ error: 'That word is not available.' }, { status: 400 });
  }

  const minimum = minimumBidCents(word.valueCents);
  if (input.amountCents < minimum) {
    return NextResponse.json(
      {
        error: `The price moved. You now need at least ${formatUsd(minimum)} to take this word.`,
        minimumBidCents: minimum,
      },
      { status: 409 },
    );
  }

  // One Owner row per real-world brand, keyed by its canonical domain. A brand that bids
  // again — on this word or another — reuses its existing identity instead of minting a new
  // row each time, so "how much has this domain spent" is a plain join.
  const domain = canonicalDomain(urlCheck.host);
  const existingOwner = await prisma.owner.findUnique({ where: { domain } });

  if (existingOwner?.blocked) {
    return NextResponse.json({ error: 'This brand has been suspended.' }, { status: 403 });
  }

  // Pull a short description off the destination so the buyer writes no profile. Best effort
  // only — a slow or hostile site must never block a claim. Attempted for a brand-new owner, or
  // for an existing owner that has never had one — e.g. its very first claim's fetch failed
  // (a timeout, a redirect, a since-fixed parser bug) and left description permanently null.
  // Skipped whenever a description is already on file, so a working one is never re-fetched.
  const needsMetadata = !input.description && (!existingOwner || !existingOwner.description);
  const metadata = needsMetadata ? await fetchSiteMetadata(urlCheck.url) : null;

  // An unauthenticated checkout must never be able to overwrite an existing brand's identity —
  // name, URL, logo — just by submitting the same domain again; anyone can type in any domain,
  // so "same domain" is not proof of "same person". Those three are never touched here for an
  // existing owner. description is the one exception, and only in the direction of filling a
  // real gap: if the existing owner has no description yet, this backfills it from that same
  // owner's own domain (or the buyer's own submitted text) — the same trusted source the first
  // claim would have used had its fetch succeeded. An existing, already-set description is never
  // replaced, so this can never be used to overwrite one brand's story with another's.
  const backfillDescription =
    existingOwner && !existingOwner.description ? input.description || metadata?.description || null : null;

  const owner = await prisma.owner.upsert({
    where: { domain },
    update: backfillDescription ? { description: backfillDescription } : {},
    create: {
      domain,
      name: input.brandName,
      url: urlCheck.url,
      logoUrl: faviconUrlFor(urlCheck.url),
      description: input.description || metadata?.description || null,
    },
  });

  // The provider reference is only known after the session exists, so start with a
  // placeholder that still satisfies the unique constraint.
  const payment = await prisma.payment.create({
    data: {
      amountCents: input.amountCents,
      provider: config.paymentProvider,
      providerReference: `pending:${crypto.randomUUID()}`,
      wordId: word.id,
      ownerId: owner.id,
      baselineValueCents: word.valueCents,
    },
  });

  try {
    const provider = getPaymentProvider();
    const session = await provider.createCheckout({
      paymentId: payment.id,
      amountCents: input.amountCents,
      wordDisplay: word.display,
      brandName: owner.name,
      successUrl: `${config.siteUrl}/checkout/result?payment=${payment.id}`,
      cancelUrl: `${config.siteUrl}/word/${word.normalized}?canceled=1`,
    });

    await prisma.payment.update({
      where: { id: payment.id },
      data: { providerReference: session.reference },
    });

    return NextResponse.json({ redirectUrl: session.redirectUrl, paymentId: payment.id });
  } catch (err) {
    console.error('checkout: provider failed', err);
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
