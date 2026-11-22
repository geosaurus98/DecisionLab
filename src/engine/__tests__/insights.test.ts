import { describe, expect, it } from 'vitest';
import { calibrate } from '../insights';
import type { Decision } from '@/domain/types';

function reviewed(predictedCost: number, actualCost: number | null, predictedSat: number | null, sat: number, repeat: 'yes' | 'no' = 'yes'): Decision {
  return {
    id: Math.random().toString(),
    category: 'purchase',
    snapshot: { predictedCost, predictedSatisfaction: predictedSat, confidence: 4 },
    review: { actualCost, satisfaction: sat, wouldRepeat: repeat },
  } as unknown as Decision;
}

describe('calibrate', () => {
  it('summarises cost and satisfaction prediction errors with sample sizes', () => {
    const res = calibrate([reviewed(1000, 1200, 8, 7), reviewed(1000, 1000, 6, 8), reviewed(2000, 2600, 9, 6, 'no'), reviewed(500, null, null, 5)]);
    expect(res.reviewed).toBe(4);
    expect(res.costSample).toBe(3);
    expect(res.linkedCostSample).toBe(0);
    expect(res.medianCostError).toBeCloseTo(0.2, 10);
    expect(res.underestimatedShare).toBeCloseTo(2 / 3, 10);
    expect(res.satisfactionSample).toBe(3);
    expect(res.meanSatisfactionGap).toBeCloseTo((-1 + 2 - 3) / 3, 10);
    expect(res.wouldRepeatShare).toBe(0.75);
    expect(res.confidenceCalibration).toEqual([{ confidence: 4, n: 4, wouldRepeatShare: 0.75 }]);
  });
  it('ignores unreviewed decisions and handles empty input', () => {
    const res = calibrate([{ snapshot: null, review: null } as unknown as Decision]);
    expect(res.reviewed).toBe(0);
    expect(res.medianCostError).toBeNull();
    expect(res.wouldRepeatShare).toBeNull();
  });
});

import { criterionInsights, MIN_CRITERION_SAMPLE } from '../insights';
import { ranks, spearman } from '../stats';

describe('spearman', () => {
  it('handles ties and monotonic relationships', () => {
    expect(ranks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
    expect(spearman([1, 2, 3, 4], [10, 100, 1000, 10000])).toBeCloseTo(1, 12);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 12);
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(spearman([1, 2], [1, 2])).toBeNull();
  });
});

describe('criterionInsights', () => {
  function decision(i: number, enjoyment: number, usefulness: number, satisfaction: number, enjoymentWeight = 1): Decision {
    return {
      id: `d${i}`,
      category: 'purchase',
      snapshot: {
        options: [{ id: 'a' }, { id: 'b' }],
        criteria: [
          { id: 'e', name: i % 2 ? 'Enjoyment' : 'enjoyment ', type: 'rating', direction: 'higher', weight: enjoymentWeight },
          { id: 'u', name: 'Usefulness', type: 'rating', direction: 'higher', weight: 3 },
        ],
        scores: { a: { e: enjoyment, u: usefulness }, b: { e: 5, u: 5 } },
        selectedOptionId: 'a',
        predictedCost: 0,
        predictedSatisfaction: 7,
        confidence: 3,
      },
      review: { satisfaction, wouldRepeat: 'yes', actualCost: null },
    } as unknown as Decision;
  }

  it('reports correlation and a reading only with enough decisions, matching names case-insensitively', () => {
    const few = criterionInsights([decision(1, 9, 5, 9), decision(2, 3, 5, 3), decision(3, 6, 5, 6)]);
    const enj = few.find((c) => c.name.toLowerCase() === 'enjoyment')!;
    expect(enj.n).toBe(3);
    expect(enj.rho).toBeNull();
    expect(enj.reading).toBeNull();

    // Enjoyment tracks satisfaction; usefulness scores are unrelated to it but heavily weighted.
    const unrelated = [5, 5, 9, 1, 5, 5, 1, 9, 5, 5, 9, 1];
    const many = Array.from({ length: MIN_CRITERION_SAMPLE + 2 }, (_, i) => decision(i, 1 + (i % 10), unrelated[i]!, 1 + (i % 10)));
    const res = criterionInsights(many);
    const e = res.find((c) => c.name.toLowerCase() === 'enjoyment')!;
    const u = res.find((c) => c.name === 'Usefulness')!;
    expect(e.n).toBe(12);
    expect(e.rho!).toBeGreaterThan(0.9);
    expect(e.reading).toBe('predictive');
    expect(u.meanWeight).toBeCloseTo(0.75, 10);
    expect(Math.abs(u.rho!)).toBeLessThan(0.3);
    expect(u.reading).toBe('weightedButNotPredictive');
  });
});
