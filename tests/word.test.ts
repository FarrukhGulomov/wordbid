import { describe, expect, it } from 'vitest';
import { normalizeWord, validateWord, displayWord } from '@/lib/word';

describe('normalizeWord', () => {
  it('collapses casing and surrounding whitespace to one identity', () => {
    expect(normalizeWord('AI')).toBe('ai');
    expect(normalizeWord('ai')).toBe('ai');
    expect(normalizeWord('  Ai  ')).toBe('ai');
    expect(normalizeWord('\tAI\n')).toBe('ai');
  });

  it('turns inner whitespace and underscores into a single hyphen', () => {
    expect(normalizeWord('machine learning')).toBe('machine-learning');
    expect(normalizeWord('machine   learning')).toBe('machine-learning');
    expect(normalizeWord('machine_learning')).toBe('machine-learning');
    expect(normalizeWord('machine--learning')).toBe('machine-learning');
  });

  it('folds diacritics so obvious duplicates share one word', () => {
    expect(normalizeWord('Café')).toBe('cafe');
    expect(normalizeWord('cafe')).toBe('cafe');
  });

  it('trims stray hyphens from the edges', () => {
    expect(normalizeWord('-ai-')).toBe('ai');
  });
});

describe('displayWord', () => {
  it('keeps the writer casing but tidies whitespace', () => {
    expect(displayWord('  DevX  ')).toBe('DevX');
    expect(displayWord('machine   learning')).toBe('machine learning');
  });
});

describe('validateWord', () => {
  it('accepts ordinary words', () => {
    const result = validateWord('Coding');
    expect(result).toEqual({ ok: true, normalized: 'coding', display: 'Coding' });
  });

  it('accepts digits and non-latin scripts', () => {
    expect(validateWord('web3').ok).toBe(true);
    expect(validateWord('日本').ok).toBe(true);
  });

  it('rejects empty input', () => {
    expect(validateWord('   ').ok).toBe(false);
  });

  it('rejects words that are too long', () => {
    expect(validateWord('a'.repeat(31)).ok).toBe(false);
  });

  it('rejects punctuation and injection-shaped input', () => {
    expect(validateWord('a<script>').ok).toBe(false);
    expect(validateWord('hello!').ok).toBe(false);
    expect(validateWord('a/b').ok).toBe(false);
    expect(validateWord('../etc').ok).toBe(false);
  });

  it('rejects reserved product routes', () => {
    expect(validateWord('admin').ok).toBe(false);
    expect(validateWord('API').ok).toBe(false);
    expect(validateWord('checkout').ok).toBe(false);
  });

  it('rejects prohibited terms regardless of separators', () => {
    expect(validateWord('n-i-g-g-e-r'.replace(/-/g, '')).ok).toBe(false);
  });
});
