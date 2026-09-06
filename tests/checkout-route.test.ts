import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { POST } from '@/app/api/checkout/route';
import { db, resetDb } from './helpers';

beforeEach(resetDb);
afterAll(async () => {
  await db.$disconnect();
});

let ipCounter = 0;
/** A fresh checkout POST with its own IP, so the per-IP rate limiter never interferes. */
function checkout(body: Record<string, unknown>) {
  ipCounter += 1;
  return POST(
    new Request('http://localhost/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.1.2.${ipCounter}` },
      body: JSON.stringify(body),
    }),
  );
}

describe('POST /api/checkout — owner identity', () => {
  it('reuses the same Owner row for the same domain across separate checkouts', async () => {
    const first = await checkout({
      word: 'ai',
      brandName: 'AcmeAI',
      url: 'https://devx.com',
      amountCents: 1000,
      description: 'First checkout',
    });
    expect(first.status).toBe(200);

    const second = await checkout({
      word: 'coding',
      brandName: 'AcmeAI',
      url: 'https://devx.com',
      amountCents: 1000,
      description: 'Second checkout',
    });
    expect(second.status).toBe(200);

    expect(await db.owner.count()).toBe(1);
    const payments = await db.payment.findMany({ include: { owner: true } });
    expect(payments).toHaveLength(2);
    expect(payments[0]!.ownerId).toBe(payments[1]!.ownerId);
  });

  it('treats "www.devx.com" and "devx.com" as the same brand', async () => {
    await checkout({
      word: 'ai',
      brandName: 'AcmeAI',
      url: 'https://www.devx.com',
      amountCents: 1000,
      description: 'x',
    });
    await checkout({
      word: 'coding',
      brandName: 'AcmeAI',
      url: 'https://devx.com',
      amountCents: 1000,
      description: 'x',
    });

    expect(await db.owner.count()).toBe(1);
  });

  it('keeps distinct domains as distinct owners', async () => {
    await checkout({
      word: 'ai',
      brandName: 'AcmeAI',
      url: 'https://acme.example',
      amountCents: 1000,
      description: 'x',
    });
    await checkout({
      word: 'video',
      brandName: 'VideoX',
      url: 'https://videox.example',
      amountCents: 1000,
      description: 'x',
    });

    expect(await db.owner.count()).toBe(2);
  });

  it('refuses a checkout for a domain that was blocked, before any payment is created', async () => {
    await db.owner.create({
      data: { domain: 'banned.example', name: 'Banned', url: 'https://banned.example', blocked: true },
    });

    const response = await checkout({
      word: 'robot',
      brandName: 'Banned',
      url: 'https://banned.example',
      amountCents: 1000,
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toMatch(/suspended/i);
    expect(await db.payment.count()).toBe(0);
  });

  it('never overwrites an existing Owner\'s name or description from an unauthenticated checkout', async () => {
    await checkout({
      word: 'ai',
      brandName: 'Acme',
      url: 'https://devx.com',
      amountCents: 1000,
      description: 'Old description',
    });
    // Nothing proves this second checkout is submitted by the same brand — anyone can type
    // "devx.com" into the form. It must reuse the existing Owner row, not rewrite its identity.
    const second = await checkout({
      word: 'coding',
      brandName: 'Acme Rebranded',
      url: 'https://devx.com',
      amountCents: 1000,
      description: 'New description',
    });
    expect(second.status).toBe(200);

    const owner = await db.owner.findUniqueOrThrow({ where: { domain: 'devx.com' } });
    expect(owner.name).toBe('Acme');
    expect(owner.description).toBe('Old description');
  });

  it('never overwrites an existing Owner\'s URL or logo from an unauthenticated checkout', async () => {
    await checkout({
      word: 'ai',
      brandName: 'Acme',
      url: 'https://devx.com/original',
      amountCents: 1000,
      description: 'x',
    });
    const original = await db.owner.findUniqueOrThrow({ where: { domain: 'devx.com' } });

    await checkout({
      word: 'coding',
      brandName: 'Acme',
      url: 'https://devx.com/hijacked-path',
      amountCents: 1000,
      description: 'x',
    });

    const owner = await db.owner.findUniqueOrThrow({ where: { domain: 'devx.com' } });
    expect(owner.url).toBe(original.url);
    expect(owner.logoUrl).toBe(original.logoUrl);
  });

  it('still populates identity fields the first time a new domain checks out', async () => {
    await checkout({
      word: 'ai',
      brandName: 'BrandNew',
      url: 'https://brandnew.example',
      amountCents: 1000,
      description: 'A fresh brand',
    });

    const owner = await db.owner.findUniqueOrThrow({ where: { domain: 'brandnew.example' } });
    expect(owner.name).toBe('BrandNew');
    expect(owner.description).toBe('A fresh brand');
    expect(owner.url).toBe('https://brandnew.example/');
  });

  it('still confirms and grants ownership normally after reusing an existing Owner', async () => {
    const { confirmPayment } = await import('@/lib/ownership');
    await checkout({
      word: 'ai',
      brandName: 'Acme',
      url: 'https://devx.com',
      amountCents: 1000,
      description: 'Old description',
    });
    await checkout({
      word: 'coding',
      brandName: 'Acme Rebranded',
      url: 'https://devx.com',
      amountCents: 2000,
      description: 'New description',
    });

    const payment = await db.payment.findFirstOrThrow({ where: { wordId: (await db.word.findUniqueOrThrow({ where: { normalized: 'coding' } })).id } });
    const result = await confirmPayment('mock', 'evt-1', payment.providerReference, db);
    expect(result.outcome).toBe('won');

    const word = await db.word.findUniqueOrThrow({ where: { normalized: 'coding' } });
    expect(word.valueCents).toBe(2000);
  });
});
