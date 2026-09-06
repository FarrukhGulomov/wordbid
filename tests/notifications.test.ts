import { describe, expect, it, vi, afterEach } from 'vitest';
import { ConsoleNotificationProvider } from '@/lib/notifications/console';
import { ResendNotificationProvider } from '@/lib/notifications/resend';
import { getNotificationProvider } from '@/lib/notifications';
import type { TakeoverNotice } from '@/lib/notifications/types';

const notice: TakeoverNotice = {
  toEmail: 'owner@example.com',
  wordDisplay: 'AI',
  wordNormalized: 'ai',
  previousOwnerName: 'Acme',
  newOwnerName: 'NewCo',
  reclaimPriceCents: 1050,
  previousClicks: 12,
  previousImpressions: 340,
};

describe('ConsoleNotificationProvider', () => {
  it('logs a complete, inspectable notice without throwing or needing any external service', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await new ConsoleNotificationProvider().sendTakeoverNotice(notice);

    expect(spy).toHaveBeenCalledTimes(1);
    const logged = spy.mock.calls[0]!.join(' ');
    expect(logged).toContain('AI');
    expect(logged).toContain('Acme');
    expect(logged).toContain('NewCo');
    expect(logged).toContain('owner@example.com');
    spy.mockRestore();
  });
});

describe('ResendNotificationProvider', () => {
  const originalKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.RESEND_FROM_EMAIL;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
    if (originalFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = originalFrom;
  });

  it('fails loudly at construction when RESEND_API_KEY is missing', () => {
    delete process.env.RESEND_API_KEY;
    process.env.RESEND_FROM_EMAIL = 'notify@wordbid.example';
    expect(() => new ResendNotificationProvider()).toThrow(/RESEND_API_KEY/);
  });

  it('fails loudly at construction when RESEND_FROM_EMAIL is missing', () => {
    process.env.RESEND_API_KEY = 'test_key';
    delete process.env.RESEND_FROM_EMAIL;
    expect(() => new ResendNotificationProvider()).toThrow(/RESEND_FROM_EMAIL/);
  });

  it('posts the notice to the Resend API with the configured key, from address and a direct reclaim link', async () => {
    process.env.RESEND_API_KEY = 'test_key';
    process.env.RESEND_FROM_EMAIL = 'notify@wordbid.example';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    await new ResendNotificationProvider().sendTakeoverNotice(notice);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect((init!.headers as Record<string, string>)['Authorization']).toBe('Bearer test_key');

    const body = JSON.parse(init!.body as string);
    expect(body.from).toBe('notify@wordbid.example');
    expect(body.to).toBe('owner@example.com');
    expect(body.subject).toContain('AI');
    expect(body.html).toContain('Acme');
    expect(body.html).toContain('NewCo');
    expect(body.html).toContain('/claim?word=ai');

    fetchSpy.mockRestore();
  });

  it('throws with the response body when Resend responds with a non-ok status', async () => {
    process.env.RESEND_API_KEY = 'test_key';
    process.env.RESEND_FROM_EMAIL = 'notify@wordbid.example';
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('Invalid API key', { status: 401 }));

    await expect(new ResendNotificationProvider().sendTakeoverNotice(notice)).rejects.toThrow(/401/);

    fetchSpy.mockRestore();
  });
});

describe('getNotificationProvider', () => {
  const original = process.env.NOTIFICATION_PROVIDER;
  afterEach(() => {
    if (original === undefined) delete process.env.NOTIFICATION_PROVIDER;
    else process.env.NOTIFICATION_PROVIDER = original;
  });

  it('defaults to console when NOTIFICATION_PROVIDER is not set', () => {
    delete process.env.NOTIFICATION_PROVIDER;
    expect(getNotificationProvider().name).toBe('console');
  });

  it('throws for an unrecognised provider name', () => {
    process.env.NOTIFICATION_PROVIDER = 'sendgrid';
    expect(() => getNotificationProvider()).toThrow(/Unknown NOTIFICATION_PROVIDER/);
  });
});
