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
