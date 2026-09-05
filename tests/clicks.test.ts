import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { confirmPayment } from '@/lib/ownership';
import { recordClick, looksLikeBot, visitorHash } from '@/lib/clicks';
import { db, resetDb, seedPendingPayment } from './helpers';

beforeEach(resetDb);
afterAll(async () => {
  await db.$disconnect();
});

async function ownedWord(word: string, brand: string, eventId: string) {
  const seeded = await seedPendingPayment({ word, brand, amountCents: 1000 });
  await confirmPayment('mock', eventId, seeded.payment.providerReference, db);
  return db.word.findUniqueOrThrow({
    where: { id: seeded.word.id },
    include: { currentOwnership: true },
  });
}

const CHROME = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126 Safari/537.36';

describe('visitorHash', () => {
  it('is stable for the same visitor and different for others', () => {
    expect(visitorHash('1.2.3.4', CHROME)).toBe(visitorHash('1.2.3.4', CHROME));
    expect(visitorHash('1.2.3.4', CHROME)).not.toBe(visitorHash('5.6.7.8', CHROME));
  });

  it('never contains the raw IP', () => {
    expect(visitorHash('1.2.3.4', CHROME)).not.toContain('1.2.3.4');
  });
});

describe('looksLikeBot', () => {
  it('flags crawlers and scripted clients', () => {
    expect(looksLikeBot('Googlebot/2.1')).toBe(true);
    expect(looksLikeBot('curl/8.0')).toBe(true);
    expect(looksLikeBot('python-requests/2.31')).toBe(true);
    expect(looksLikeBot('HeadlessChrome/126')).toBe(true);
    expect(looksLikeBot('')).toBe(true);
  });

  it('allows ordinary browsers', () => {
    expect(looksLikeBot(CHROME)).toBe(false);
  });
});

describe('recordClick', () => {
  it('counts a genuine click on the word and the ownership', async () => {
    const word = await ownedWord('coding', 'DevX', 'e1');
    const counted = await recordClick({
      ownershipId: word.currentOwnership!.id,
      wordId: word.id,
      ip: '1.2.3.4',
      userAgent: CHROME,
    });

    expect(counted).toBe(true);
    expect((await db.word.findUniqueOrThrow({ where: { id: word.id } })).clickCount).toBe(1);
    expect(
      (await db.ownership.findUniqueOrThrow({ where: { id: word.currentOwnership!.id } })).clickCount,
    ).toBe(1);
  });

  it('does not let one visitor inflate the count inside the dedupe window', async () => {
    const word = await ownedWord('coding', 'DevX', 'e1');
    const args = {
      ownershipId: word.currentOwnership!.id,
      wordId: word.id,
      ip: '1.2.3.4',
      userAgent: CHROME,
    };

    expect(await recordClick(args)).toBe(true);
    expect(await recordClick(args)).toBe(false);
    expect(await recordClick(args)).toBe(false);

    expect((await db.word.findUniqueOrThrow({ where: { id: word.id } })).clickCount).toBe(1);
    // Every attempt is still stored, just marked invalid.
    expect(await db.click.count()).toBe(3);
    expect(await db.click.count({ where: { valid: true } })).toBe(1);
  });

  it('counts different visitors separately', async () => {
    const word = await ownedWord('coding', 'DevX', 'e1');
    const base = { ownershipId: word.currentOwnership!.id, wordId: word.id, userAgent: CHROME };

    expect(await recordClick({ ...base, ip: '1.1.1.1' })).toBe(true);
    expect(await recordClick({ ...base, ip: '2.2.2.2' })).toBe(true);
    expect((await db.word.findUniqueOrThrow({ where: { id: word.id } })).clickCount).toBe(2);
  });

  it('never counts bots publicly', async () => {
    const word = await ownedWord('coding', 'DevX', 'e1');
    expect(
      await recordClick({
        ownershipId: word.currentOwnership!.id,
        wordId: word.id,
        ip: '1.2.3.4',
        userAgent: 'Googlebot/2.1',
      }),
    ).toBe(false);
    expect((await db.word.findUniqueOrThrow({ where: { id: word.id } })).clickCount).toBe(0);
  });

  it('attributes clicks to the ownership that was live at click time', async () => {
    const word = await ownedWord('coding', 'DevX', 'e1');
    const firstOwnership = word.currentOwnership!.id;
    await recordClick({ ownershipId: firstOwnership, wordId: word.id, ip: '1.1.1.1', userAgent: CHROME });

    // A competitor takes the word.
    const taken = await seedPendingPayment({ word: 'coding', brand: 'CodeAI', amountCents: 2000 });
    await confirmPayment('mock', 'e2', taken.payment.providerReference, db);
    const after = await db.word.findUniqueOrThrow({
      where: { id: word.id },
      include: { currentOwnership: true },
    });
    await recordClick({
      ownershipId: after.currentOwnership!.id,
      wordId: word.id,
      ip: '1.1.1.1',
      userAgent: CHROME,
    });

    // Each period keeps its own clicks; the word total is cumulative.
    expect((await db.ownership.findUniqueOrThrow({ where: { id: firstOwnership } })).clickCount).toBe(1);
    expect(
      (await db.ownership.findUniqueOrThrow({ where: { id: after.currentOwnership!.id } })).clickCount,
    ).toBe(1);
    expect((await db.word.findUniqueOrThrow({ where: { id: word.id } })).clickCount).toBe(2);
  });
});
