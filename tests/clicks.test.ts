import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { confirmPayment } from '@/lib/ownership';
import { recordClick, looksLikeBot, visitorHash, referrerHostFrom } from '@/lib/clicks';
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

// F10: the dedupe check used to run as a plain read BEFORE recordClick's own transaction even
// started — two requests from the SAME visitor arriving close together could both see "no recent
// click yet" and both write valid:true, double-counting a click that should have deduped to one.
// Firing many real, concurrent calls for the identical (ownership, visitor) pair exercises that
// exact race: the FIX makes the outcome deterministic (always exactly one valid) regardless of
// how the calls happen to interleave, where the old code's outcome depended on timing.
describe('recordClick — F10: concurrent identical clicks never double-count', () => {
  it('exactly one of many simultaneous clicks from the same visitor counts as valid', async () => {
    const word = await ownedWord('coding', 'DevX', 'e1');
    const ownershipId = word.currentOwnership!.id;

    const CONCURRENCY = 20;
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        recordClick({ ownershipId, wordId: word.id, ip: '9.9.9.9', userAgent: CHROME }),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(1);

    const ownershipAfter = await db.ownership.findUniqueOrThrow({ where: { id: ownershipId } });
    const wordAfter = await db.word.findUniqueOrThrow({ where: { id: word.id } });
    expect(ownershipAfter.clickCount).toBe(1);
    expect(wordAfter.clickCount).toBe(1);

    const validClicks = await db.click.count({ where: { ownershipId, valid: true } });
    expect(validClicks).toBe(1);
  });
});

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

describe('referrerHostFrom', () => {
  it('extracts just the hostname from a full referring URL', () => {
    expect(referrerHostFrom('https://x.com/some/status/123?ref=abc')).toBe('x.com');
  });

  it('is "direct" for no referrer or a malformed one', () => {
    expect(referrerHostFrom(null)).toBe('direct');
    expect(referrerHostFrom('')).toBe('direct');
    expect(referrerHostFrom('not-a-url')).toBe('direct');
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

  it('stores the referring hostname, or "direct" when there is none', async () => {
    const word = await ownedWord('coding', 'DevX', 'e1');
    await recordClick({
      ownershipId: word.currentOwnership!.id,
      wordId: word.id,
      ip: '1.1.1.1',
      userAgent: CHROME,
      referrer: 'https://x.com/status/1',
    });
    await recordClick({
      ownershipId: word.currentOwnership!.id,
      wordId: word.id,
      ip: '2.2.2.2',
      userAgent: CHROME,
    });

    const clicks = await db.click.findMany({ orderBy: { createdAt: 'asc' } });
    expect(clicks[0]!.referrer).toBe('x.com');
    expect(clicks[1]!.referrer).toBe('direct');
  });

  it('adds a daily-click rollup row alongside a valid click', async () => {
    const word = await ownedWord('coding', 'DevX', 'e1');
    await recordClick({
      ownershipId: word.currentOwnership!.id,
      wordId: word.id,
      ip: '1.1.1.1',
      userAgent: CHROME,
    });

    const rows = await db.ownershipDailyStat.findMany({
      where: { ownershipId: word.currentOwnership!.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.clicks).toBe(1);
  });

  it('does not add a daily-click row for an invalid (bot) click', async () => {
    const word = await ownedWord('coding', 'DevX', 'e1');
    await recordClick({
      ownershipId: word.currentOwnership!.id,
      wordId: word.id,
      ip: '1.1.1.1',
      userAgent: 'Googlebot/2.1',
    });

    expect(await db.ownershipDailyStat.count()).toBe(0);
  });
});
