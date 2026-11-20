import { describe, expect, it } from 'vitest';
import { compareVariants, futureValue, monthlyFeeRate, monthlyRate, optionToVariant, project, totalOptionCost } from '../projection';
import { realDifferenceMetric, tornado } from '../sensitivity';
import type { ProjectionAssumptions } from '@/domain/types';

const base: ProjectionAssumptions = {
  startMonth: '2026-12',
  horizonMonths: 120,
  initialBalance: 1_000_000, // $10,000
  monthlyContribution: 50_000, // $500
  timing: 'end',
  annualReturn: 0.06,
  annualFee: 0,
  taxRateOnReturns: 0,
  annualInflation: 0.02,
};

describe('rate conversion', () => {
  it('monthly rates compound back to the annual rate', () => {
    expect(Math.pow(1 + monthlyRate(0.06), 12) - 1).toBeCloseTo(0.06, 12);
    expect(1 - Math.pow(1 - monthlyFeeRate(0.01), 12)).toBeCloseTo(0.01, 12);
  });
});

describe('project', () => {
  it('matches the closed-form future value for end-of-month contributions', () => {
    const r = monthlyRate(0.06);
    const res = project(base);
    expect(res.finalNominal).toBe(Math.round(futureValue(1_000_000, r, 50_000, 120, 'end')));
  });

  it('matches the closed-form future value for start-of-month contributions', () => {
    const r = monthlyRate(0.06);
    const res = project({ ...base, timing: 'start' });
    expect(res.finalNominal).toBe(Math.round(futureValue(1_000_000, r, 50_000, 120, 'start')));
    expect(res.finalNominal).toBeGreaterThan(project(base).finalNominal);
  });

  it('with zero return, the balance is just the sum of flows', () => {
    const res = project({ ...base, annualReturn: 0 });
    expect(res.finalNominal).toBe(1_000_000 + 50_000 * 120);
    expect(res.totalGrowth).toBe(0);
  });

  it('deflates to real values using start-month dollars', () => {
    const res = project({ ...base, annualReturn: 0, monthlyContribution: 0, horizonMonths: 12 });
    expect(res.finalNominal).toBe(1_000_000);
    expect(res.finalReal).toBe(Math.round(1_000_000 / 1.02));
  });

  it('a return equal to inflation preserves real value', () => {
    const res = project({ ...base, annualReturn: 0.02, monthlyContribution: 0, horizonMonths: 24 });
    expect(res.finalReal).toBe(1_000_000);
  });

  it('applies fees and tax to reduce growth', () => {
    const gross = project({ ...base, monthlyContribution: 0, horizonMonths: 12 });
    const net = project({ ...base, monthlyContribution: 0, horizonMonths: 12, annualFee: 0.01, taxRateOnReturns: 0.28 });
    expect(net.finalNominal).toBeLessThan(gross.finalNominal);
    expect(net.totalTax).toBe(Math.round(net.totalGrowth * 0.28));
    expect(net.totalFees).toBeGreaterThan(0);
    // Identity: final = initial + flows + growth − tax − fees (within rounding)
    expect(Math.abs(net.finalNominal - (1_000_000 + net.totalFlows + net.totalGrowth - net.totalTax - net.totalFees))).toBeLessThanOrEqual(2);
  });

  it('handles a one-month horizon', () => {
    const res = project({ ...base, horizonMonths: 1, annualReturn: 0 });
    expect(res.points).toHaveLength(1);
    expect(res.finalNominal).toBe(1_050_000);
  });

  it('flags shortfalls and does not grow negative balances', () => {
    const res = project(
      { ...base, initialBalance: 100_000, monthlyContribution: 0, horizonMonths: 6 },
      { oneOffs: [{ id: 'x', label: 'trip', month: 0, amount: -300_000 }], recurring: [], contributionDelta: 0 },
    );
    expect(res.shortfallMonths.length).toBeGreaterThan(0);
    expect(res.points[5]!.nominal).toBe(res.points[1]!.nominal); // no growth while negative
    expect(res.minimumBalance).toBeLessThan(0);
  });

  it('tracks when a target is reached', () => {
    const res = project({ ...base, annualReturn: 0, targetAmount: 1_500_000 });
    expect(res.targetReachedAt).toBe(9); // 10,000 + 500*10 = 15,000 at end of month index 9
  });

  it('applies recurring flows within their window and indexes them to inflation when asked', () => {
    const flat = project(
      { ...base, annualReturn: 0, monthlyContribution: 0, horizonMonths: 24 },
      { oneOffs: [], recurring: [{ id: 'r', label: 'sub', startMonth: 12, endMonth: 23, monthlyAmount: -1000, inflationIndexed: false }], contributionDelta: 0 },
    );
    expect(flat.finalNominal).toBe(1_000_000 - 12_000);
    const indexed = project(
      { ...base, annualReturn: 0, monthlyContribution: 0, horizonMonths: 24 },
      { oneOffs: [], recurring: [{ id: 'r', label: 'sub', startMonth: 0, monthlyAmount: -1000, inflationIndexed: true }], contributionDelta: 0 },
    );
    expect(indexed.finalNominal).toBeLessThan(1_000_000 - 24_000);
  });

  it('rejects invalid assumptions', () => {
    expect(() => project({ ...base, horizonMonths: 0 })).toThrow();
    expect(() => project({ ...base, annualReturn: -1.5 })).toThrow();
  });
});

describe('decision options as scenarios', () => {
  const trip = { id: 'trip', name: 'Japan trip', upfrontCost: 300_000, costMonth: 0, monthlyCost: 0 };
  const stay = { id: 'stay', name: 'Invest instead', upfrontCost: 0, costMonth: 0, monthlyCost: 0 };

  it('the opportunity cost of spending equals the compounded upfront cost', () => {
    const cmp = compareVariants({ ...base, timing: 'start' }, [optionToVariant(trip), optionToVariant(stay)]);
    const tripRes = cmp.find((c) => c.variantId === 'trip')!;
    const expected = 300_000 * Math.pow(1 + monthlyRate(0.06), 120);
    expect(Math.abs(-tripRes.vsBestNominal - expected)).toBeLessThanOrEqual(2);
    expect(cmp.find((c) => c.variantId === 'stay')!.vsBestNominal).toBe(0);
  });

  it('computes total option cost within the horizon', () => {
    expect(totalOptionCost({ ...trip, monthlyCost: 1000, monthlyCostMonths: 6 }, 120)).toBe(306_000);
    expect(totalOptionCost({ ...trip, monthlyCost: 1000, costMonth: 118 }, 120)).toBe(302_000);
    expect(totalOptionCost({ ...trip, costMonth: 200 }, 120)).toBe(0);
  });

  it('sensitivity re-runs the model: higher returns increase the opportunity cost', () => {
    const drivers = tornado(base, realDifferenceMetric(optionToVariant(trip), optionToVariant(stay)));
    const ret = drivers.find((d) => d.key === 'annualReturn')!;
    expect(ret.high).toBeLessThan(ret.base);
    expect(ret.low).toBeGreaterThan(ret.base);
    // Contribution changes affect both options equally and cancel out with zero fees/tax.
    expect(drivers.find((d) => d.key === 'monthlyContribution')!.swing).toBeLessThanOrEqual(2);
    expect(drivers[0]!.swing).toBeGreaterThanOrEqual(drivers[drivers.length - 1]!.swing);
  });
});
