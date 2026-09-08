import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { confirmPayment } from '@/lib/ownership';
import { unblockWord } from '@/lib/moderation';
import { db, resetDb, seedPendingPayment } from './helpers';

beforeEach(resetDb);
afterAll(async () => {
  await db.$disconnect();
});

async function claim(word: string, brand: string, amountCents: number, eventId: string) {
  const seeded = await seedPendingPayment({ word, brand, amountCents });
  const result = await confirmPayment('mock', eventId, seeded.payment.providerReference, db);
  expect(result.outcome).toBe('won');
  return seeded.word;
}

describe('unblockWord — F07', () => {
  it('reopens a word whose owner is not blocked', async () => {
    const word = await claim('ai', 'AcmeAI', 1000, 'e1');
    await db.word.update({ where: { id: word.id }, data: { blocked: true } });

    const result = await unblockWord(word.id);
    expect(result).toBe('unblocked');

    const after = await db.word.findUniqueOrThrow({ where: { id: word.id } });
    expect(after.blocked).toBe(false);
  });

  // The exact scenario F07 describes: block_owner blocked every word a suspended brand held —
  // including this one — and an admin now tries to reopen just this one word without first
  // reinstating the brand. That must never bring the suspended brand's placement back.
  it('refuses to reopen a word whose current owner is still blocked', async () => {
    const word = await claim('spam', 'Spammer', 1000, 'e1');
    const owner = await db.owner.findFirstOrThrow({ where: { name: 'Spammer' } });
    await db.$transaction([
      db.owner.update({ where: { id: owner.id }, data: { blocked: true } }),
      db.word.update({ where: { id: word.id }, data: { blocked: true } }),
    ]);

    const result = await unblockWord(word.id);
    expect(result).toBe('owner_still_blocked');

    const after = await db.word.findUniqueOrThrow({ where: { id: word.id } });
    expect(after.blocked).toBe(true);
  });

  it('reports not_found for an unknown word id rather than throwing', async () => {
    expect(await unblockWord('does-not-exist')).toBe('not_found');
  });

  it('reopens a currently-unowned word (no current ownership at all)', async () => {
    const { word } = await seedPendingPayment({ word: 'never-claimed', brand: 'X', amountCents: 1000 });
    await db.word.update({ where: { id: word.id }, data: { blocked: true } });

    expect(await unblockWord(word.id)).toBe('unblocked');
  });
});
