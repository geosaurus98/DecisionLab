import { describe, expect, it } from 'vitest';
import { classifyDuplicates, countBaseKeys } from '../dedupe';

const rows = [
  { date: '2026-03-01', amount: -450, description: 'Coffee Co' },
  { date: '2026-03-01', amount: -450, description: 'Coffee Co' },
  { date: '2026-03-02', amount: -2000, description: 'Fuel' },
];

describe('classifyDuplicates', () => {
  it('keeps legitimately identical rows within one file', () => {
    const res = classifyDuplicates('acc', rows, new Map());
    expect(res.map((r) => r.duplicate)).toEqual([false, false, false]);
    expect(new Set(res.map((r) => r.fingerprint)).size).toBe(3);
  });

  it('flags every row when the same file is imported twice', () => {
    const first = classifyDuplicates('acc', rows, new Map());
    const second = classifyDuplicates('acc', rows, countBaseKeys(first.map((r) => r.fingerprint)));
    expect(second.every((r) => r.duplicate)).toBe(true);
  });

  it('imports only new rows from an overlapping statement', () => {
    const first = classifyDuplicates('acc', rows.slice(0, 1), new Map());
    const second = classifyDuplicates('acc', rows, countBaseKeys(first.map((r) => r.fingerprint)));
    expect(second.map((r) => r.duplicate)).toEqual([true, false, false]);
  });

  it('treats the same transaction in different accounts as distinct', () => {
    const first = classifyDuplicates('a', rows, new Map());
    const second = classifyDuplicates('b', rows, countBaseKeys(first.map((r) => r.fingerprint)));
    expect(second.some((r) => r.duplicate)).toBe(false);
  });

  it('ignores case and whitespace differences in descriptions', () => {
    const first = classifyDuplicates('a', [{ date: '2026-03-01', amount: -1, description: 'Shop  One' }], new Map());
    const second = classifyDuplicates(
      'a',
      [{ date: '2026-03-01', amount: -1, description: 'SHOP ONE' }],
      countBaseKeys(first.map((r) => r.fingerprint)),
    );
    expect(second[0]!.duplicate).toBe(true);
  });
});
