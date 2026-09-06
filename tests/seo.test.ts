import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { confirmPayment } from '@/lib/ownership';
import { generateMetadata } from '@/app/word/[word]/page';
import sitemap from '@/app/sitemap';
import { config } from '@/lib/config';
import { db, resetDb, seedPendingPayment } from './helpers';

beforeEach(resetDb);
afterAll(async () => {
  await db.$disconnect();
});

async function claim(word: string, brand: string, amountCents: number, eventId: string) {
  const seeded = await seedPendingPayment({ word, brand, amountCents });
  const result = await confirmPayment('mock', eventId, seeded.payment.providerReference, db);
  expect(result.outcome).toBe('won');
}

/** generateMetadata takes { params }, matching Next's route prop shape. */
function metadataFor(word: string) {
  return generateMetadata({ params: Promise.resolve({ word }) });
}

describe('word page metadata — owned word', () => {
  it('uses the real current owner, value and rank — never generic filler', async () => {
    await claim('ai', 'AcmeAI', 482000, 'e1');

    const meta = await metadataFor('ai');

    expect(meta.title).toBe('Who Owns AI? Current Owner, Value & Rank');
    expect(meta.description).toContain('AcmeAI');
    expect(meta.description).toContain('$4,820');
    expect(meta.description).toContain('#1');
  });

  it('is indexable — no robots override on a real owned page', async () => {
    await claim('ai', 'AcmeAI', 482000, 'e1');
    const meta = await metadataFor('ai');
    expect(meta.robots).toBeUndefined();
  });

  it('canonical is the relative /word/<normalized> path, resolved against metadataBase', async () => {
    await claim('ai', 'AcmeAI', 482000, 'e1');
    const meta = await metadataFor('ai');
    expect(meta.alternates?.canonical).toBe('/word/ai');
  });
});

describe('word page metadata — unowned or nonexistent word', () => {
  it('is marked noindex — never lets a thin, ownerless page get indexed', async () => {
    const meta = await metadataFor('never-claimed-anything');
    expect(meta.robots).toMatchObject({ index: false, follow: true });
  });

  it('still names the real word, but with no fabricated ownership facts', async () => {
    const meta = await metadataFor('never-claimed-anything');
    expect(meta.title).toBe('Claim NEVER-CLAIMED-ANYTHING — Unowned Word');
    expect(meta.description).not.toMatch(/owned by|ranked #/i);
  });

  it('a blocked word gets the same noindex treatment as an unowned one', async () => {
    await claim('spam', 'Spammer', 900000, 'e1');
    await db.word.update({ where: { normalized: 'spam' }, data: { blocked: true } });

    const meta = await metadataFor('spam');
    expect(meta.robots).toMatchObject({ index: false, follow: true });
  });
});

describe('sitemap', () => {
  it('includes only owned, unblocked words — never a thin unowned page', async () => {
    await claim('ai', 'AcmeAI', 482000, 'e1');
    await seedPendingPayment({ word: 'unclaimed', brand: 'Ghost', amountCents: 999999 }); // never confirmed

    const entries = await sitemap();
    const urls = entries.map((e) => e.url);

    expect(urls).toContain(`${config.siteUrl}/word/ai`);
    expect(urls.some((u) => u.includes('/word/unclaimed'))).toBe(false);
  });

  it('excludes a blocked word even if it was previously owned', async () => {
    await claim('spam', 'Spammer', 900000, 'e1');
    await db.word.update({ where: { normalized: 'spam' }, data: { blocked: true } });

    const entries = await sitemap();
    expect(entries.some((e) => e.url.includes('/word/spam'))).toBe(false);
  });

  it('always includes the homepage and the claim page', async () => {
    const entries = await sitemap();
    const urls = entries.map((e) => e.url);
    expect(urls.some((u) => u.endsWith('/claim'))).toBe(true);
    expect(urls.some((u) => u.match(/^https?:\/\/[^/]+\/?$/))).toBe(true);
  });
});
