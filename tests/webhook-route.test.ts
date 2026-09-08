import crypto from 'node:crypto';
import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { POST as webhook } from '@/app/api/webhooks/payments/route';
import { db, resetDb } from './helpers';

beforeEach(resetDb);
afterAll(async () => {
  await db.$disconnect();
});

function sign(body: string): string {
  const secret = process.env.MOCK_WEBHOOK_SECRET || process.env.CLICK_HASH_SALT || 'mock-secret';
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function postWebhook(payload: Record<string, unknown>) {
  const body = JSON.stringify(payload);
  return webhook(
    new Request('http://localhost/api/webhooks/payments', {
      method: 'POST',
      headers: { 'x-mock-signature': sign(body) },
      body,
    }),
  );
}

// F02: a payment_succeeded event whose reference matches no Payment row is real captured money
// with nothing on our side to apply it to. The route must not just log this and move on — it
// needs to be durably visible to a human, not lost the moment the process's console scrolls.
describe('POST /api/webhooks/payments — F02: unmatched payment events are flagged for admin review', () => {
  it('flags the WebhookEvent row with needsAttention + the provider reference', async () => {
    const res = await postWebhook({
      eventId: 'evt_ghost',
      type: 'payment_succeeded',
      reference: 'ref_does_not_exist',
      amountCents: 5000,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe('unknown_payment');

    const event = await db.webhookEvent.findUniqueOrThrow({
      where: { provider_eventId: { provider: 'mock', eventId: 'evt_ghost' } },
    });
    expect(event.needsAttention).toBe('unknown_payment');
    expect(event.providerReference).toBe('ref_does_not_exist');
  });

  it('never flags an ordinary, matched event', async () => {
    const { seedPendingPayment } = await import('./helpers');
    const { payment } = await seedPendingPayment({ word: 'ai', brand: 'Acme', amountCents: 1000 });

    const res = await postWebhook({
      eventId: 'evt_real',
      type: 'payment_succeeded',
      reference: payment.providerReference,
      amountCents: 1000,
    });
    expect(res.status).toBe(200);

    const event = await db.webhookEvent.findUniqueOrThrow({
      where: { provider_eventId: { provider: 'mock', eventId: 'evt_real' } },
    });
    expect(event.needsAttention).toBeNull();
    expect(event.providerReference).toBeNull();
  });
});
