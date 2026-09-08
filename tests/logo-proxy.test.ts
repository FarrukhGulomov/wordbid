import { describe, expect, it, vi, afterEach } from 'vitest';
import { GET } from '@/app/api/logo/route';
import { faviconUrlFor, displayLogoUrl } from '@/lib/url';

const call = (query: string) => GET(new Request(`http://localhost/api/logo${query}`));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('faviconUrlFor', () => {
  it('points at our own proxy, never a third party', () => {
    const url = faviconUrlFor('https://devx.com/pricing');
    expect(url).toBe('/api/logo?domain=devx.com');
    expect(url).not.toContain('google');
  });

  it('returns null for an unparseable destination', () => {
    expect(faviconUrlFor('not a url')).toBeNull();
  });
});

describe('displayLogoUrl', () => {
  it('rewrites logo URLs stored before the proxy existed', () => {
    expect(displayLogoUrl('https://www.google.com/s2/favicons?domain=devx.com&sz=64')).toBe(
      '/api/logo?domain=devx.com',
    );
  });

  it('leaves an already-proxied URL alone', () => {
    expect(displayLogoUrl('/api/logo?domain=devx.com')).toBe('/api/logo?domain=devx.com');
  });

  it('passes null through', () => {
    expect(displayLogoUrl(null)).toBeNull();
    expect(displayLogoUrl('')).toBeNull();
  });
});

describe('GET /api/logo', () => {
  it('rejects anything that is not a plausible public hostname', async () => {
    for (const q of [
      '',
      '?domain=',
      '?domain=localhost',
      '?domain=internal',
      '?domain=' + encodeURIComponent('devx.com/../../etc/passwd'),
      '?domain=' + encodeURIComponent('devx.com?x=1'),
      '?domain=' + encodeURIComponent('a'.repeat(300) + '.com'),
    ]) {
      expect((await call(q)).status, q).toBe(400);
    }
  });

  it('always fetches the fixed resolver host, whatever the caller sends', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      void input;
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await call('?domain=devx.com');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toContain('max-age=86400');

    const requested = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(requested.hostname).toBe('www.google.com');
    expect(requested.searchParams.get('domain')).toBe('devx.com');
  });

  it('reports a miss (not an image, or upstream failure) as 404 so the monogram takes over', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { headers: { 'content-type': 'text/html' } })));
    expect((await call('?domain=devx.com')).status).toBe(404);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('upstream down'); }));
    expect((await call('?domain=devx.com')).status).toBe(404);
  });
});
