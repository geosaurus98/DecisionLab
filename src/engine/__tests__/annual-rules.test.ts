import { describe, expect, it } from 'vitest';
import { yearReview, yearsWithData } from '../annual';
import { ruleHealth } from '../ruleHealth';
import { categoryMap } from '@/test/fixtures';
import type { CategoryRule, Decision } from '@/domain/types';

describe('yearReview', () => {
  const lines = [
    { date: '2025-03-01', amount: 400000, categoryId: 'income' },
    { date: '2025-03-02', amount: -100000, categoryId: 'eating' },
    { date: '2026-03-01', amount: 420000, categoryId: 'income' },
    { date: '2026-03-02', amount: -60000, categoryId: 'eating' },
    { date: '2026-04-02', amount: -30000, categoryId: 'groceries' },
  ];
  const dec = (date: string, satisfaction: number | null, lessons = '') =>
    ({ title: `d${date}`, date, snapshot: {}, review: satisfaction === null ? null : { satisfaction, wouldRepeat: satisfaction > 5 ? 'yes' : 'no', lessons } }) as unknown as Decision;
  it('compares the year with the previous one and summarises decisions', () => {
    expect(yearsWithData(lines)).toEqual([2026, 2025]);
    const r = yearReview(lines, categoryMap, [dec('2026-02-01', 8, 'Check accessories'), dec('2026-05-01', 4), dec('2026-06-01', null), dec('2025-01-01', 9)], 2026);
    expect(r.summary.income).toBe(420000);
    expect(r.previous!.spending).toBe(100000);
    expect(r.monthsWithData).toBe(2);
    expect(r.categoryChanges[0]).toEqual({ categoryId: 'eating', thisYear: 60000, lastYear: 100000, change: -40000 });
    expect(r.decisions).toMatchObject({ made: 3, reviewed: 2, meanSatisfaction: 6, wouldRepeat: 1, lessons: [{ title: 'd2026-02-01', lesson: 'Check accessories' }] });
    expect(yearReview(lines, categoryMap, [], 2025).previous).toBeNull();
  });
});

describe('ruleHealth', () => {
  const rule = (id: string, pattern: string, categoryId: string, priority: number, enabled = true): CategoryRule => ({
    id, name: id, field: 'description', operator: 'contains', pattern, caseSensitive: false, direction: 'any', categoryId, enabled, priority, createdAt: '',
  });
  const t = (description: string, categoryId: string | null, categorySource: 'rule' | 'manual' | 'memory' | 'none', ruleId?: string) => ({
    description, merchant: description.toUpperCase(), amount: -100, accountId: 'a', categoryId, categorySource, ruleId,
  });
  it('flags rules that never match, are shadowed, or conflict with your corrections', () => {
    const rules = [rule('cafe', 'cafe', 'eating', 1), rule('cafe-wide', 'cafe', 'shopping', 2), rule('none', 'zzz', 'eating', 3), rule('market', 'market', 'groceries', 4), rule('off', 'cafe', 'eating', 5, false)];
    const txns = [
      t('Corner cafe', 'eating', 'rule', 'cafe'),
      t('Beach cafe', 'eating', 'rule', 'cafe'),
      t('Night market', 'eating', 'manual'),
      t('Farmers market', 'eating', 'memory'),
      t('Super market', 'groceries', 'rule', 'market'),
    ];
    const h = Object.fromEntries(ruleHealth(rules, txns).map((r) => [r.ruleId, r]));
    expect(h.cafe).toMatchObject({ status: 'ok', matches: 2, effective: 2 });
    expect(h['cafe-wide']).toMatchObject({ status: 'shadowed', shadowedBy: 'cafe' });
    expect(h.none!.status).toBe('neverMatches');
    expect(h.market).toMatchObject({ status: 'conflicts', conflicts: 2, effective: 1, conflictCategoryId: 'eating' });
    expect(h.off).toMatchObject({ status: 'disabled', matches: 2 });
  });
});
