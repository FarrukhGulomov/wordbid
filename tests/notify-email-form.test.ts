import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NotifyEmailForm } from '@/components/NotifyEmailForm';

async function noop() {}

function render(currentEmail: string | null) {
  return renderToStaticMarkup(
    createElement(NotifyEmailForm, {
      action: noop,
      paymentId: 'payment_123',
      currentEmail,
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

  it('shows the saved email and an update action once one is on file', () => {
    const html = render('founder@acme.example');
    expect(html).toContain('founder@acme.example');
    expect(html).toContain('UPDATE');
    expect(html).not.toContain('Optional');
  });
});
