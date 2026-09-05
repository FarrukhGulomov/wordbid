import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { minimumBidCents, bidWins } from '@/lib/pricing';

describe('minimumBidCents', () => {
  it('uses the starting price when nobody owns the word', () => {
    expect(minimumBidCents(0)).toBe(1000);
  });

  it('adds the configured 5% premium to the current value', () => {
    expect(minimumBidCents(50000)).toBe(52500);
    expect(minimumBidCents(1000)).toBe(1050);
  });

  it('rounds the premium up so it is never free to take a word', () => {
    // 1% of 1 cent rounds to 0 without the ceiling.
    expect(minimumBidCents(1)).toBe(2);
    expect(minimumBidCents(19)).toBe(20);
  });

  it('is always strictly greater than the value it must beat', () => {
    for (const value of [1, 2, 7, 99, 1000, 123_456, 9_999_999]) {
      expect(minimumBidCents(value)).toBeGreaterThan(value);
    }
  });
});

describe('minimumBidCents with a configured percentage', () => {
  const original = process.env.TAKEOVER_INCREMENT_PERCENT;
  beforeEach(() => {
    process.env.TAKEOVER_INCREMENT_PERCENT = '20';
  });
  afterEach(() => {
    process.env.TAKEOVER_INCREMENT_PERCENT = original;
  });

  it('honours the environment override', () => {
    expect(minimumBidCents(1000)).toBe(1200);
  });
});

describe('bidWins', () => {
  it('requires strictly more than the current value', () => {
    expect(bidWins(1051, 1000)).toBe(true);
    expect(bidWins(1000, 1000)).toBe(false);
    expect(bidWins(999, 1000)).toBe(false);
  });
});
