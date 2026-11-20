import { describe, expect, it } from 'vitest';
import { comparePeriods, findTransferPairs, monthlySummaries, spendingByCategory, summarise } from '../cashflow';
import { categoryMap } from '@/test/fixtures';

const t = (date: string, amount: number, categoryId: string | null, accountId = 'a', id = `${date}${amount}${categoryId}`) => ({
  id,
  date,
  amount,
  categoryId,
  accountId,
});

const txns = [
  t('2026-01-15', 400000, 'income'),
  t('2026-01-02', -150000, 'rent'),
  t('2026-01-05', -20000, 'groceries'),
  t('2026-01-06', 2000, 'groceries'), // refund
  t('2026-01-10', -5000, 'eating'),
  t('2026-01-11', -100000, 'transfer'), // to own savings account
  t('2026-01-11', 100000, 'transfer', 'b'), // received in savings account
  t('2026-01-20', -50000, 'savings'), // KiwiSaver voluntary contribution
  t('2026-01-25', -1000, null), // uncategorised spend
  t('2026-01-26', 700, null), // uncategorised inflow
  t('2026-03-01', -3000, 'eating'),
];

describe('summarise', () => {
  const s = summarise(txns, categoryMap, { start: '2026-01-01', end: '2026-01-31' });
  it('excludes transfers from income and spending (no double counting)', () => {
    expect(s.income).toBe(400000);
    expect(s.transfersIn).toBe(100000);
    expect(s.transfersOut).toBe(100000);
  });
  it('nets refunds against spending and counts uncategorised outflows conservatively', () => {
    // 150000 + 20000 - 2000 + 5000 + 1000
    expect(s.spending).toBe(174000);
    expect(s.essentialSpending).toBe(168000);
    expect(s.discretionarySpending).toBe(6000);
    expect(s.uncategorisedOut).toBe(1000);
    expect(s.uncategorisedIn).toBe(700);
  });
  it('separates savings contributions from consumption', () => {
    expect(s.savingsContributions).toBe(50000);
    expect(s.netCashFlow).toBe(400000 + 700 - 174000 - 50000);
    expect(s.savingsRate).toBeCloseTo((400000 - 174000) / 400000, 10);
  });
  it('returns a null savings rate without income', () => {
    expect(summarise([t('2026-01-01', -100, 'eating')], categoryMap).savingsRate).toBeNull();
  });
});

describe('monthlySummaries', () => {
  it('fills empty months between data with zeros', () => {
    const months = monthlySummaries(txns, categoryMap);
    expect(months.map((m) => m.month)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(months[1]!.spending).toBe(0);
    expect(months[2]!.spending).toBe(3000);
  });
  it('returns nothing for no data', () => {
    expect(monthlySummaries([], categoryMap)).toEqual([]);
  });
});

describe('spendingByCategory', () => {
  it('groups net spending and computes shares', () => {
    const res = spendingByCategory(txns, categoryMap, { start: '2026-01-01', end: '2026-01-31' });
    expect(res[0]).toMatchObject({ categoryId: 'rent', total: 150000 });
    expect(res.find((r) => r.categoryId === 'groceries')!.total).toBe(18000);
    expect(res.find((r) => r.categoryId === null)!.total).toBe(1000);
    expect(res.reduce((a, r) => a + r.share, 0)).toBeCloseTo(1, 10);
  });
});

describe('comparePeriods', () => {
  it('normalises periods of different lengths to monthly figures', () => {
    const data = [t('2026-01-10', -3000, 'eating'), t('2026-02-10', -3000, 'eating'), t('2026-03-10', -3000, 'eating'), t('2026-04-10', -6000, 'eating')];
    const res = comparePeriods(data, categoryMap, { start: '2026-01-01', end: '2026-03-31' }, { start: '2026-04-01', end: '2026-04-30' });
    const eating = res.find((r) => r.categoryId === 'eating')!;
    // 9000 over 90 days ≈ 3044/month; 6000 over 30 days ≈ 6088/month
    expect(eating.a).toBe(Math.round(9000 * (30.4375 / 90)));
    expect(eating.b).toBe(Math.round(6000 * (30.4375 / 30)));
    expect(eating.relative).toBeGreaterThan(0.9);
  });
});

describe('findTransferPairs', () => {
  it('pairs equal and opposite flows across accounts within the window', () => {
    const data = [
      t('2026-01-01', -50000, null, 'a', 'o1'),
      t('2026-01-02', 50000, null, 'b', 'i1'),
      t('2026-01-01', -2000, null, 'a', 'o2'),
      t('2026-01-20', 2000, null, 'b', 'i2'), // outside window
      t('2026-01-01', -700, null, 'a', 'o3'),
      t('2026-01-01', 700, null, 'a', 'i3'), // same account
    ];
    expect(findTransferPairs(data, categoryMap).map(([o, i]) => [o.id, i.id])).toEqual([['o1', 'i1']]);
  });
});
