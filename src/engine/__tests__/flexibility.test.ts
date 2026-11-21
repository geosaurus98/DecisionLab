import { describe, expect, it } from 'vitest';
import { estimateFlexibility, type FlexibilityInput } from '../flexibility';
import type { MonthlySummary } from '../cashflow';
import type { RecurringSeries } from '../recurring';
import { categoryMap } from '@/test/fixtures';

const month = (m: string, income: number, essential: number): MonthlySummary => ({
  month: m,
  income,
  spending: essential,
  essentialSpending: essential,
  discretionarySpending: 0,
  savingsContributions: 0,
  transfersIn: 0,
  transfersOut: 0,
  uncategorisedIn: 0,
  uncategorisedOut: 0,
  netCashFlow: income - essential,
  savingsRate: null,
  transactionCount: 1,
});

const series = (over: Partial<RecurringSeries>): RecurringSeries => ({
  key: 'k',
  merchant: 'RENT',
  direction: 'out',
  cadence: 'monthly',
  occurrences: 6,
  typicalAmount: 150000,
  monthlyEquivalent: -150000,
  lastDate: '2026-10-01',
  nextExpected: '2026-11-01',
  confidence: 1,
  amountVariation: 0,
  categoryId: 'rent',
  transactionIds: [],
  active: true,
  ...over,
});

const input: FlexibilityInput = {
  accounts: [
    { id: 'a', name: 'Everyday', type: 'everyday', currency: 'NZD', includeInLiquid: true, balance: { amount: 800000, asOf: '2026-11-15' }, createdAt: '' },
    { id: 'b', name: 'Credit card', type: 'credit', currency: 'NZD', includeInLiquid: false, createdAt: '' },
  ],
  goals: [{ id: 'g', name: 'Laptop', targetAmount: 300000, currentAmount: 100000, earmarked: true, createdAt: '' }],
  profile: {
    emergencyReserveTarget: 300000,
    monthlySavingsCommitment: 50000,
    monthlyIncomeOverride: null,
    monthlyObligationsOverride: null,
    lookbackMonths: 3,
    upcomingExpenses: [
      { id: 'u1', label: 'Car WOF', amount: 10000, dueDate: '2026-12-01' },
      { id: 'u2', label: 'Far away', amount: 99999, dueDate: '2027-09-01' },
    ],
    upcomingHorizonDays: 90,
  },
  completeMonths: [month('2026-07', 1, 1), month('2026-08', 400000, 200000), month('2026-09', 420000, 210000), month('2026-10', 410000, 190000)],
  recurring: [
    series({}),
    series({ key: 's', categoryId: 'savings', monthlyEquivalent: -50000 }), // savings transfer: not an obligation
    series({ key: 'old', active: false, monthlyEquivalent: -9999 }),
    series({ key: 'sub', categoryId: 'subs', monthlyEquivalent: -2000 }),
  ],
  categories: categoryMap,
  today: '2026-11-20',
};

describe('estimateFlexibility', () => {
  it('deducts reserves, upcoming expenses within the horizon and earmarked goals from balances', () => {
    const res = estimateFlexibility(input);
    expect(res.availableNow).toBe(800000 - 300000 - 10000 - 100000);
    expect(res.availableNowLines.every((l) => l.provenance === 'manual')).toBe(true);
  });

  it('estimates monthly capacity from complete months and active consumption obligations only', () => {
    const res = estimateFlexibility(input);
    const income = 410000; // median of last 3 months
    const obligations = 150000 + 2000;
    const essentialVariable = 200000 - 150000; // median essential minus essential recurring (rent)
    expect(res.monthlyCapacity).toBe(income - obligations - essentialVariable - 50000);
    expect(res.monthsUsed).toBe(3);
    expect(res.monthlyLines.find((l) => l.label.startsWith('Typical'))!.provenance).toBe('estimated');
  });

  it('uses manual overrides and labels them as manual', () => {
    const res = estimateFlexibility({ ...input, profile: { ...input.profile, monthlyIncomeOverride: 500000, monthlyObligationsOverride: 100000 } });
    expect(res.monthlyLines[0]!.provenance).toBe('manual');
    expect(res.monthlyCapacity).toBe(500000 - 100000 - 50000 - 50000);
  });

  it('does not treat a balance as available when none is entered', () => {
    const res = estimateFlexibility({ ...input, accounts: [], completeMonths: [] });
    expect(res.availableNow).toBeNull();
    expect(res.monthlyCapacity).toBeNull();
    expect(res.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('can be negative when commitments exceed funds', () => {
    const res = estimateFlexibility({ ...input, profile: { ...input.profile, emergencyReserveTarget: 2_000_000 } });
    expect(res.availableNow).toBeLessThan(0);
  });
});

describe('budgets and goal accounts in the flexibility estimate', () => {
  it('compares discretionary budgets with monthly capacity', () => {
    const base = estimateFlexibility(input);
    const res = estimateFlexibility({ ...input, budgets: [{ categoryId: 'eating', monthlyAmount: 20000, updatedAt: '' }, { categoryId: 'groceries', monthlyAmount: 99999, updatedAt: '' }] });
    expect(res.budgetedDiscretionary).toBe(20000); // groceries is essential, so excluded
    expect(res.unallocatedCapacity).toBe(base.monthlyCapacity! - 20000);
    const over = estimateFlexibility({ ...input, budgets: [{ categoryId: 'eating', monthlyAmount: 9_999_999, updatedAt: '' }] });
    expect(over.warnings.join(' ')).toMatch(/exceed estimated monthly capacity/);
    expect(base.budgetedDiscretionary).toBeNull();
  });
  it('uses a linked account balance as goal savings, earmarking it only if that account is liquid', () => {
    const saver = { id: 's', name: 'Goal saver', type: 'savings' as const, currency: 'NZD' as const, includeInLiquid: true, balance: { amount: 250000, asOf: '2026-11-15' }, createdAt: '' };
    const goal = { ...input.goals[0]!, accountId: 's', currentAmount: 1 };
    const res = estimateFlexibility({ ...input, accounts: [...input.accounts, saver], goals: [goal] });
    expect(res.availableNow).toBe(800000 + 250000 - 300000 - 10000 - 250000);
    const notLiquid = estimateFlexibility({ ...input, accounts: [...input.accounts, { ...saver, includeInLiquid: false }], goals: [goal] });
    expect(notLiquid.availableNow).toBe(800000 - 300000 - 10000);
  });
});
