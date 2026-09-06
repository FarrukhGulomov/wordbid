import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { confirmPayment } from '@/lib/ownership';
import { getWordByNormalized } from '@/lib/queries';
import { minimumBidCents } from '@/lib/pricing';
import { db, resetDb, seedPendingPayment } from './helpers';

beforeEach(resetDb);
afterAll(async () => {
  await db.$disconnect();
});

async function claim(word: string, brand: string, amountCents: number, eventId: string) {
  const seeded = await seedPendingPayment({ word, brand, amountCents });
  const result = await confirmPayment('mock', eventId, seeded.payment.providerReference, db);
  expect(result.outcome).toBe('won');
  return seeded;
}

describe('getWordByNormalized — rank history', () => {
  it('reports no rank delta the first time a word is ever observed', async () => {
    await claim('ai', 'AcmeAI', 1000, 'e1');

    const word = await getWordByNormalized('ai');
    expect(word!.rankDelta).toBeNull();

    // A snapshot for today now exists — real, observed state, written opportunistically.
    const snapshot = await db.rankSnapshot.findFirst({ where: { word: { normalized: 'ai' } } });
    expect(snapshot).not.toBeNull();
    expect(snapshot!.rank).toBe(1);
    expect(snapshot!.valueCents).toBe(1000);
  });

  it('does not create a second snapshot row for a second view on the same day', async () => {
    const { word } = await claim('ai', 'AcmeAI', 1000, 'e1');

    await getWordByNormalized('ai');
    await getWordByNormalized('ai');
    await getWordByNormalized('ai');

    expect(await db.rankSnapshot.count({ where: { wordId: word.id } })).toBe(1);
  });

  it('reports a positive delta when the word actually moved up since a prior observation', async () => {
    const { word } = await claim('coding', 'DevX', 1000, 'e1');
    await claim('ai', 'AcmeAI', 5000, 'e2'); // outranks coding — coding starts at rank 2

    // Simulate a real prior observation from yesterday, at rank 2.
    await db.rankSnapshot.create({
      data: {
        wordId: word.id,
        day: new Date(Date.now() - 24 * 60 * 60 * 1000),
        rank: 2,
        valueCents: 1000,
      },
    });

    // coding takes over #1 today.
    const takeover = await seedPendingPayment({ word: 'coding', brand: 'DevX2', amountCents: 6000 });
    await confirmPayment('mock', 'e3', takeover.payment.providerReference, db);

    const result = await getWordByNormalized('coding');
    expect(result!.rank).toBe(1);
    expect(result!.rankDelta).toBe(1); // was #2, now #1 — moved up by 1
  });

  it('reports a negative delta when the word fell in rank', async () => {
    const { word } = await claim('ai', 'AcmeAI', 5000, 'e1');
    await db.rankSnapshot.create({
      data: { wordId: word.id, day: new Date(Date.now() - 86_400_000), rank: 1, valueCents: 5000 },
    });

    await claim('coding', 'DevX', 6000, 'e2'); // now outranks ai — ai drops to #2

    const result = await getWordByNormalized('ai');
    expect(result!.rank).toBe(2);
    expect(result!.rankDelta).toBe(-1); // was #1, now #2
  });

  it('never fabricates a delta from a snapshot recorded earlier today', async () => {
    const { word } = await claim('ai', 'AcmeAI', 1000, 'e1');
    // A snapshot from earlier TODAY must not count as "the prior day" — only a distinct,
    // strictly earlier day is a real prior observation.
    await db.rankSnapshot.upsert({
      where: { wordId_day: { wordId: word.id, day: new Date(new Date().setUTCHours(0, 0, 0, 0)) } },
      update: { rank: 5 },
      create: {
        wordId: word.id,
        day: new Date(new Date().setUTCHours(0, 0, 0, 0)),
        rank: 5,
        valueCents: 1000,
      },
    });

    const result = await getWordByNormalized('ai');
    expect(result!.rankDelta).toBeNull();
  });

  it('shows the real live cost to reach #1, and null for the word already at #1', async () => {
    await claim('coding', 'DevX', 1000, 'e1');
    await claim('ai', 'AcmeAI', 5000, 'e2');

    const top = await getWordByNormalized('ai');
    expect(top!.rank).toBe(1);
    expect(top!.costToReachNumberOneCents).toBeNull();

    const second = await getWordByNormalized('coding');
    expect(second!.rank).toBe(2);
    expect(second!.costToReachNumberOneCents).toBe(minimumBidCents(5000));
  });

  it('is null for an unowned word — there is nothing to rank yet', async () => {
    await db.word.create({ data: { normalized: 'ghost', display: 'GHOST' } });
    const word = await getWordByNormalized('ghost');
    expect(word!.rank).toBeNull();
    expect(word!.rankDelta).toBeNull();
    expect(word!.costToReachNumberOneCents).toBeNull();
    expect(await db.rankSnapshot.count()).toBe(0);
  });
});
