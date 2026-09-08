import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { confirmPayment } from '@/lib/ownership';
import { maskEmailForDisplay } from '@/lib/notify-email';
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

// F04: Owner.notifyEmail is scoped to a domain string nobody ever verifies control of — two
// unrelated buyers can both submit the same domain and land on the same Owner row. maskEmailForDisplay
// is what stops a later, unrelated buyer's confirmation page from showing a stranger's real address.
describe('maskEmailForDisplay', () => {
  it('never returns the input unchanged, and never contains the original local part or domain label', () => {
    // Single-character locals/labels are excluded below: the mask deliberately keeps the
    // first character of the local part (see the next test), so a 1-char local trivially
    // "contains itself" without that meaning anything was left unmasked.
    const cases = ['founder@acme.example', 'first.last+tag@sub.example.co.uk'];
    for (const email of cases) {
      const masked = maskEmailForDisplay(email);
      expect(masked, email).not.toBe(email);
      const [local, domain] = email.split('@');
      const domainLabel = domain!.slice(0, domain!.lastIndexOf('.'));
      expect(masked, email).not.toContain(local);
      expect(masked, email).not.toContain(domainLabel);
    }
    expect(maskEmailForDisplay('a@b.co')).not.toBe('a@b.co');
  });

  it('keeps the TLD and first character so the real owner can recognise their own address', () => {
    expect(maskEmailForDisplay('founder@acme.example')).toBe('f••••••@••••.example');
  });

  it('handles malformed input without throwing', () => {
    expect(() => maskEmailForDisplay('not-an-email')).not.toThrow();
  });
});
