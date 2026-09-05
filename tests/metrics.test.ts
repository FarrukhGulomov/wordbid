import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { confirmPayment } from '@/lib/ownership';
import { recordClick } from '@/lib/clicks';
import { db, resetDb, seedPendingPayment } from './helpers';

beforeEach(resetDb);
afterAll(async () => {
  await db.$disconnect();
});

/** getMetrics reads the module-level prisma client, which points at the test database here. */
async function metrics() {
  const { getMetrics } = await import('@/lib/metrics');
  return getMetrics();
}

async function claim(word: string, brand: string, amountCents: number, eventId: string, url?: string) {
  const seeded = await seedPendingPayment({ word, brand, amountCents, url });
  await confirmPayment('mock', eventId, seeded.payment.providerReference, db);
  return seeded;
}

describe('getMetrics', () => {
  it('reports zeroes on an empty database', async () => {
    expect(await metrics()).toMatchObject({
      claimedWords: 0,
      revenueCents: 0,
      takeovers: 0,
      repeatBuyers: 0,
      outboundClicks: 0,
    });
  });

  it('counts revenue from confirmed payments only', async () => {
    await claim('ai', 'AcmeAI', 5000, 'e1');
    // A pending payment is not revenue.
    await seedPendingPayment({ word: 'video', brand: 'Ghost', amountCents: 999999 });

    const result = await metrics();
    expect(result.revenueCents).toBe(5000);
    expect(result.confirmedPayments).toBe(1);
    expect(result.claimedWords).toBe(1);
  });

  it('counts every ownership after the first on a word as a takeover', async () => {
    await claim('coding', 'DevX', 1000, 'e1');
    await claim('coding', 'CodeAI', 2000, 'e2');
    await claim('coding', 'BuildX', 3000, 'e3');
    await claim('ai', 'AcmeAI', 1000, 'e4');

    const result = await metrics();
    expect(result.claimedWords).toBe(2);
    expect(result.payingOwners).toBe(4);
    expect(result.takeovers).toBe(2);
    expect(result.revenueCents).toBe(7000);
    expect(result.averageOwnershipValueCents).toBe(1750);
  });

  it('counts a brand that bought twice as a repeat buyer', async () => {
    await claim('ai', 'DevX', 1000, 'e1', 'https://devx.example');
    await claim('coding', 'DevX', 1000, 'e2', 'https://devx.example');
    await claim('video', 'Other', 1000, 'e3', 'https://other.example');

    expect((await metrics()).repeatBuyers).toBe(1);
  });

  it('counts only valid outbound clicks', async () => {
    const { word } = await claim('coding', 'DevX', 1000, 'e1');
    const owned = await db.word.findUniqueOrThrow({
      where: { id: word.id },
      include: { currentOwnership: true },
    });
    const args = {
      ownershipId: owned.currentOwnership!.id,
      wordId: owned.id,
      userAgent: 'Mozilla/5.0 Chrome/126',
    };
    await recordClick({ ...args, ip: '1.1.1.1' });
    await recordClick({ ...args, ip: '1.1.1.1' }); // deduped
    await recordClick({ ...args, ip: '2.2.2.2' });
    await recordClick({ ...args, ip: '3.3.3.3', userAgent: 'Googlebot/2.1' }); // bot

    expect((await metrics()).outboundClicks).toBe(2);
  });
});
