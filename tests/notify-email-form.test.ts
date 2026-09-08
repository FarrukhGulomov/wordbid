import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NotifyEmailForm } from '@/components/NotifyEmailForm';
import { maskEmailForDisplay } from '@/lib/notify-email';

async function noop() {}

function render(maskedCurrentEmail: string | null) {
  return renderToStaticMarkup(
    createElement(NotifyEmailForm, {
      action: noop,
      paymentId: 'payment_123',
      maskedCurrentEmail,
      wordDisplay: 'AI',
    }),
  );
}

describe('NotifyEmailForm', () => {
  it('carries the payment id as a hidden field, scoping the write to this exact payment', () => {
    const html = render(null);
    expect(html).toContain('name="paymentId"');
    expect(html).toContain('value="payment_123"');
  });

  it('invites the buyer to opt in when no email is on file yet', () => {
    const html = render(null);
    expect(html).toContain('Optional');
    expect(html).toContain('NOTIFY ME');
  });

  // F04: the previously-set email belongs to whoever last controlled Owner's unverified domain
  // identity, who may not be the current visitor — so this must never render the raw address.
  it('shows only a masked form of an existing email, never the raw address, plus an update action', () => {
    const masked = maskEmailForDisplay('founder@acme.example');
    const html = render(masked);
    expect(html).toContain(masked);
    expect(html).not.toContain('founder@acme.example');
    expect(html).toContain('UPDATE');
    expect(html).not.toContain('Optional');
  });

  it('never prefills the input with the existing (masked or raw) email — only a fresh value can be submitted', () => {
    const html = render(maskEmailForDisplay('founder@acme.example'));
    expect(html).not.toContain('value="founder@acme.example"');
    expect(html).not.toMatch(/<input[^>]*name="email"[^>]*value="[^"]+"/);
  });
});
