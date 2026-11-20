import { describe, expect, it } from 'vitest';
import { findAnomalies } from '../anomalies';
import { categoryMap } from '@/test/fixtures';

const txn = (i: number, amount: number, categoryId = 'groceries') => ({ id: String(i), amount, categoryId, date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}` });

describe('findAnomalies', () => {
  it('flags a purchase far above the category norm', () => {
    const txns = [...Array.from({ length: 12 }, (_, i) => txn(i, -(9000 + (i % 4) * 1000))), txn(99, -48000)];
    const res = findAnomalies(txns, categoryMap);
    expect(res.map((a) => a.id)).toEqual(['99']);
    expect(res[0]!.sampleSize).toBe(13);
  });
  it('needs enough samples and ignores income, transfers and small amounts', () => {
    expect(findAnomalies([txn(1, -1000), txn(2, -90000)], categoryMap)).toEqual([]);
    const small = [...Array.from({ length: 12 }, (_, i) => txn(i, -500)), txn(99, -4000)];
    expect(findAnomalies(small, categoryMap)).toEqual([]);
    const transfers = Array.from({ length: 12 }, (_, i) => txn(i, -100000 * (i + 1), 'transfer'));
    expect(findAnomalies(transfers, categoryMap)).toEqual([]);
  });
});
