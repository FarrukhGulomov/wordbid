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
