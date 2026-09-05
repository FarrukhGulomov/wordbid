import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { POST } from '@/app/api/visit/route';
import { VISITOR_COOKIE } from '@/lib/attention';
import { db, resetDb } from './helpers';

beforeEach(resetDb);
afterAll(async () => {
  await db.$disconnect();
});

const CHROME = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126 Safari/537.36';

let ipCounter = 0;
function heartbeat(opts: { userAgent?: string; cookie?: string; ip?: string } = {}) {
  ipCounter += 1;
  const headers: Record<string, string> = {
    'user-agent': opts.userAgent ?? CHROME,
    'x-forwarded-for': opts.ip ?? `10.2.3.${ipCounter}`,
  };
  if (opts.cookie) headers.cookie = `${VISITOR_COOKIE}=${opts.cookie}`;
  return POST(new Request('http://localhost/api/visit', { method: 'POST', headers }));
}

function setCookieValue(response: Response): string | undefined {
  const raw = response.headers.get('set-cookie');
  if (!raw) return undefined;
  const match = new RegExp(`${VISITOR_COOKIE}=([^;]+)`).exec(raw);
  return match?.[1];
}

describe('POST /api/visit', () => {
  it('creates a visitor and sets a cookie on first heartbeat', async () => {
    const response = await heartbeat();
    expect(response.status).toBe(204);

    const id = setCookieValue(response);
    expect(id).toBeTruthy();
    expect(await db.visitor.findUnique({ where: { id } })).not.toBeNull();
  });

  it('reuses the existing visitor when the cookie is sent back', async () => {
    const first = await heartbeat();
    const id = setCookieValue(first)!;

    await heartbeat({ cookie: id });

    expect(await db.visitor.count()).toBe(1);
    const visitor = await db.visitor.findUniqueOrThrow({ where: { id } });
    expect(visitor.lastSeenAt.getTime()).toBeGreaterThanOrEqual(visitor.firstSeenAt.getTime());
  });

  it('never creates a visitor for a bot user agent', async () => {
    const response = await heartbeat({ userAgent: 'Googlebot/2.1' });
    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await db.visitor.count()).toBe(0);
  });

  it('never creates a visitor for an empty user agent', async () => {
    await heartbeat({ userAgent: '' });
    expect(await db.visitor.count()).toBe(0);
  });

  it('caps new-visitor creation per IP', async () => {
    const ip = '9.9.9.9';
    for (let i = 0; i < 35; i++) {
      // No cookie on any call — simulates an attacker never storing one, trying to mint many.
      await heartbeat({ ip });
    }
    const count = await db.visitor.count();
    expect(count).toBeLessThanOrEqual(30);
    expect(count).toBeGreaterThan(0);
  });

  it('does not let the rate limit block a returning visitor refreshing lastSeenAt', async () => {
    const ip = '8.8.8.8';
    const first = await heartbeat({ ip });
    const id = setCookieValue(first)!;

    // A handful of repeat heartbeats from the same real visitor, well under the limit.
    for (let i = 0; i < 5; i++) {
      await heartbeat({ ip, cookie: id });
    }
    expect(await db.visitor.count()).toBe(1);
  });
});
