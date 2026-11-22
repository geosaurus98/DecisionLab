import { describe, expect, it } from 'vitest';
import { monthsToReach, monthsUntil, probabilityOfReaching, requiredMonthlyContribution } from '../goals';
import { netWorthSeries } from '../networth';
import { project } from '../projection';

describe('goal savings plans', () => {
  const base = { saved: 100_000, target: 500_000, months: 20, annualReturn: 0, taxRate: 0 };
  it('with no return, the required contribution is simply the gap divided by months (rounded up to dollars)', () => {
    expect(requiredMonthlyContribution(base)).toBe(20_000);
    expect(requiredMonthlyContribution({ ...base, target: 500_050 })).toBe(20_100);
    expect(requiredMonthlyContribution({ ...base, saved: 600_000 })).toBe(0);
    expect(requiredMonthlyContribution({ ...base, months: 0 })).toBe(400_000);
  });

  it('with interest, the required contribution is the smallest whole-dollar amount that reaches the target', () => {
    const i = { ...base, annualReturn: 0.04, taxRate: 0.175 };
    const c = requiredMonthlyContribution(i);
    expect(c).toBeLessThan(20_000);
    expect(c % 100).toBe(0);
    const at = (x: number) => project({ startMonth: '2000-01', horizonMonths: 20, initialBalance: 100_000, monthlyContribution: x, timing: 'end', annualReturn: 0.04, annualFee: 0, taxRateOnReturns: 0.175, annualInflation: 0 }).finalNominal;
    expect(at(c)).toBeGreaterThanOrEqual(500_000);
    expect(at(c - 100)).toBeLessThan(500_000);
  });

  it('computes months to reach and the probability under uncertain returns', () => {
    expect(monthsToReach({ saved: 0, target: 100_000, annualReturn: 0, taxRate: 0 }, 10_000)).toBe(10);
    expect(monthsToReach({ saved: 0, target: 100_000, annualReturn: 0, taxRate: 0 }, 0)).toBeNull();
    expect(monthsToReach({ saved: 200_000, target: 100_000, annualReturn: 0 }, 0)).toBe(0);
    const i = { ...base, annualReturn: 0.05, taxRate: 0 };
    const c = requiredMonthlyContribution(i);
    expect(probabilityOfReaching(i, c, 0)).toBe(1); // no uncertainty, exact plan
    const p = probabilityOfReaching(i, c, 0.15);
    expect(p).toBeGreaterThan(0.2);
    expect(p).toBeLessThan(0.8); // roughly a coin flip when contributing exactly the plan
  });

  it('counts months to a target date inclusively', () => {
    expect(monthsUntil('2026-11-23', '2027-06-30')).toBe(8);
    expect(monthsUntil('2026-11-23', '2026-11-30')).toBe(1);
    expect(monthsUntil('2026-11-23', '2026-01-01')).toBe(0);
  });
});

describe('net worth', () => {
  const acc = (id: string, over: object) => ({ id, name: id, type: 'everyday' as const, currency: 'NZD' as const, includeInLiquid: true, createdAt: '', ...over });
  it('sums reconstructed month-end balances, starting each account when its history starts', () => {
    const accounts = [
      acc('everyday', { statementBalance: { amount: 150_000, asOf: '2026-03-31', importId: 'i' } }),
      acc('card', { type: 'credit', includeInLiquid: false, balance: { amount: -20_000, asOf: '2026-03-31' } }),
      acc('kiwisaver', { type: 'investment', includeInLiquid: false, balance: { amount: 1_000_000, asOf: '2026-02-15' } }),
      acc('nobalance', {}),
    ];
    const txns = [
      { accountId: 'everyday', date: '2026-01-10', amount: 100_000 },
      { accountId: 'everyday', date: '2026-02-10', amount: 30_000 },
      { accountId: 'everyday', date: '2026-03-10', amount: 20_000 },
      { accountId: 'card', date: '2026-03-05', amount: -20_000 },
    ];
    const { points, excluded } = netWorthSeries(accounts, txns, ['2026-01', '2026-02', '2026-03']);
    expect(excluded.map((a) => a.id)).toEqual(['nobalance']);
    expect(points[0]).toMatchObject({ total: 100_000, liquid: 100_000, accounts: 1 });
    expect(points[1]).toMatchObject({ total: 130_000 + 1_000_000, liquid: 130_000, accounts: 2 });
    expect(points[2]).toMatchObject({ total: 150_000 - 20_000 + 1_000_000, liquid: 150_000, accounts: 3 });
  });
});
