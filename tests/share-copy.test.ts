import { describe, expect, it } from 'vitest';
import { buildShareText, extractPositioningPhrase } from '@/lib/share-copy';

const AGGRESSIVE_PHRASES = [
  'beat us',
  'your move',
  'anyone can take it',
  'try to take it',
  'take it from us',
  'come and get it',
];

function expectNoAggressiveLanguage(text: string) {
  const lower = text.toLowerCase();
  for (const phrase of AGGRESSIVE_PHRASES) {
    expect(lower, `"${text}" should not contain "${phrase}"`).not.toContain(phrase);
  }
}

describe('extractPositioningPhrase', () => {
  it('accepts a short, clean category phrase', () => {
    expect(extractPositioningPhrase('Better Education')).toBe('better education');
  });

  it('rejects a full marketing sentence — never splices raw scraped prose into the template', () => {
    const sentence =
      'AI workspace for automating customer support, from first response to full resolution.';
    expect(extractPositioningPhrase(sentence)).toBeNull();
  });

  it('rejects a phrase containing mid-text punctuation', () => {
    expect(extractPositioningPhrase('Smarter payments. Built for scale.')).toBeNull();
  });

  it('rejects a phrase opening with a subject pronoun (would double up on "We\'re building for")', () => {
    expect(extractPositioningPhrase('We help teams ship faster')).toBeNull();
    expect(extractPositioningPhrase("We're the fastest way to pay")).toBeNull();
    expect(extractPositioningPhrase('Our platform powers checkout')).toBeNull();
  });

  it('returns null for missing or empty descriptions', () => {
    expect(extractPositioningPhrase(null)).toBeNull();
    expect(extractPositioningPhrase('')).toBeNull();
    expect(extractPositioningPhrase('   ')).toBeNull();
  });
});

describe('buildShareText — claim', () => {
  it('promotes the founder/company when reliable context exists', () => {
    const text = buildShareText({ kind: 'claim', word: 'EDUCATION', description: 'Better Education' });
    expect(text).toContain("We're building for better education, so we claimed EDUCATION on WordBid. 👑");
    expect(text).toContain('One word. One spot. A position worth owning.');
    expectNoAggressiveLanguage(text);
  });

  it('falls back gracefully when there is no reliable context', () => {
    const text = buildShareText({ kind: 'claim', word: 'EDUCATION', description: null });
    expect(text).toContain('We claimed EDUCATION on WordBid. 👑');
    expect(text).not.toContain('building for');
    expect(text).toContain('One word. One spot. A position worth owning.');
  });

  it('never invents a company description from unreliable metadata — falls back instead', () => {
    const text = buildShareText({
      kind: 'claim',
      word: 'CREDIT',
      description: 'Some very long scraped sentence that goes on and on about many unrelated things.',
    });
    expect(text).toContain('We claimed CREDIT on WordBid. 👑');
    expect(text).not.toContain('building for');
  });
});

describe('buildShareText — takeover', () => {
  it('celebrates the new position without attacking the previous owner', () => {
    const text = buildShareText({ kind: 'takeover', word: 'CREDIT', brandName: 'Acme' });
    expect(text).toBe(
      'We just claimed the CREDIT spot for Acme on WordBid. 👑\n\nOne word. One spot. Own what defines your brand.',
    );
    expectNoAggressiveLanguage(text);
    expect(text.toLowerCase()).not.toContain('defeat');
    expect(text.toLowerCase()).not.toContain('from them');
  });
});

describe('buildShareText — reclaim', () => {
  it('frames a reclaim as strengthening positioning, not revenge', () => {
    const text = buildShareText({ kind: 'reclaim', word: 'CREDIT', brandName: 'Acme' });
    expect(text).toBe('CREDIT is back with Acme on WordBid. 👑\n\nOne word. One spot. A position worth owning.');
    expectNoAggressiveLanguage(text);
  });
});

describe('buildShareText — boost', () => {
  it('shares the real outcome when verified rank data is available', () => {
    const text = buildShareText({ kind: 'boost', word: 'CREDIT', brandName: 'Acme', rank: 2 });
    expect(text).toBe('Acme is now #2 for CREDIT on WordBid. ↑\n\nOne word. One spot. A position worth owning.');
    expect(text).not.toContain('boosted');
    expect(text).not.toContain('BOOST');
  });

  it('never invents a rank — uses a safe fallback when rank data is unavailable', () => {
    const text = buildShareText({ kind: 'boost', word: 'CREDIT', brandName: 'Acme', rank: null });
    expect(text).not.toMatch(/#\d/);
    expect(text).toContain('Acme just strengthened its position on CREDIT on WordBid. 👑');
    expect(text).not.toContain('boosted');
  });
});

describe('buildShareText — tone and length, across every variant', () => {
  const variants: Parameters<typeof buildShareText>[0][] = [
    { kind: 'claim', word: 'EDUCATION', description: 'Better Education' },
    { kind: 'claim', word: 'EDUCATION', description: null },
    { kind: 'takeover', word: 'CREDIT', brandName: 'Acme' },
    { kind: 'reclaim', word: 'CREDIT', brandName: 'Acme' },
    { kind: 'boost', word: 'CREDIT', brandName: 'Acme', rank: 2 },
    { kind: 'boost', word: 'CREDIT', brandName: 'Acme', rank: null },
  ];

  it('never contains aggressive or challenge-style language', () => {
    for (const ctx of variants) {
      expectNoAggressiveLanguage(buildShareText(ctx));
    }
  });

  it('never uses hashtags (a "#" followed by a letter) — a rank like "#2" is not a hashtag', () => {
    for (const ctx of variants) {
      expect(buildShareText(ctx)).not.toMatch(/#[a-zA-Z]/);
    }
  });

  it('stays comfortably inside a sensible total length even at maximum field sizes', () => {
    // 30 chars is the real max word length (see src/lib/word.ts), 60 the max brand name length
    // (see src/lib/validation.ts) — the worst case that could ever reach this function.
    const longWord = 'A'.repeat(30);
    const longBrand = 'B'.repeat(60);
    const worstCases: Parameters<typeof buildShareText>[0][] = [
      { kind: 'claim', word: longWord, description: null },
      { kind: 'takeover', word: longWord, brandName: longBrand },
      { kind: 'reclaim', word: longWord, brandName: longBrand },
      { kind: 'boost', word: longWord, brandName: longBrand, rank: 999 },
    ];
    for (const ctx of worstCases) {
      const text = buildShareText(ctx);
      // Well under X's 280-character limit, leaving generous room for the ~23-character t.co
      // link X appends automatically from the separate `url` intent param.
      expect(text.length).toBeLessThanOrEqual(220);
    }
  });

  it('never truncates the brand name or word in the generated text', () => {
    const longWord = 'ABCDEFGHIJKLMNOPQRSTUVWXYZABCD'.slice(0, 30);
    const longBrand = 'The Very Long Brand Name Company LLC International Group';
    const text = buildShareText({ kind: 'takeover', word: longWord, brandName: longBrand });
    expect(text).toContain(longWord);
    expect(text).toContain(longBrand);
  });
});
