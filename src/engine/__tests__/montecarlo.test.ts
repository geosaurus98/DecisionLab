import { describe, expect, it } from 'vitest';
import { histogram, logReturnParams, sampleMonths, simulate, validateMonteCarlo } from '../montecarlo';
import { project } from '../projection';
import type { ProjectionAssumptions, ScenarioVariant } from '@/domain/types';

const base: ProjectionAssumptions = {
  startMonth: '2026-12',
  horizonMonths: 120,
  initialBalance: 1_000_000,
  monthlyContribution: 50_000,
  timing: 'end',
  annualReturn: 0.06,
  annualFee: 0.005,
  taxRateOnReturns: 0.28,
  annualInflation: 0.025,
};
const keep: ScenarioVariant = { id: 'keep', name: 'Invest', oneOffs: [], recurring: [], contributionDelta: 0 };
const trip: ScenarioVariant = { id: 'trip', name: 'Trip', oneOffs: [{ id: 'o', label: 'Trip', month: 0, amount: -300_000 }], recurring: [], contributionDelta: 0 };

describe('logReturnParams', () => {
  it('reproduces the arithmetic mean and volatility of annual returns', () => {
    const { monthlyMean, monthlySd } = logReturnParams(0.07, 0.15);
    const m = 12 * monthlyMean;
    const s2 = 12 * monthlySd ** 2;
    const mean = Math.exp(m + s2 / 2) - 1;
    const sd = Math.sqrt((Math.exp(s2) - 1) * Math.exp(2 * m + s2));
    expect(mean).toBeCloseTo(0.07, 12);
    expect(sd).toBeCloseTo(0.15, 12);
  });
  it('with zero volatility gives the deterministic monthly rate', () => {
    const { monthlyMean, monthlySd } = logReturnParams(0.06, 0);
    expect(monthlySd).toBe(0);
    expect(Math.exp(12 * monthlyMean)).toBeCloseTo(1.06, 12);
  });
});

describe('simulate', () => {
  it('with zero volatility every percentile equals the deterministic projection', () => {
    const res = simulate(base, [keep, trip], { annualVolatility: 0, runs: 200, seed: 1 });
    for (const [v, variant] of [keep, trip].entries()) {
      const det = project(base, variant);
      const d = res.variants[v]!;
      for (const k of ['p10', 'p50', 'p90', 'mean'] as const) {
        expect(Math.abs(d.finalNominal[k] - det.finalNominal)).toBeLessThanOrEqual(1);
        expect(Math.abs(d.finalReal[k] - det.finalReal)).toBeLessThanOrEqual(1);
      }
    }
    const diff = res.differences[0]!.diff;
    expect(Math.abs(diff.p10 - (project(base, keep).finalReal - project(base, trip).finalReal))).toBeLessThanOrEqual(2);
    expect(diff.p10).toBe(diff.p90);
  });

  it('is reproducible for a seed and changes with a different seed', () => {
    const a = simulate(base, [keep], { annualVolatility: 0.15, runs: 500, seed: 42 });
    const b = simulate(base, [keep], { annualVolatility: 0.15, runs: 500, seed: 42 });
    const c = simulate(base, [keep], { annualVolatility: 0.15, runs: 500, seed: 43 });
    expect(a.variants[0]!.finalNominal).toEqual(b.variants[0]!.finalNominal);
    expect(a.variants[0]!.finalNominal).not.toEqual(c.variants[0]!.finalNominal);
  });

  it('mean outcome of a lump sum converges to the deterministic value; the median is lower', () => {
    const lump: ProjectionAssumptions = { ...base, monthlyContribution: 0, annualFee: 0, taxRateOnReturns: 0, horizonMonths: 60 };
    const res = simulate(lump, [keep], { annualVolatility: 0.15, runs: 20_000, seed: 7 });
    const det = project(lump).finalNominal;
    const d = res.variants[0]!.finalNominal;
    expect(Math.abs(d.mean - det) / det).toBeLessThan(0.015);
    expect(d.p50).toBeLessThan(d.mean);
    expect(d.p10).toBeLessThan(d.p25);
    expect(d.p25).toBeLessThan(d.p50);
    expect(d.p50).toBeLessThan(d.p75);
    expect(d.p75).toBeLessThan(d.p90);
  });

  it('computes target, shortfall and loss probabilities', () => {
    const det = project(base).finalNominal;
    const res = simulate({ ...base, targetAmount: det }, [keep], { annualVolatility: 0.15, runs: 4000, seed: 3 });
    const v = res.variants[0]!;
    // Median is below the deterministic value, so reaching it is less likely than not.
    expect(v.probTargetAtEnd!).toBeGreaterThan(0.25);
    expect(v.probTargetAtEnd!).toBeLessThan(0.5);
    expect(v.probTargetAnyTime!).toBeGreaterThanOrEqual(v.probTargetAtEnd!);
    expect(v.probShortfall).toBe(0);
    expect(v.probLoss).toBeGreaterThan(0);
    expect(v.probLoss).toBeLessThan(0.2);
    const broke = simulate({ ...base, initialBalance: 0, monthlyContribution: 0 }, [trip], { annualVolatility: 0.15, runs: 200, seed: 3 });
    expect(broke.variants[0]!.probShortfall).toBe(1);
  });

  it('uses common random numbers so the difference distribution is narrower than either outcome', () => {
    const res = simulate(base, [keep, trip], { annualVolatility: 0.15, runs: 3000, seed: 11 });
    const spread = (p: { p10: number; p90: number }) => p.p90 - p.p10;
    expect(spread(res.differences[0]!.diff)).toBeLessThan(spread(res.variants[0]!.finalReal) / 3);
    expect(res.differences[0]!.probAAhead).toBe(1); // keeping the money ends ahead on every path
  });

  it('handles very short horizons and validates settings', () => {
    const res = simulate({ ...base, horizonMonths: 1 }, [keep], { annualVolatility: 0.2, runs: 100, seed: 1 });
    expect(res.variants[0]!.fan).toHaveLength(1);
    expect(validateMonteCarlo({ annualVolatility: -0.1, runs: 50, seed: 1.5 })).toHaveLength(3);
    expect(() => simulate(base, [keep], { annualVolatility: 0.1, runs: 10, seed: 1 })).toThrow();
  });
});

describe('helpers', () => {
  it('samples months up to ~60 points and always includes the final month', () => {
    expect(sampleMonths(12)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const s = sampleMonths(600);
    expect(s.length).toBeLessThanOrEqual(61);
    expect(s.at(-1)).toBe(599);
  });
  it('histogram counts every value', () => {
    const values = Float64Array.from({ length: 1000 }, (_, i) => i);
    const h = histogram(values, 20);
    expect(h.reduce((a, b) => a + b.count, 0)).toBe(1000);
  });
});

import { sequenceStress } from '../projection';

describe('crash risk and uncertain inflation', () => {
  const lump: ProjectionAssumptions = { ...base, monthlyContribution: 0, annualFee: 0, taxRateOnReturns: 0, horizonMonths: 60 };
  it('keeps the expected outcome while fattening the downside', () => {
    const plain = simulate(lump, [keep], { annualVolatility: 0.12, runs: 20_000, seed: 5 }).variants[0]!.finalNominal;
    const crashy = simulate(lump, [keep], { annualVolatility: 0.12, runs: 20_000, seed: 5, crashProbability: 0.1, crashSize: 0.3 }).variants[0]!.finalNominal;
    const det = project(lump).finalNominal;
    expect(Math.abs(crashy.mean - det) / det).toBeLessThan(0.02);
    expect(crashy.p10).toBeLessThan(plain.p10);
  });

  it('with uncertain inflation, real values spread wider and indexed costs vary by path', () => {
    const fixed = simulate(base, [keep], { annualVolatility: 0, runs: 500, seed: 9 }).variants[0]!;
    const uncertain = simulate(base, [keep], { annualVolatility: 0, runs: 500, seed: 9, inflationVolatility: 0.02 }).variants[0]!;
    expect(fixed.finalReal.p90 - fixed.finalReal.p10).toBe(0);
    expect(uncertain.finalReal.p90 - uncertain.finalReal.p10).toBeGreaterThan(0);
    expect(uncertain.finalNominal.p90 - uncertain.finalNominal.p10).toBe(0); // nominal unaffected without indexed flows
    const sub: ScenarioVariant = { ...keep, id: 'sub', recurring: [{ id: 'r', label: 'Sub', startMonth: 0, monthlyAmount: -10_000, inflationIndexed: true }] };
    const withIndexed = simulate(base, [sub], { annualVolatility: 0, runs: 500, seed: 9, inflationVolatility: 0.02 }).variants[0]!;
    expect(withIndexed.finalNominal.p90 - withIndexed.finalNominal.p10).toBeGreaterThan(0);
    // With zero inflation volatility, indexed flows match the deterministic engine exactly.
    expect(Math.abs(simulate(base, [sub], { annualVolatility: 0, runs: 100, seed: 1 }).variants[0]!.finalNominal.p50 - project(base, sub).finalNominal)).toBeLessThanOrEqual(1);
  });

  it('validates the new settings', () => {
    expect(validateMonteCarlo({ annualVolatility: 0.1, runs: 1000, seed: 1, crashProbability: 0.9, crashSize: 1, inflationVolatility: 0.5 })).toHaveLength(3);
  });
});

describe('sequenceStress', () => {
  it('shows that crash timing matters: early hurts a lump sum less when contributions continue, late hurts more', () => {
    const contributing = { ...base, initialBalance: 0, monthlyContribution: 100_000, annualFee: 0, taxRateOnReturns: 0, timing: 'start' as const };
    const r = Object.fromEntries(sequenceStress(contributing).map((x) => [x.timing, x.finalNominal]));
    expect(r.early).toBeGreaterThan(r.late!);
    expect(r.none).toBeGreaterThan(r.early!);
    const lumpOnly = { ...base, monthlyContribution: 0, annualFee: 0, taxRateOnReturns: 0 };
    const l = Object.fromEntries(sequenceStress(lumpOnly).map((x) => [x.timing, x.finalNominal]));
    // A lump sum with no flows: timing doesn't change the final value (multiplication commutes).
    expect(Math.abs(l.early! - l.late!)).toBeLessThanOrEqual(1);
    expect(() => sequenceStress(base, undefined, 1.5)).toThrow();
  });
});
