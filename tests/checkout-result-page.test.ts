import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { confirmPayment } from '@/lib/ownership';
import { db, resetDb, seedPendingPayment } from './helpers';

beforeEach(resetDb);
afterAll(async () => {
  await db.$disconnect();
});

async function render(paymentId: string) {
  const { default: CheckoutResultPage } = await import('@/app/checkout/result/page');
  const element = await CheckoutResultPage({ searchParams: Promise.resolve({ payment: paymentId }) });
  return renderToStaticMarkup(element as React.ReactElement);
}

// F11: payment.status stays CONFIRMED forever once set — it never reflects a LATER takeover
// that ends the ownership this exact payment created. This page must check the word's CURRENT
// ownership on every render, not just this payment's own historical status.
describe('CheckoutResultPage — F11: stale "YOU OWN" after a later takeover', () => {
  it('shows a "taken over since" state, not "YOU OWN", once someone else has taken the word', async () => {
    const first = await seedPendingPayment({ word: 'coding', brand: 'DevX', amountCents: 1000 });
    const firstResult = await confirmPayment('mock', 'e1', first.payment.providerReference, db);
    expect(firstResult.outcome).toBe('won');

    // A later, unrelated takeover — DevX's payment is untouched (still CONFIRMED) but no longer
    // describes who owns the word.
    const second = await seedPendingPayment({ word: 'coding', brand: 'FastCo', amountCents: 2000 });
    const secondResult = await confirmPayment('mock', 'e2', second.payment.providerReference, db);
    expect(secondResult.outcome).toBe('won');

    const html = await render(first.payment.id);
    expect(html).toContain('HAS A NEW OWNER');
    expect(html).not.toContain('YOU OWN');
    expect(html).not.toContain('YOU TOOK');
    expect(html).toContain('TAKE IT BACK');
  });

  it('still shows the normal success state for a payment that is still the current owner', async () => {
    const { payment } = await seedPendingPayment({ word: 'ai', brand: 'AcmeAI', amountCents: 1000 });
    const result = await confirmPayment('mock', 'e1', payment.providerReference, db);
    expect(result.outcome).toBe('won');

    const html = await render(payment.id);
    expect(html).toContain('YOU OWN');
    expect(html).not.toContain('HAS A NEW OWNER');
  });
});
