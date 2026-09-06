import { describe, expect, it } from 'vitest';
import { parseSiteMetadata, fetchSiteMetadata } from '@/lib/site-metadata';

describe('parseSiteMetadata', () => {
  it('prefers og:description over the plain meta description', () => {
    const html = `<html><head>
      <meta name="description" content="The plain SEO description.">
      <meta property="og:description" content="The curated share description.">
    </head></html>`;
    expect(parseSiteMetadata(html).description).toBe('The curated share description.');
  });

  it('falls back to the plain meta description when og:description is absent', () => {
    const html = `<html><head><meta name="description" content="Only the plain one."></head></html>`;
    expect(parseSiteMetadata(html).description).toBe('Only the plain one.');
  });

  it('returns null when no description tag exists at all', () => {
    const html = `<html><head><title>Just a title</title></head></html>`;
    expect(parseSiteMetadata(html).description).toBeNull();
  });

  it('rejects an empty or whitespace-only description as null, never a blank string', () => {
    expect(parseSiteMetadata(`<meta property="og:description" content="">`).description).toBeNull();
    expect(parseSiteMetadata(`<meta property="og:description" content="   ">`).description).toBeNull();
  });

  it('bounds an excessively long description to a reasonable maximum, with an ellipsis', () => {
    const long = 'x'.repeat(500);
    const html = `<meta property="og:description" content="${long}">`;
    const description = parseSiteMetadata(html).description;
    expect(description).not.toBeNull();
    expect(description!.length).toBeLessThanOrEqual(160);
    expect(description!.endsWith('…')).toBe(true);
  });

  it('normalizes internal whitespace (newlines/tabs/repeated spaces) to single spaces', () => {
    const html = `<meta property="og:description" content="Line one\n\t  Line   two">`;
    expect(parseSiteMetadata(html).description).toBe('Line one Line two');
  });

  it('decodes HTML entities in the extracted text', () => {
    const html = `<meta property="og:description" content="Tools &amp; services for makers">`;
    expect(parseSiteMetadata(html).description).toBe('Tools & services for makers');
  });

  it('strips markup out of the extracted text instead of preserving it', () => {
    const html = `<meta property="og:description" content="Great <b>tools</b> for makers">`;
    const description = parseSiteMetadata(html).description;
    expect(description).not.toContain('<b>');
    expect(description).not.toContain('</b>');
    expect(description).toBe('Great tools for makers');
  });

  it('strips tag delimiters revealed by decoding entities, so no tag survives even encoded', () => {
    const html = `<meta property="og:description" content="Safe text &lt;script&gt;alert(1)&lt;/script&gt; after">`;
    const description = parseSiteMetadata(html).description;
    // The tag delimiters never survive as real "<"/">" characters — what's left is inert text,
    // never markup, so it can never execute regardless of how it's later rendered.
    expect(description).not.toContain('<script>');
    expect(description).not.toContain('</script>');
    expect(description).toBe('Safe text alert(1) after');
  });
});

describe('fetchSiteMetadata', () => {
  it('never throws and returns nulls for a destination that cannot be reached', async () => {
    // .invalid is reserved by RFC 2606 to never resolve — deterministic across any environment,
    // with or without outbound internet access, so this never flakes.
    const result = await fetchSiteMetadata('https://nonexistent-brand-xyz.invalid');
    expect(result).toEqual({ title: null, description: null });
  });

  it('returns nulls immediately for a destination validateDestinationUrl rejects', async () => {
    const result = await fetchSiteMetadata('http://localhost:9999');
    expect(result).toEqual({ title: null, description: null });
  });
});
