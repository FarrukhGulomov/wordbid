import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { GET } from '@/app/api/words/[word]/route';
import { confirmPayment } from '@/lib/ownership';
import { db, resetDb, seedPendingPayment } from './helpers';

beforeEach(resetDb);
afterAll(async () => {
  await db.$disconnect();
});

async function claim(word: string, brand: string, amountCents: number, eventId: string) {
  const seeded = await seedPendingPayment({ word, brand, amountCents });
  await confirmPayment('mock', eventId, seeded.payment.providerReference, db);
  return seeded.word;
}

function lookup(word: string, amount?: number) {
  const url = new URL(`http://localhost/api/words/${word}`);
  if (amount !== undefined) url.searchParams.set('amount', String(amount));
  return GET(new Request(url), { params: Promise.resolve({ word }) });
}

describe('GET /api/words/[word] — projected rank preview', () => {
  it('omits projectedRank entirely when no amount is given', async () => {
    const res = await lookup('ai');
    const body = await res.json();
    expect(body.projectedRank).toBeNull();
  });

  it('previews where an amount would rank today, for an unowned word', async () => {
    await claim('ai', 'AcmeAI', 100000, 'e1');

    const res = await lookup('coding', 200000);
    const body = await res.json();
    expect(body.owned).toBe(false);
    expect(body.projectedRank).toBe(1);

    const res2 = await lookup('coding', 50000);
    const body2 = await res2.json();
    expect(body2.projectedRank).toBe(2);
  });

  it('excludes the word\'s own current value when previewing a takeover of it', async () => {
    const word = await claim('coding', 'DevX', 100000, 'e1');
    await claim('ai', 'AcmeAI', 200000, 'e2');
    void word;

    // A 100000 bid on "coding" itself must not be pushed down by coding's own current 100000.
    const res = await lookup('coding', 100000);
    const body = await res.json();
    expect(body.owned).toBe(true);
    expect(body.projectedRank).toBe(2);
  });

  it('ignores a zero, negative or garbage amount rather than erroring', async () => {
    for (const amount of ['0', '-5', 'not-a-number']) {
      const url = new URL(`http://localhost/api/words/ai?amount=${amount}`);
      const res = await GET(new Request(url), { params: Promise.resolve({ word: 'ai' }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.projectedRank).toBeNull();
    }
  });
});
