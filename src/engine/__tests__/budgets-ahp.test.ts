import { describe, expect, it } from 'vitest';
import { budgetReport, suggestBudgets } from '../budgets';
import { ahpWeights, judgementToSlider, pairKey, sliderToJudgement } from '../ahp';
import { optionToVariant, project, reachedByDate, totalOptionCost, variantToOption } from '../projection';
import { categoryMap } from '@/test/fixtures';
import type { ProjectionAssumptions, ScenarioVariant } from '@/domain/types';

const b = (categoryId: string, monthlyAmount: number) => ({ categoryId, monthlyAmount, updatedAt: '' });
const line = (date: string, amount: number, categoryId: string | null) => ({ date, amount, categoryId });

describe('budgetReport', () => {
  const lines = [
    line('2026-11-02', -30000, 'groceries'),
    line('2026-11-03', 5000, 'groceries'), // refund
    line('2026-11-04', -24000, 'eating'),
    line('2026-11-05', -9999, 'subs'),
    line('2026-11-06', -1500, null),
    line('2026-11-07', -100000, 'transfer'),
    line('2026-10-07', -50000, 'eating'),
  ];
  it('compares net spending with budgets and flags pace in the current month', () => {
    const r = budgetReport(lines, categoryMap, [b('groceries', 60000), b('eating', 20000), b('transfer', 999)], '2026-11', '2026-11-15');
    expect(r.elapsed).toBeCloseTo(0.5, 10);
    const g = r.lines.find((l) => l.categoryId === 'groceries')!;
    expect(g).toMatchObject({ actual: 25000, remaining: 35000, status: 'onTrack' });
    expect(r.lines.find((l) => l.categoryId === 'eating')!.status).toBe('over');
    expect(r.lines.some((l) => l.categoryId === 'transfer')).toBe(false); // only expense categories can be budgeted
    expect(r.unbudgetedActual).toBe(9999 + 1500);
    expect(r.totalBudget).toBe(80000);
    expect(r.essentialBudget).toBe(60000);
    expect(r.discretionaryBudget).toBe(20000);
  });
  it('marks spending ahead of pace as at risk, and judges past months on the full budget', () => {
    const early = budgetReport(lines, categoryMap, [b('groceries', 60000)], '2026-11', '2026-11-05');
    expect(early.lines[0]!.status).toBe('atRisk');
    const past = budgetReport(lines, categoryMap, [b('eating', 60000)], '2026-10', '2026-11-15');
    expect(past.elapsed).toBe(1);
    expect(past.lines[0]).toMatchObject({ actual: 50000, status: 'onTrack' });
  });
  it('suggests budgets from the median month, rounded up to $10', () => {
    const data = [line('2026-08-01', -12345, 'eating'), line('2026-09-01', -20000, 'eating'), line('2026-10-01', -30000, 'eating'), line('2026-10-01', -500, 'transfer')];
    const s = suggestBudgets(data, categoryMap, ['2026-08', '2026-09', '2026-10']);
    expect(s.get('eating')).toBe(20000);
    expect(s.has('transfer')).toBe(false);
    expect(s.has('groceries')).toBe(false);
  });
});

describe('AHP', () => {
  it('reproduces weights for a perfectly consistent matrix', () => {
    // True weights 0.6 / 0.3 / 0.1 → ratios 2, 6, 3
    const r = ahpWeights(['a', 'b', 'c'], { [pairKey('a', 'b')]: 2, [pairKey('a', 'c')]: 6, [pairKey('b', 'c')]: 3 });
    expect(r.weights.a).toBeCloseTo(0.6, 10);
    expect(r.weights.b).toBeCloseTo(0.3, 10);
    expect(r.weights.c).toBeCloseTo(0.1, 10);
    expect(r.lambdaMax).toBeCloseTo(3, 10);
    expect(r.consistencyRatio!).toBeCloseTo(0, 10);
    expect(r.consistent).toBe(true);
  });
  it('detects contradictory judgements', () => {
    const r = ahpWeights(['a', 'b', 'c'], { [pairKey('a', 'b')]: 5, [pairKey('b', 'c')]: 5, [pairKey('c', 'a')]: 5 });
    expect(r.consistencyRatio!).toBeGreaterThan(0.1);
    expect(r.consistent).toBe(false);
  });
  it('reads reciprocal orientation, defaults to equal and handles small n', () => {
    const r = ahpWeights(['a', 'b'], { [pairKey('b', 'a')]: 3 });
    expect(r.weights.b).toBeCloseTo(0.75, 10);
    expect(r.consistencyRatio).toBeNull();
    expect(ahpWeights(['a', 'b', 'c'], {}).weights.a).toBeCloseTo(1 / 3, 10);
    expect(ahpWeights([], {}).weights).toEqual({});
  });
  it('maps sliders to the Saaty scale and back', () => {
    expect(sliderToJudgement(0)).toBe(1);
    expect(sliderToJudgement(8)).toBe(9);
    expect(sliderToJudgement(-2)).toBeCloseTo(1 / 3, 12);
    for (let v = -8; v <= 8; v++) expect(judgementToSlider(sliderToJudgement(v))).toBe(v);
  });
});

describe('scenario variants as decision options', () => {
  const a: ProjectionAssumptions = { startMonth: '2026-12', horizonMonths: 60, initialBalance: 500_000, monthlyContribution: 30_000, timing: 'end', annualReturn: 0.06, annualFee: 0.005, taxRateOnReturns: 0.28, annualInflation: 0.025 };
  const simple: ScenarioVariant = { id: 's', name: 'Trip', oneOffs: [{ id: 'o', label: 'Trip', month: 2, amount: -300_000 }], recurring: [], contributionDelta: 0 };
  const rich: ScenarioVariant = {
    id: 'r',
    name: 'Four-day week',
    oneOffs: [{ id: 'o', label: 'Bonus', month: 3, amount: 50_000 }],
    recurring: [{ id: 'x', label: 'Lower pay', startMonth: 0, endMonth: 11, monthlyAmount: -70_000, inflationIndexed: true }],
    contributionDelta: -10_000,
  };
  it('maps simple variants to upfront/monthly fields and rich ones to extra flows, with identical projections', () => {
    const o1 = variantToOption(simple);
    expect(o1).toMatchObject({ upfrontCost: 300_000, costMonth: 2, monthlyCost: 0 });
    expect(o1.extraFlows).toBeUndefined();
    const o2 = variantToOption(rich);
    expect(o2.extraFlows).toBeDefined();
    for (const v of [simple, rich]) {
      expect(project(a, optionToVariant(variantToOption(v))).finalNominal).toBe(project(a, v).finalNominal);
    }
  });
  it('total cost counts every cash flow but not contribution changes', () => {
    const o = variantToOption(rich);
    const indexed = Array.from({ length: 12 }, (_, t) => 70_000 * Math.pow(1.025, t / 12)).reduce((x, y) => x + y, 0);
    expect(totalOptionCost(o, 60, 0.025)).toBe(Math.round(indexed - 50_000));
  });
  it('checks whether a target is reached by a goal date', () => {
    const target = { ...a, initialBalance: 0, monthlyContribution: 100_000, annualReturn: 0, annualFee: 0, targetAmount: 1_000_000 };
    const res = project(target);
    expect(res.targetReachedAt).toBe(9);
    expect(reachedByDate(res, target, '2027-09-15')).toBe(true); // month offset 9
    expect(reachedByDate(res, target, '2027-08-31')).toBe(false);
    expect(reachedByDate(res, { ...target, targetAmount: undefined }, '2027-09-15')).toBeNull();
  });
});
