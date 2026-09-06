import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { POST as checkout } from '@/app/api/checkout/route';
import { POST as boost } from '@/app/api/boost/route';
import { confirmPayment } from '@/lib/ownership';
import { db, resetDb } from './helpers';

beforeEach(resetDb);
afterAll(async () => {
  await db.$disconnect();
});

let ipCounter = 0;
function post(handler: typeof checkout, path: string, body: Record<string, unknown>) {
  ipCounter += 1;
  return handler(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.2.0.${ipCounter}` },
      body: JSON.stringify(body),
    }),
  );
}

/** Claims a word for a brand and confirms the payment, returning the resulting word/owner. */
async function claimWord(word: string, brandName: string, url: string, amountCents: number) {
  const res = await post(checkout, '/api/checkout', { word, brandName, url, amountCents });
  expect(res.status).toBe(200);
  const { paymentId } = await res.json();
  const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const result = await confirmPayment('mock', `evt_${paymentId}`, payment.providerReference, db);
  expect(result.outcome).toBe('won');
  return db.word.findUniqueOrThrow({
    where: { normalized: word },
    include: { currentOwnership: { include: { owner: true } } },
  });
}

describe('POST /api/boost', () => {
  it('refuses to boost a word nobody owns', async () => {
    const res = await post(boost, '/api/boost', { word: 'nobody-owns-this', targetValueCents: 5000 });
    expect(res.status).toBe(400);
    expect(await db.payment.count()).toBe(0);
  });

  it('refuses to boost a word that exists but has no confirmed owner yet', async () => {
    // A pending checkout creates the Word row without ever confirming a payment.
    await post(checkout, '/api/checkout', {
      word: 'unclaimed',
      brandName: 'Ghost',
      url: 'https://ghost.example',
      amountCents: 1000,
    });

    const res = await post(boost, '/api/boost', { word: 'unclaimed', targetValueCents: 5000 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/not owned/i);
    expect(await db.payment.count({ where: { kind: 'BOOST' } })).toBe(0);
  });

  it('rejects a target below the minimum step and reports the live minimum', async () => {
    await claimWord('ai', 'AcmeAI', 'https://acme.example', 1000);

    const res = await post(boost, '/api/boost', { word: 'ai', targetValueCents: 1010 });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.minimumBoostTargetCents).toBe(1050); // 1000 + 5%
    expect(await db.payment.count({ where: { kind: 'BOOST' } })).toBe(0);
  });

  it('creates a BOOST payment for only the difference, attributed to the current owner', async () => {
    const word = await claimWord('ai', 'AcmeAI', 'https://acme.example', 1000);

    const res = await post(boost, '/api/boost', { word: 'ai', targetValueCents: 1500 });
    expect(res.status).toBe(200);
    const { paymentId } = await res.json();

    const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.kind).toBe('BOOST');
    expect(payment.amountCents).toBe(500); // 1500 - 1000, never the full 1500
    expect(payment.ownerId).toBe(word.currentOwnership!.ownerId);
    expect(payment.baselineValueCents).toBe(1000);
  });

  it('never lets the request choose which owner the boost is attributed to', async () => {
    // Even though checkout accepts an arbitrary brand/url, /api/boost takes no such input at
    // all — the owner is always looked up server-side from the word's live current ownership.
    const word = await claimWord('ai', 'AcmeAI', 'https://acme.example', 1000);

    const res = await post(boost, '/api/boost', {
      word: 'ai',
      targetValueCents: 1500,
      // Even if a caller tried to smuggle in an owner-ish field, the schema only reads
      // `word` and `targetValueCents` — anything else is ignored.
      brandName: 'Impostor',
      url: 'https://impostor.example',
    });
    expect(res.status).toBe(200);
    const { paymentId } = await res.json();
    const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.ownerId).toBe(word.currentOwnership!.ownerId);
    expect(await db.owner.count()).toBe(1); // no second Owner row was created
  });

  it('refuses a boost for a suspended brand', async () => {
    const word = await claimWord('ai', 'AcmeAI', 'https://acme.example', 1000);
    await db.owner.update({ where: { id: word.currentOwnership!.ownerId }, data: { blocked: true } });

    const res = await post(boost, '/api/boost', { word: 'ai', targetValueCents: 1500 });
    expect(res.status).toBe(403);
    expect(await db.payment.count({ where: { kind: 'BOOST' } })).toBe(0);
  });

  it('applying the boost payment raises the real word value, not just the target shown at checkout', async () => {
    await claimWord('ai', 'AcmeAI', 'https://acme.example', 1000);
    const res = await post(boost, '/api/boost', { word: 'ai', targetValueCents: 1500 });
    const { paymentId } = await res.json();
    const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });

    const result = await confirmPayment('mock', 'evt_boost', payment.providerReference, db);
    expect(result).toMatchObject({ outcome: 'boosted', newValueCents: 1500 });

    const word = await db.word.findUniqueOrThrow({ where: { normalized: 'ai' } });
    expect(word.valueCents).toBe(1500);
  });
});
