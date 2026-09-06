import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OwnerDescription } from '@/components/OwnerDescription';

function render(description: string | null) {
  return renderToStaticMarkup(createElement(OwnerDescription, { description }));
}

describe('OwnerDescription', () => {
  it('renders the description text when present', () => {
    const html = render('AI workspace for automating customer support.');
    expect(html).toContain('AI workspace for automating customer support.');
  });

  it('renders nothing when the description is null — never a placeholder', () => {
    const html = render(null);
    expect(html).toBe('');
    expect(html).not.toMatch(/no description/i);
  });

  it('renders nothing for an empty string either', () => {
    expect(render('')).toBe('');
  });

  it('escapes the description as plain text — unsafe content is never rendered as markup', () => {
    const html = render('Nice tools <b>and</b> <script>alert(1)</script> stuff');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<script>');
    // React escapes text-node content, so the literal characters survive only as entities.
    expect(html).toContain('&lt;script&gt;');
  });
});
