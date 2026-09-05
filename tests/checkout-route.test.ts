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

  it('updates the stored name and description on a repeat checkout', async () => {
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
      amountCents: 1000,
      description: 'New description',
    });

    const owner = await db.owner.findUniqueOrThrow({ where: { domain: 'devx.com' } });
    expect(owner.name).toBe('Acme Rebranded');
    expect(owner.description).toBe('New description');
  });
});
