import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { confirmPayment } from '@/lib/ownership';
import { recordClick } from '@/lib/clicks';
import { getLeaderboard, getWordByNormalized } from '@/lib/queries';
import { db, resetDb, seedPendingPayment } from './helpers';

const CHROME = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126 Safari/537.36';

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

/**
 * Production bug: BilimON claimed EDUCATION and earned 2 clicks, then kursi24.uz took the
 * word. The leaderboard and word page went on showing kursi24 with BilimON's 2 historical
 * clicks, because both read Word.clickCount — a lifetime total across every owner — instead
 * of the current Ownership's own count. Clicks must belong to the ownership that earned them.
 */
describe('click attribution survives a takeover (regression)', () => {
  it('reproduces the exact BilimON / kursi24.uz / EDUCATION scenario', async () => {
    const bilimon = await claim('education', 'BilimON', 1000, 'e1');
    const bilimonOwnershipId = (
      await db.word.findUniqueOrThrow({
        where: { id: bilimon.word.id },
        include: { currentOwnership: true },
      })
    ).currentOwnership!.id;

    // BilimON receives 2 valid clicks.
    await recordClick({
      ownershipId: bilimonOwnershipId,
      wordId: bilimon.word.id,
      ip: '1.1.1.1',
      userAgent: CHROME,
    });
    await recordClick({
      ownershipId: bilimonOwnershipId,
      wordId: bilimon.word.id,
      ip: '2.2.2.2',
      userAgent: CHROME,
    });

    // Sanity check before the takeover: the leaderboard shows BilimON's 2 clicks.
    let board = await getLeaderboard();
    expect(board[0]).toMatchObject({ ownerName: 'BilimON', clickCount: 2 });

    // kursi24.uz takes EDUCATION.
    await claim('education', 'kursi24.uz', 2000, 'e2');

    // The leaderboard must show kursi24.uz with 0 clicks, not BilimON's historical 2.
    board = await getLeaderboard();
    expect(board[0]).toMatchObject({ ownerName: 'kursi24.uz', clickCount: 0 });

    // The word page must agree.
    let word = await getWordByNormalized('education');
    expect(word!.currentOwnership!.clickCount).toBe(0);
    expect(word!.currentOwnership!.owner.name).toBe('kursi24.uz');

    // kursi24.uz then receives 5 clicks of its own.
    const kursi24OwnershipId = word!.currentOwnership!.id;
    for (let i = 0; i < 5; i++) {
      await recordClick({
        ownershipId: kursi24OwnershipId,
        wordId: bilimon.word.id,
        ip: `3.3.3.${i}`,
        userAgent: CHROME,
      });
    }

    board = await getLeaderboard();
    expect(board[0]).toMatchObject({ ownerName: 'kursi24.uz', clickCount: 5 });

    word = await getWordByNormalized('education');
    expect(word!.currentOwnership!.clickCount).toBe(5);

    // BilimON's historical ownership still shows exactly its own 2 clicks — never destroyed,
    // never bled into kursi24's count.
    const bilimonHistory = await db.ownership.findUniqueOrThrow({
      where: { id: bilimonOwnershipId },
    });
    expect(bilimonHistory.clickCount).toBe(2);
    expect(bilimonHistory.endedAt).not.toBeNull();

    const history = word!.ownerships;
    expect(history).toHaveLength(2);
    const bilimonPeriod = history.find((h) => h.owner.name === 'BilimON');
    const kursi24Period = history.find((h) => h.owner.name === 'kursi24.uz');
    expect(bilimonPeriod).toBeDefined();
    expect(kursi24Period).toBeDefined();
  });

  it('a third takeover also starts at 0 and does not touch earlier periods', async () => {
    const first = await claim('coding', 'DevX', 1000, 'e1');
    const firstOwnershipId = (
      await db.word.findUniqueOrThrow({
        where: { id: first.word.id },
        include: { currentOwnership: true },
      })
    ).currentOwnership!.id;
    await recordClick({
      ownershipId: firstOwnershipId,
      wordId: first.word.id,
      ip: '1.1.1.1',
      userAgent: CHROME,
    });

    const second = await claim('coding', 'CodeAI', 2000, 'e2');
    const secondOwnershipId = (
      await db.word.findUniqueOrThrow({
        where: { id: second.word.id },
        include: { currentOwnership: true },
      })
    ).currentOwnership!.id;
    await recordClick({
      ownershipId: secondOwnershipId,
      wordId: second.word.id,
      ip: '2.2.2.2',
      userAgent: CHROME,
    });
    await recordClick({
      ownershipId: secondOwnershipId,
      wordId: second.word.id,
      ip: '3.3.3.3',
      userAgent: CHROME,
    });

    await claim('coding', 'BuildX', 3000, 'e3');
    const board = await getLeaderboard();
    expect(board[0]).toMatchObject({ ownerName: 'BuildX', clickCount: 0 });

    expect((await db.ownership.findUniqueOrThrow({ where: { id: firstOwnershipId } })).clickCount).toBe(
      1,
    );
    expect(
      (await db.ownership.findUniqueOrThrow({ where: { id: secondOwnershipId } })).clickCount,
    ).toBe(2);
  });
});
