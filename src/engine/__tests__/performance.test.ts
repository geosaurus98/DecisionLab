import { describe, expect, it } from 'vitest';
import { toAnalysisLines } from '../splits';
import { findTransferPairs, monthlySummaries } from '../cashflow';
import { detectRecurring } from '../recurring';
import { groupUncategorised } from '../review';
import { mulberry32 } from '../random';
import { addDays } from '@/domain/dates';
import { DEFAULT_CATEGORIES } from '@/data/seed';

/**
 * Guard against accidental quadratic behaviour in the analytics that run on every data change.
 * The limit is deliberately generous (machines vary); typical time is ~0.3 s for 50k rows.
 */
describe('performance with 50,000 transactions', () => {
  it('runs the live analytics pipeline well within budget', () => {
    const rng = mulberry32(1);
    const ids = DEFAULT_CATEGORIES.map((c) => c.id);
    const cats = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c]));
    const txns = Array.from({ length: 50_000 }, (_, i) => {
      const merchant = `MERCHANT ${Math.floor(rng() ** 2 * 800)}`;
      return {
        id: `t${i}`,
        accountId: `a${i % 4}`,
        date: addDays('2016-01-01', Math.floor(rng() * 3650)),
        amount: Math.round((rng() - 0.7) * 20000),
        categoryId: rng() < 0.3 ? null : ids[Math.floor(rng() * ids.length)]!,
        merchant,
        description: merchant,
      };
    });
    const t0 = performance.now();
    const lines = toAnalysisLines(txns);
    monthlySummaries(lines, cats);
    detectRecurring(txns, { asOf: '2026-01-01' });
    findTransferPairs(txns, cats);
    groupUncategorised(txns);
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});
