import { PrismaClient } from '@prisma/client';
import { canonicalDomain } from '@/lib/url';

export const db = new PrismaClient();

/** Empties every table between tests. Order respects foreign keys. */
export async function resetDb() {
  await db.$executeRawUnsafe(
    'TRUNCATE "Click", "Activity", "WebhookEvent", "Word", "Ownership", "OwnershipDailyStat", ' +
      '"Payment", "Owner", "VisitorHourly", "Visitor" RESTART IDENTITY CASCADE',
  );
}

/** Creates a word plus a PENDING payment ready to be confirmed by the webhook path. */
export async function seedPendingPayment(opts: {
  word: string;
  brand: string;
  amountCents: number;
  url?: string;
}) {
  const word = await db.word.upsert({
    where: { normalized: opts.word },
    update: {},
    create: { normalized: opts.word, display: opts.word.toUpperCase() },
  });
  // Mirrors the checkout route: one Owner row per canonical domain, reused across calls, and
  // never overwritten by a later call against the same domain.
  const url = opts.url ?? `https://${opts.brand.toLowerCase()}.example`;
  const domain = canonicalDomain(new URL(url).hostname);
  const owner = await db.owner.upsert({
    where: { domain },
    update: {},
    create: { domain, name: opts.brand, url },
  });
  const payment = await db.payment.create({
    data: {
      amountCents: opts.amountCents,
      provider: 'mock',
      providerReference: `ref_${Math.random().toString(36).slice(2)}`,
      wordId: word.id,
      ownerId: owner.id,
      baselineValueCents: word.valueCents,
    },
  });
  return { word, owner, payment };
}

/**
 * Creates a PENDING BOOST payment against a word's existing owner. `amountCents` here is the
 * difference to be charged, mirroring what the /api/boost route computes — never the resulting
 * total value. The caller is responsible for the word already having a confirmed owner.
 */
export async function seedBoostPayment(opts: {
  wordId: string;
  ownerId: string;
  amountCents: number;
}) {
  const word = await db.word.findUniqueOrThrow({ where: { id: opts.wordId } });
  return db.payment.create({
    data: {
      amountCents: opts.amountCents,
      provider: 'mock',
      providerReference: `ref_${Math.random().toString(36).slice(2)}`,
      wordId: opts.wordId,
      ownerId: opts.ownerId,
      baselineValueCents: word.valueCents,
      kind: 'BOOST',
    },
  });
}
