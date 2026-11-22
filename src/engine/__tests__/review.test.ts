import { describe, expect, it } from 'vitest';
import { groupUncategorised, suggestRulePattern } from '../review';
import { findTransferPairs } from '../cashflow';
import { categoryMap } from '@/test/fixtures';

const t = (id: string, merchant: string, amount: number, date: string, categoryId: string | null = null, accountId = 'a') => ({
  id,
  merchant,
  description: `POS ${merchant} ${date}`,
  amount,
  date,
  accountId,
  categoryId,
});

describe('groupUncategorised', () => {
  it('groups uncategorised transactions by merchant, biggest first, skipping categorised and split ones', () => {
    const groups = groupUncategorised([
      t('1', 'CORNER BAKERY', -650, '2026-01-02'),
      t('2', 'CORNER BAKERY', -500, '2026-01-09', null, 'b'),
      t('3', 'CORNER BAKERY', 200, '2026-01-10'),
      t('4', 'BIG STORE', -12000, '2026-01-05'),
      t('5', 'CORNER BAKERY', -700, '2026-01-11', 'eating'),
      { ...t('6', 'BIG STORE', -100, '2026-01-06'), splits: [{ id: 's', amount: -100, categoryId: null }] },
    ]);
    expect(groups.map((g) => g.merchant)).toEqual(['CORNER BAKERY', 'BIG STORE']);
    expect(groups[0]).toMatchObject({ count: 3, total: -950, outCount: 2, inCount: 1, firstDate: '2026-01-02', lastDate: '2026-01-10', accountIds: ['a', 'b'], ids: ['1', '2', '3'] });
    expect(groups[0]!.sample).toContain('2026-01-10');
  });
  it('suggests a readable rule pattern', () => {
    expect(suggestRulePattern('CORNER BAKERY WELLINGTON NZ')).toBe('corner bakery wellington');
  });
});

describe('findTransferPairs (closest date, exclusions)', () => {
  const tx = (id: string, accountId: string, amount: number, date: string) => ({ id, accountId, amount, date, categoryId: null });
  it('pairs each outflow with the closest-dated matching inflow and honours rejected pairs', () => {
    const data = [tx('o1', 'a', -10000, '2026-03-05'), tx('i-far', 'b', 10000, '2026-03-02'), tx('i-near', 'b', 10000, '2026-03-05')];
    expect(findTransferPairs(data, categoryMap).map(([o, i]) => `${o.id}>${i.id}`)).toEqual(['o1>i-near']);
    expect(findTransferPairs(data, categoryMap, 3, new Set(['o1|i-near'])).map(([o, i]) => `${o.id}>${i.id}`)).toEqual(['o1>i-far']);
  });
});
