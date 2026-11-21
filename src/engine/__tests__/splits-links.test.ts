import { describe, expect, it } from 'vitest';
import { dominantSplitCategory, hasCategory, toAnalysisLines, validateSplits } from '../splits';
import { linkedCost, suggestLinks } from '../decisionLink';
import { summarise } from '../cashflow';
import { categoryMap } from '@/test/fixtures';

describe('splits', () => {
  it('validates that parts sum exactly to the transaction and share its direction', () => {
    expect(validateSplits(-10000, [{ amount: -6000, categoryId: 'groceries' }, { amount: -4000, categoryId: 'eating' }])).toEqual([]);
    expect(validateSplits(-10000, [{ amount: -6000, categoryId: 'a' }, { amount: -3999, categoryId: 'b' }]).join(' ')).toMatch(/add up/);
    expect(validateSplits(-10000, [{ amount: -10000, categoryId: 'a' }])).toHaveLength(1);
    expect(validateSplits(-10000, [{ amount: -12000, categoryId: 'a' }, { amount: 2000, categoryId: 'b' }]).join(' ')).toMatch(/direction/);
    expect(validateSplits(-10000, [{ amount: -10000, categoryId: 'a' }, { amount: 0, categoryId: 'b' }]).join(' ')).toMatch(/zero/);
  });

  it('expands split transactions into analysis lines without changing totals', () => {
    const txns = [
      { id: 't1', accountId: 'a', date: '2026-01-05', amount: -10000, categoryId: 'groceries', splits: [{ id: 's1', amount: -7000, categoryId: 'groceries' }, { id: 's2', amount: -3000, categoryId: 'eating' }] },
      { id: 't2', accountId: 'a', date: '2026-01-06', amount: 50000, categoryId: 'income' },
    ];
    const lines = toAnalysisLines(txns);
    expect(lines.map((l) => l.id)).toEqual(['t1:s1', 't1:s2', 't2']);
    const s = summarise(lines, categoryMap);
    expect(s.spending).toBe(10000);
    expect(s.essentialSpending).toBe(7000);
    expect(s.discretionarySpending).toBe(3000);
    expect(dominantSplitCategory(txns[0]!.splits!)).toBe('groceries');
    expect(hasCategory(txns[0]!, 'eating')).toBe(true);
    expect(hasCategory(txns[1]!, 'eating')).toBe(false);
  });
});

describe('decision links', () => {
  it('measures actual cost from linked transactions, net of refunds', () => {
    expect(linkedCost([{ amount: -38900 }, { amount: -42000 }, { amount: 5000 }])).toBe(75900);
  });

  it('suggests outflows near the decision date by keyword or expected amount', () => {
    const txns = [
      { id: 'flight', date: '2026-03-10', amount: -150000, description: 'AIR NEW ZEALAND TOKYO' },
      { id: 'hotel', date: '2026-04-01', amount: -98000, description: 'SHINJUKU HOTEL' },
      { id: 'tokyo-early', date: '2026-01-01', amount: -5000, description: 'TOKYO RAMEN' },
      { id: 'refund', date: '2026-03-12', amount: 20000, description: 'AIR NEW ZEALAND TOKYO REFUND' },
      { id: 'other', date: '2026-03-15', amount: -2000, description: 'COFFEE' },
      { id: 'elsewhere', date: '2026-03-15', amount: -150000, description: 'TOKYO', decisionId: 'other-decision' },
    ];
    const res = suggestLinks(txns, { id: 'd', date: '2026-03-01', title: 'Japan trip to Tokyo', optionName: 'Tokyo in April', expectedCost: 100000 });
    expect(res.map((r) => r.transactionId)).toEqual(['hotel', 'flight']);
    expect(res[0]!.reasons.join(' ')).toMatch(/expected cost/);
    expect(res[1]!.reasons.join(' ')).toMatch(/tokyo/);
  });
});
