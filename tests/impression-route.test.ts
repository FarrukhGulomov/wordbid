import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { POST } from '@/app/api/impression/route';
import { confirmPayment } from '@/lib/ownership';
import { db, resetDb, seedPendingPayment } from './helpers';

beforeEach(resetDb);
afterAll(async () => {
  await db.$disconnect();
});

const CHROME = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126 Safari/537.36';

async function claim(word: string, brand: string) {
  const seeded = await seedPendingPayment({ word, brand, amountCents: 1000 });
  await confirmPayment('mock', `evt_${word}`, seeded.payment.providerReference, db);
  const withOwnership = await db.word.findUniqueOrThrow({
    where: { id: seeded.word.id },
    include: { currentOwnership: true },
  });
  return withOwnership.currentOwnership!.id;
}

let ipCounter = 0;
function impression(words: string[], opts: { userAgent?: string; ip?: string } = {}) {
  ipCounter += 1;
  return POST(
    new Request('http://localhost/api/impression', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'user-agent': opts.userAgent ?? CHROME,
        'x-forwarded-for': opts.ip ?? `10.3.4.${ipCounter}`,
      },
      body: JSON.stringify({ words }),
    }),
  );
}

describe('POST /api/impression', () => {
  it('records an impression for a currently-owned word', async () => {
    const ownershipId = await claim('ai', 'AcmeAI');
    const response = await impression(['ai']);

    expect(response.status).toBe(204);
    expect((await db.ownership.findUniqueOrThrow({ where: { id: ownershipId } })).impressionCount).toBe(1);
  });

  it('records one impression per word in a batch', async () => {
    const a = await claim('ai', 'AcmeAI');
    const b = await claim('coding', 'DevX');

    await impression(['ai', 'coding']);

    expect((await db.ownership.findUniqueOrThrow({ where: { id: a } })).impressionCount).toBe(1);
    expect((await db.ownership.findUniqueOrThrow({ where: { id: b } })).impressionCount).toBe(1);
  });

  it('never records an impression for a bot user agent', async () => {
    const ownershipId = await claim('ai', 'AcmeAI');
    const response = await impression(['ai'], { userAgent: 'Googlebot/2.1' });

    expect(response.status).toBe(204);
    expect((await db.ownership.findUniqueOrThrow({ where: { id: ownershipId } })).impressionCount).toBe(0);
  });

  it('rejects a malformed body without throwing', async () => {
    const response = await POST(
      new Request('http://localhost/api/impression', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'user-agent': CHROME },
        body: 'not json',
      }),
    );
    expect(response.status).toBe(204);
  });

  it('caps impression requests per IP', async () => {
    await claim('ai', 'AcmeAI');
    const ip = '7.7.7.7';
    const statuses: number[] = [];
    for (let i = 0; i < 35; i++) {
      const res = await impression(['ai'], { ip });
      statuses.push(res.status);
    }
    // All still 204 (rate limiting is silent), but the underlying count must have been capped.
    expect(statuses.every((s) => s === 204)).toBe(true);
    const ownership = await db.ownership.findFirst({ where: { word: { normalized: 'ai' } } });
    expect(ownership!.impressionCount).toBeLessThanOrEqual(30);
  });
});
