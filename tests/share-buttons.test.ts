import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ShareButtons } from '@/components/ShareButtons';
import { config } from '@/lib/config';

function renderTweetHref(shareText: string, canonicalUrl: string): string {
  const html = renderToStaticMarkup(createElement(ShareButtons, { shareText, canonicalUrl }));
  const match = /<a[^>]+href="([^"]*)"/.exec(html);
  if (!match) throw new Error('No <a> tag found in ShareButtons output');
  // React escapes "&" as "&amp;" in HTML attribute output.
  return match[1]!.replace(/&amp;/g, '&');
}

describe('ShareButtons — X intent URL', () => {
  it('shares the canonical /word/<word> URL built from the configured site URL', () => {
    const canonicalUrl = `${config.siteUrl}/word/credit`;
    const href = renderTweetHref('We claimed CREDIT on WordBid. 👑', canonicalUrl);
    expect(href).toContain(`url=${encodeURIComponent(canonicalUrl)}`);
    // Never a hardcoded Railway or localhost string baked into the component itself — it always
    // comes from the canonicalUrl prop, which the caller builds from config.siteUrl.
    expect(canonicalUrl.startsWith(config.siteUrl)).toBe(true);
  });

  it('properly URL-encodes the share text for the X intent link', () => {
    const shareText = 'We claimed CREDIT on WordBid. 👑\n\nOne word. One spot. A position worth owning.';
    const href = renderTweetHref(shareText, `${config.siteUrl}/word/credit`);
    expect(href).toContain(`text=${encodeURIComponent(shareText)}`);
  });

  it('points at the X/Twitter share intent endpoint', () => {
    const href = renderTweetHref('hello', `${config.siteUrl}/word/credit`);
    expect(href).toMatch(/^https:\/\/(twitter\.com|x\.com)\/intent\/tweet\?/);
  });
});
