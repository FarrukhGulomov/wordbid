import { describe, expect, it } from 'vitest';
import { computeBidRank } from '@/lib/bidrank';

describe('computeBidRank', () => {
  it('is numerically identical to bid strength today — turning this module on changes nothing', () => {
    expect(computeBidRank({ bidStrengthCents: 0 })).toBe(0);
    expect(computeBidRank({ bidStrengthCents: 1050 })).toBe(1050);
    expect(computeBidRank({ bidStrengthCents: 5_000_000 })).toBe(5_000_000);
  });

  it('ranks a higher bid strictly above a lower one, same as the leaderboard sort', () => {
    const lower = computeBidRank({ bidStrengthCents: 1000 });
    const higher = computeBidRank({ bidStrengthCents: 1001 });
    expect(higher).toBeGreaterThan(lower);
  });
});
