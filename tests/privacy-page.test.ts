import { describe, expect, it, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// F14: no privacy page existed at all before this. These tests exist mainly to keep its two
// data-driven branches (contact info with/without an operator-configured SUPPORT_EMAIL) honest —
// it must never fabricate a contact address that isn't actually configured anywhere.
describe('PrivacyPage', () => {
  const original = process.env.SUPPORT_EMAIL;
  afterEach(() => {
    if (original === undefined) delete process.env.SUPPORT_EMAIL;
    else process.env.SUPPORT_EMAIL = original;
  });

  async function render() {
    const { default: PrivacyPage } = await import('@/app/privacy/page');
    return renderToStaticMarkup(createElement(PrivacyPage));
  }

  it('never fabricates a contact address when none is configured', async () => {
    delete process.env.SUPPORT_EMAIL;
    const html = await render();
    expect(html).not.toContain('mailto:');
    expect(html).toContain('whoever operates this deployment');
  });

  it('shows a real mailto link once an operator configures SUPPORT_EMAIL', async () => {
    process.env.SUPPORT_EMAIL = 'privacy@example.com';
    const html = await render();
    expect(html).toContain('mailto:privacy@example.com');
  });

  it('accurately describes IP handling — a hash is stored, never the raw address', async () => {
    const html = await render();
    expect(html).toContain('salted cryptographic hash');
    expect(html).toMatch(/never your raw IP address/);
  });
});
