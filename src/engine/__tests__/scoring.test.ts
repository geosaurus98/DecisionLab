import { describe, expect, it } from 'vitest';
import { normaliseCriterion, normaliseWeights, paretoEfficient, scoreOptions, weightSensitivity } from '../scoring';
import type { Criterion, DecisionOption, ScoreMatrix } from '@/domain/types';

const opt = (id: string): DecisionOption => ({ id, name: id, upfrontCost: 0, costMonth: 0, monthlyCost: 0 });
const crit = (id: string, weight: number, over: Partial<Criterion> = {}): Criterion => ({
  id,
  name: id,
  type: 'rating',
  direction: 'higher',
  weight,
  ...over,
});

describe('normalisation', () => {
  it('normalises weights to sum to one, and falls back to equal weights when all are zero', () => {
    expect(normaliseWeights([crit('a', 3), crit('b', 1)])).toEqual({ a: 0.75, b: 0.25 });
    expect(normaliseWeights([crit('a', 0), crit('b', 0)])).toEqual({ a: 0.5, b: 0.5 });
  });

  it('normalises ratings on the fixed 0–10 scale, respecting direction', () => {
    const scores: ScoreMatrix = { x: { c: 8 }, y: { c: 2 } };
    expect(normaliseCriterion(crit('c', 1), [opt('x'), opt('y')], scores)).toEqual({ x: 0.8, y: 0.2 });
    const lower = normaliseCriterion(crit('c', 1, { direction: 'lower' }), [opt('x'), opt('y')], scores);
    expect(lower.x).toBeCloseTo(0.2, 12);
    expect(lower.y).toBeCloseTo(0.8, 12);
  });

  it('normalises measures min–max across options; equal values do not discriminate', () => {
    const c = crit('kg', 1, { type: 'measure', direction: 'lower' });
    expect(normaliseCriterion(c, [opt('x'), opt('y'), opt('z')], { x: { kg: 1 }, y: { kg: 2 }, z: { kg: 3 } })).toEqual({ x: 1, y: 0.5, z: 0 });
    expect(normaliseCriterion(c, [opt('x'), opt('y')], { x: { kg: 2 }, y: { kg: 2 } })).toEqual({ x: 1, y: 1 });
  });
});

describe('scoreOptions', () => {
  const options = [opt('trip'), opt('stay')];
  const criteria = [crit('experience', 3), crit('stress', 1, { direction: 'lower' })];
  const scores: ScoreMatrix = { trip: { experience: 9, stress: 6 }, stay: { experience: 4, stress: 2 } };

  it('computes transparent weighted sums', () => {
    const { results } = scoreOptions(options, criteria, scores);
    const trip = results.find((r) => r.optionId === 'trip')!;
    // 0.75*0.9 + 0.25*0.4 = 0.775
    expect(trip.score).toBeCloseTo(77.5, 10);
    expect(trip.rank).toBe(1);
    expect(trip.contributions.reduce((a, c) => a + c.contribution, 0) * 100).toBeCloseTo(trip.score, 10);
  });

  it('flags missing scores and gives ties equal rank', () => {
    const { results, warnings } = scoreOptions(options, criteria, { trip: { experience: 5, stress: 5 }, stay: { experience: 5 } });
    expect(results.find((r) => r.optionId === 'stay')!.incomplete).toBe(true);
    expect(warnings.join(' ')).toMatch(/missing/);
    const tie = scoreOptions(options, [crit('a', 1)], { trip: { a: 5 }, stay: { a: 5 } });
    expect(tie.results.map((r) => r.rank)).toEqual([1, 1]);
  });
});

describe('weightSensitivity', () => {
  it('finds the weight share at which the leader changes', () => {
    // A wins on quality (10 vs 0); B wins on price (10 vs 0). Weights 0.6/0.4 → A leads.
    const options = [opt('A'), opt('B')];
    const criteria = [crit('quality', 6), crit('price', 4)];
    const scores = { A: { quality: 10, price: 0 }, B: { quality: 0, price: 10 } };
    const s = weightSensitivity(options, criteria, scores, 1000);
    expect(s.leaderId).toBe('A');
    const q = s.items.find((i) => i.criterionId === 'quality')!;
    // Leader flips when quality share drops below 0.5 → distance ≈ 0.1
    expect(q.flipDistance).toBeCloseTo(0.101, 2);
    expect(q.flipTo).toBe('B');
    expect(q.stableRange[1]).toBe(1);
    expect(s.fragile).toBe(true);
  });

  it('reports robust rankings as not fragile', () => {
    const options = [opt('A'), opt('B')];
    const criteria = [crit('q', 1), crit('p', 1)];
    const s = weightSensitivity(options, criteria, { A: { q: 9, p: 9 }, B: { q: 2, p: 3 } });
    expect(s.fragile).toBe(false);
    expect(s.items.every((i) => i.flipDistance === null)).toBe(true);
  });
});

describe('paretoEfficient', () => {
  it('excludes options that are both worse and more expensive', () => {
    const eff = paretoEfficient([
      { optionId: 'a', score: 80, cost: 1000 },
      { optionId: 'b', score: 70, cost: 1500 },
      { optionId: 'c', score: 60, cost: 200 },
    ]);
    expect([...eff].sort()).toEqual(['a', 'c']);
  });
});
