import { describe, expect, it, vi } from 'vitest';
import { parseSiteMetadata, fetchSiteMetadata } from '@/lib/site-metadata';
import * as safeFetchModule from '@/lib/safe-fetch';

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

  // Regression: numeo.ai produced no Owner.description because its meta tags write `content`
  // BEFORE `property`/`name` — the old regex required property/name to come first in the tag,
  // so it silently matched nothing. findMetaContent scans each tag as a whole and reads its
  // attributes independently, so attribute order can never matter again.
  it('reads og:description from a numeo.ai-style tag with content before property', () => {
    const html = `<html><head>
      <meta content="Numeo helps you track and predict everything numeric." property="og:description">
    </head></html>`;
    expect(parseSiteMetadata(html).description).toBe('Numeo helps you track and predict everything numeric.');
  });

  it('reads the plain meta description with content before name', () => {
    const html = `<meta content="A plain SEO description." name="description">`;
    expect(parseSiteMetadata(html).description).toBe('A plain SEO description.');
  });

  it('still prefers og:description over meta description when both use reversed attribute order', () => {
    const html = `<html><head>
      <meta content="The plain one." name="description">
      <meta content="The curated one." property="og:description">
    </head></html>`;
    expect(parseSiteMetadata(html).description).toBe('The curated one.');
  });

  it('reads og:title with content before property, falling back to it over <title>', () => {
    const html = `<html><head>
      <title>Fallback Title</title>
      <meta content="Numeo — Track Everything" property="og:title">
    </head></html>`;
    expect(parseSiteMetadata(html).title).toBe('Numeo — Track Everything');
  });

  it('handles an unquoted content attribute', () => {
    const html = `<meta property=og:description content=Short-and-unquoted>`;
    expect(parseSiteMetadata(html).description).toBe('Short-and-unquoted');
  });

  it('is case-insensitive on the attribute name/value match', () => {
    const html = `<META CONTENT="Upper case tag and attrs." PROPERTY="OG:DESCRIPTION">`;
    expect(parseSiteMetadata(html).description).toBe('Upper case tag and attrs.');
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

  // A cheaply-hosted real site (like a small business's own domain) omitting content-type
  // entirely is common — this used to be treated the same as "definitely not HTML" and silently
  // discarded a real description that was sitting right there in the response body.
  it('still parses a response that has no content-type header at all', async () => {
    // The Response constructor synthesizes a "text/plain" content-type for a plain string body
    // when none is given — a real network response with a genuinely absent header wouldn't have
    // one at all, so the header is removed explicitly to simulate that accurately.
    const response = new Response(
      '<meta property="og:description" content="Reached with no content-type header.">',
      { status: 200 },
    );
    response.headers.delete('content-type');
    const spy = vi.spyOn(safeFetchModule, 'safeFetch').mockResolvedValue(response);

    const result = await fetchSiteMetadata('https://no-content-type.example');

    expect(result.description).toBe('Reached with no content-type header.');
    spy.mockRestore();
  });

  it('still rejects a response whose content-type is clearly not HTML', async () => {
    const spy = vi
      .spyOn(safeFetchModule, 'safeFetch')
      .mockResolvedValue(
        new Response('{"not": "html"}', { status: 200, headers: { 'content-type': 'application/json' } }),
      );

    const result = await fetchSiteMetadata('https://json-response.example');

    expect(result).toEqual({ title: null, description: null });
    spy.mockRestore();
  });

  // The real bug this session investigated could never have been diagnosed with a bare `catch {}`
  // — every distinct failure mode looked identical from the outside. This proves the real error
  // reaches the logs instead of vanishing.
  it('logs the real failure reason instead of swallowing it silently', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(safeFetchModule, 'safeFetch').mockRejectedValue(new Error('socket hang up'));

    const result = await fetchSiteMetadata('https://flaky-host.example');

    expect(result).toEqual({ title: null, description: null });
    expect(errorSpy).toHaveBeenCalled();
    const logged = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).toContain('flaky-host.example');
    expect(logged).toContain('socket hang up');

    fetchSpy.mockRestore();
    errorSpy.mockRestore();
  });

  // Regression for the real uzum.uz bug: Node's fetch wraps every low-level network failure in a
  // generic `TypeError: fetch failed`, with the actual reason (DNS, TLS, connection reset) nested
  // in `.cause`. The previous fix only logged `err.message`, so production logs showed the same
  // useless "fetch failed" for uzum.uz that a bare `catch {}` would have — the diagnostic gap was
  // never actually closed. This proves the nested cause is unwrapped into the log line.
  it('unwraps a nested fetch-failed cause instead of logging the generic wrapper message', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    const wrapped = Object.assign(new TypeError('fetch failed'), { cause });
    const fetchSpy = vi.spyOn(safeFetchModule, 'safeFetch').mockRejectedValue(wrapped);

    const result = await fetchSiteMetadata('https://uzum.uz');

    expect(result).toEqual({ title: null, description: null });
    const logged = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).toContain('uzum.uz');
    expect(logged).toContain('fetch failed');
    expect(logged).toContain('ECONNRESET');
    expect(logged).toContain('read ECONNRESET');

    fetchSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe('fetchSiteMetadata — redirect handling', () => {
  it('follows a safe redirect to its validated target and reads metadata from there', async () => {
    const spy = vi.spyOn(safeFetchModule, 'safeFetch');
    spy
      .mockImplementationOnce(async () =>
        new Response(null, { status: 301, headers: { location: 'https://redirected-target.example/' } }),
      )
      .mockImplementationOnce(
        async () =>
          new Response('<meta property="og:description" content="Reached after redirect.">', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
      );

    const result = await fetchSiteMetadata('https://original-domain.example');

    expect(result.description).toBe('Reached after redirect.');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1]![0]).toBe('https://redirected-target.example/');
    spy.mockRestore();
  });

  it('never fetches a redirect target that fails SSRF/public-URL validation', async () => {
    const spy = vi.spyOn(safeFetchModule, 'safeFetch');
    spy.mockImplementationOnce(
      async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/internal-admin' } }),
    );

    const result = await fetchSiteMetadata('https://looks-safe-but-redirects.example');

    // Exactly one call — the unsafe target is never fetched, only checked and rejected.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ title: null, description: null });
    spy.mockRestore();
  });

  it('rejects a redirect to a non-http(s) target the same way', async () => {
    const spy = vi.spyOn(safeFetchModule, 'safeFetch');
    spy.mockImplementationOnce(
      async () => new Response(null, { status: 302, headers: { location: 'file:///etc/passwd' } }),
    );

    const result = await fetchSiteMetadata('https://redirects-to-file.example');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ title: null, description: null });
    spy.mockRestore();
  });

  it('stops after a bounded number of redirects instead of following an endless chain', async () => {
    const spy = vi.spyOn(safeFetchModule, 'safeFetch').mockImplementation(async (url) => {
      const n = Number(String(url).match(/hop(\d+)/)?.[1] ?? '0');
      return new Response(null, { status: 302, headers: { location: `https://chain.example/hop${n + 1}` } });
    });

    const result = await fetchSiteMetadata('https://chain.example/hop0');

    expect(result).toEqual({ title: null, description: null });
    // One initial call plus at most MAX_REDIRECTS follow-ups — never unbounded.
    expect(spy.mock.calls.length).toBeLessThanOrEqual(5);
    spy.mockRestore();
  });
});
