import { describe, expect, it } from 'vitest';
import { formatUsd, formatCount, parseUsdToCents } from '@/lib/money';

describe('formatUsd', () => {
  it('hides cents when the amount is whole dollars', () => {
    expect(formatUsd(482000)).toBe('$4,820');
    expect(formatUsd(1000)).toBe('$10');
  });
  it('shows cents when they matter', () => {
    expect(formatUsd(105050)).toBe('$1,050.50');
  });
});

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(18420)).toBe('18,420');
  });
});

describe('parseUsdToCents', () => {
  it('parses plain, prefixed and grouped amounts', () => {
    expect(parseUsdToCents('500')).toBe(50000);
    expect(parseUsdToCents('$500')).toBe(50000);
    expect(parseUsdToCents('1,050.50')).toBe(105050);
  });
  it('rejects anything that is not an amount', () => {
    expect(parseUsdToCents('')).toBeNull();
    expect(parseUsdToCents('abc')).toBeNull();
    expect(parseUsdToCents('10.005')).toBeNull();
    expect(parseUsdToCents('-10')).toBeNull();
  });
});
