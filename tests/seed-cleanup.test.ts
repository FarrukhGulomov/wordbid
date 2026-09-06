import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { confirmPayment } from '@/lib/ownership';
import { removeSeedOwnershipData } from '@/lib/seed-cleanup';
import { db, resetDb, seedPendingPayment } from './helpers';

beforeEach(resetDb);
afterAll(async () => {
  await db.$disconnect();
});

/** Mirrors exactly what prisma/seed.ts writes — a CONFIRMED payment with provider "seed". */
async function seedDemoOwnership(word: string, brand: string, amountCents: number) {
  const wordRow = await db.word.upsert({
    where: { normalized: word },
    update: {},
    create: { normalized: word, display: word.toUpperCase() },
  });
  const owner = await db.owner.create({
    data: { domain: `${brand.toLowerCase()}.example.com`, name: brand, url: `https://${brand.toLowerCase()}.example.com` },
  });
  const payment = await db.payment.create({
    data: {
      amountCents,
      status: 'CONFIRMED',
      provider: 'seed',
      providerReference: `seed_${word}`,
      wordId: wordRow.id,
      ownerId: owner.id,
      confirmedAt: new Date(),
    },
  });
  const ownership = await db.ownership.create({
    data: { wordId: wordRow.id, ownerId: owner.id, amountCents, paymentId: payment.id },
  });
  await db.word.update({
    where: { id: wordRow.id },
    data: { valueCents: amountCents, currentOwnershipId: ownership.id, ownedSince: new Date() },
  });
  await db.activity.create({
    data: { type: 'CLAIMED', wordId: wordRow.id, ownerId: owner.id, amountCents },
  });
  return { word: wordRow, owner, payment, ownership };
}

describe('removeSeedOwnershipData', () => {
  it('removes a demo ownership created by prisma/seed.ts and resets the word to unowned', async () => {
    await seedDemoOwnership('ai', 'AcmeAI', 482000);

    const removed = await removeSeedOwnershipData(db);
    expect(removed).toEqual([{ word: 'AI', brand: 'AcmeAI' }]);

    const word = await db.word.findUniqueOrThrow({ where: { normalized: 'ai' } });
    expect(word.currentOwnershipId).toBeNull();
    expect(word.valueCents).toBe(0);
    expect(word.ownedSince).toBeNull();

    expect(await db.owner.findUnique({ where: { domain: 'acmeai.example.com' } })).toBeNull();
    expect(await db.payment.findUnique({ where: { providerReference: 'seed_ai' } })).toBeNull();
  });

  it('never touches a real, non-seed ownership', async () => {
    const seeded = await seedPendingPayment({ word: 'coding', brand: 'DevX', amountCents: 5000 });
    await confirmPayment('mock', 'evt1', seeded.payment.providerReference, db);

    const removed = await removeSeedOwnershipData(db);
    expect(removed).toEqual([]);

    const word = await db.word.findUniqueOrThrow({ where: { normalized: 'coding' } });
    expect(word.currentOwnershipId).not.toBeNull();
    expect(word.valueCents).toBe(5000);
  });

  it('removes only the seed-created word, leaving a real one on the same domain-style setup untouched', async () => {
    await seedDemoOwnership('video', 'VideoX', 321000);
    const seeded = await seedPendingPayment({ word: 'coding', brand: 'DevX', amountCents: 5000 });
    await confirmPayment('mock', 'evt1', seeded.payment.providerReference, db);

    const removed = await removeSeedOwnershipData(db);
    expect(removed).toEqual([{ word: 'VIDEO', brand: 'VideoX' }]);

    const codingWord = await db.word.findUniqueOrThrow({ where: { normalized: 'coding' } });
    expect(codingWord.currentOwnershipId).not.toBeNull();
    const videoWord = await db.word.findUniqueOrThrow({ where: { normalized: 'video' } });
    expect(videoWord.currentOwnershipId).toBeNull();
  });

  it('is a no-op on a database with no seed data', async () => {
    expect(await removeSeedOwnershipData(db)).toEqual([]);
  });
});
