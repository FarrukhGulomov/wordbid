import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { confirmPayment } from '@/lib/ownership';
import { db, resetDb, seedPendingPayment, seedBoostPayment } from './helpers';

beforeEach(resetDb);
afterAll(async () => {
  await db.$disconnect();
});

/** setOwnerNotifyEmail reads/writes the module-level prisma client, same as getMetrics — see
 * tests/metrics.test.ts's comment. Both point at the same test database as `db` here. */
async function setOwnerNotifyEmail(paymentId: string, email: string) {
  const { setOwnerNotifyEmail } = await import('@/lib/notify-email');
  return setOwnerNotifyEmail(paymentId, email);
}

describe('setOwnerNotifyEmail', () => {
  it('saves the email once the payment has actually confirmed', async () => {
    const { payment, owner } = await seedPendingPayment({ word: 'ai', brand: 'Acme', amountCents: 1000 });
    await confirmPayment('mock', 'e1', payment.providerReference, db);

    const result = await setOwnerNotifyEmail(payment.id, 'founder@acme.example');
    expect(result.outcome).toBe('saved');

    const updated = await db.owner.findUniqueOrThrow({ where: { id: owner.id } });
    expect(updated.notifyEmail).toBe('founder@acme.example');
  });

  it('refuses a payment that has not confirmed yet', async () => {
    const { payment, owner } = await seedPendingPayment({ word: 'ai', brand: 'Acme', amountCents: 1000 });

    const result = await setOwnerNotifyEmail(payment.id, 'founder@acme.example');
    expect(result.outcome).toBe('not_eligible');

    const unchanged = await db.owner.findUniqueOrThrow({ where: { id: owner.id } });
    expect(unchanged.notifyEmail).toBeNull();
  });

  it('refuses a BOOST payment — a notice is only ever about a takeover', async () => {
    const { payment, owner, word } = await seedPendingPayment({ word: 'ai', brand: 'Acme', amountCents: 1000 });
    await confirmPayment('mock', 'e1', payment.providerReference, db);
    const boost = await seedBoostPayment({ wordId: word.id, ownerId: owner.id, amountCents: 200 });
    await confirmPayment('mock', 'e2', boost.providerReference, db);

    const result = await setOwnerNotifyEmail(boost.id, 'founder@acme.example');
    expect(result.outcome).toBe('not_eligible');
  });

  it('refuses an unknown payment id rather than throwing', async () => {
    const result = await setOwnerNotifyEmail('does-not-exist', 'founder@acme.example');
    expect(result.outcome).toBe('not_eligible');
  });

  it('lets a later call update a previously saved email', async () => {
    const { payment, owner } = await seedPendingPayment({ word: 'ai', brand: 'Acme', amountCents: 1000 });
    await confirmPayment('mock', 'e1', payment.providerReference, db);

    await setOwnerNotifyEmail(payment.id, 'old@acme.example');
    await setOwnerNotifyEmail(payment.id, 'new@acme.example');

    const updated = await db.owner.findUniqueOrThrow({ where: { id: owner.id } });
    expect(updated.notifyEmail).toBe('new@acme.example');
  });
});
