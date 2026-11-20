import { describe, expect, it } from 'vitest';
import { categorise, recategoriseAll, ruleMatches, sortRules } from '../categorise';
import type { CategoryRule } from '@/domain/types';

const rule = (over: Partial<CategoryRule>): CategoryRule => ({
  id: over.id ?? 'r',
  name: 'rule',
  field: 'description',
  operator: 'contains',
  pattern: 'countdown',
  caseSensitive: false,
  direction: 'any',
  categoryId: 'groceries',
  enabled: true,
  priority: 10,
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
});

const txn = (description: string, amount = -1000) => ({
  description,
  merchant: description.toUpperCase(),
  amount,
  accountId: 'acc',
});

describe('ruleMatches', () => {
  it('matches operators case-insensitively by default', () => {
    expect(ruleMatches(rule({}), txn('EFTPOS COUNTDOWN'))).toBe(true);
    expect(ruleMatches(rule({ operator: 'startsWith', pattern: 'eftpos' }), txn('EFTPOS COUNTDOWN'))).toBe(true);
    expect(ruleMatches(rule({ operator: 'equals', pattern: 'countdown' }), txn('EFTPOS COUNTDOWN'))).toBe(false);
    expect(ruleMatches(rule({ operator: 'regex', pattern: '^eft.*down$' }), txn('EFTPOS COUNTDOWN'))).toBe(true);
    expect(ruleMatches(rule({ caseSensitive: true }), txn('EFTPOS COUNTDOWN'))).toBe(false);
  });
  it('respects direction, account restrictions, disabled rules and invalid regex', () => {
    expect(ruleMatches(rule({ direction: 'in' }), txn('COUNTDOWN', -100))).toBe(false);
    expect(ruleMatches(rule({ direction: 'out' }), txn('COUNTDOWN', -100))).toBe(true);
    expect(ruleMatches(rule({ accountId: 'other' }), txn('COUNTDOWN'))).toBe(false);
    expect(ruleMatches(rule({ enabled: false }), txn('COUNTDOWN'))).toBe(false);
    expect(ruleMatches(rule({ operator: 'regex', pattern: '([' }), txn('COUNTDOWN'))).toBe(false);
  });
});

describe('categorise precedence', () => {
  const rules = sortRules([
    rule({ id: 'late', priority: 20, pattern: 'countdown', categoryId: 'late-cat' }),
    rule({ id: 'early', priority: 1, pattern: 'count', categoryId: 'early-cat' }),
  ]);
  it('uses the first matching rule by priority', () => {
    expect(categorise(txn('COUNTDOWN'), rules, new Map())).toEqual({ categoryId: 'early-cat', categorySource: 'rule', ruleId: 'early' });
  });
  it('prefers learned merchant memory over rules', () => {
    expect(categorise(txn('COUNTDOWN'), rules, new Map([['COUNTDOWN', 'memory-cat']]))).toEqual({
      categoryId: 'memory-cat',
      categorySource: 'memory',
    });
  });
  it('never overrides a manual category', () => {
    expect(
      categorise({ ...txn('COUNTDOWN'), categoryId: 'mine', categorySource: 'manual' }, rules, new Map([['COUNTDOWN', 'x']])),
    ).toEqual({ categoryId: 'mine', categorySource: 'manual' });
  });
  it('leaves unmatched transactions uncategorised', () => {
    expect(categorise(txn('UNKNOWN'), rules, new Map())).toEqual({ categoryId: null, categorySource: 'none' });
  });
  it('recategoriseAll returns only changed transactions', () => {
    const txns = [
      { id: '1', ...txn('COUNTDOWN'), categoryId: 'early-cat', categorySource: 'rule' as const, ruleId: 'early' },
      { id: '2', ...txn('COUNTDOWN'), categoryId: null, categorySource: 'none' as const },
    ];
    expect(recategoriseAll(txns, rules, new Map()).map((c) => c.id)).toEqual(['2']);
  });
});
