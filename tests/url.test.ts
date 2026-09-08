import { describe, expect, it } from 'vitest';
import { validateDestinationUrl } from '@/lib/url';

describe('validateDestinationUrl', () => {
  it('accepts public https URLs', () => {
    const result = validateDestinationUrl('https://devx.com/pricing?ref=oti');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.host).toBe('devx.com');
  });

  it('adds https when the scheme is missing', () => {
    const result = validateDestinationUrl('devx.com');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe('https://devx.com/');
  });

  it('rejects non-http schemes', () => {
    expect(validateDestinationUrl('javascript:alert(1)').ok).toBe(false);
    expect(validateDestinationUrl('data:text/html,<h1>x').ok).toBe(false);
    expect(validateDestinationUrl('file:///etc/passwd').ok).toBe(false);
  });

  it('rejects internal and loopback hosts', () => {
    for (const host of [
      'http://localhost:3000',
      'http://127.0.0.1',
      'http://10.0.0.5',
      'http://192.168.1.1',
      'http://172.16.0.1',
      'http://169.254.169.254/latest/meta-data',
      'http://db.internal',
    ]) {
      expect(validateDestinationUrl(host).ok, host).toBe(false);
    }
  });

  // F03: the old blocklist here was a second, independently-maintained set of IPv6 regexes that
  // covered fewer literal forms than isPrivateIPv6 (safe-fetch.ts's DNS-time check) actually
  // does — so a literal IPv6 address written in a form those regexes didn't anticipate could
  // pass this text check even though the exact same address, reached via a hostname, would have
  // been refused at connection time. validateDestinationUrl now defers to the same isPrivateIPv6
  // logic for any literal IPv6 host, closing that gap.
  it('rejects internal/loopback IPv6 literals, including forms the old regex blocklist missed', () => {
    for (const host of [
      'http://[::1]',
      'http://[::]',
      'http://[fe80::1]', // link-local — the old blocklist did not check this at all
      'http://[fc00::1]',
      'http://[fd12:3456::1]',
      'http://[ff02::1]', // multicast — also unchecked by the old blocklist
      'http://[::ffff:127.0.0.1]', // IPv4-mapped loopback, dotted-quad form
      'http://[::ffff:7f00:1]', // same address, full-hex form — the exact F03 gap
      'http://[0:0:0:0:0:ffff:a9fe:a9fe]', // 169.254.169.254 mapped, fully expanded hex form
      'http://[fe80::1%eth0]', // link-local with a zone id
    ]) {
      expect(validateDestinationUrl(host).ok, host).toBe(false);
    }
  });

  it('accepts a public IPv6 literal', () => {
    const result = validateDestinationUrl('http://[2001:4860:4860::8888]');
    expect(result.ok).toBe(true);
  });

  it('rejects credentials embedded in the URL', () => {
    expect(validateDestinationUrl('https://user:pass@devx.com').ok).toBe(false);
  });

  it('rejects bare hostnames with no dot', () => {
    expect(validateDestinationUrl('http://intranet').ok).toBe(false);
  });

  it('rejects nonsense', () => {
    expect(validateDestinationUrl('').ok).toBe(false);
    expect(validateDestinationUrl('https://').ok).toBe(false);
  });
});
