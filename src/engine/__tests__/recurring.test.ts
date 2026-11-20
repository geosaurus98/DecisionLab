import { describe, expect, it } from 'vitest';
import { detectRecurring, type RecurringInput } from '../recurring';
import { addDays } from '@/domain/dates';

function series(merchant: string, start: string, everyDays: number, n: number, amount: number, jitter: number[] = []): RecurringInput[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${merchant}-${i}`,
    date: addDays(start, i * everyDays + (jitter[i] ?? 0)),
    amount,
    merchant,
    categoryId: 'subs',
  }));
}

describe('detectRecurring', () => {
  it('detects a monthly subscription with date jitter', () => {
    const res = detectRecurring(series('NETFLIX', '2026-01-03', 30, 6, -2299, [0, 1, -1, 2, 0, 1]), { asOf: '2026-06-20' });
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ cadence: 'monthly', typicalAmount: 2299, monthlyEquivalent: -2299, direction: 'out', active: true });
    expect(res[0]!.confidence).toBeGreaterThan(0.9);
  });

  it('detects fortnightly income and converts to a monthly equivalent', () => {
    const res = detectRecurring(series('ACME PAYROLL', '2026-01-08', 14, 8, 210000), { asOf: '2026-04-20' });
    expect(res[0]!.cadence).toBe('fortnightly');
    expect(res[0]!.monthlyEquivalent).toBe(Math.round(210000 * (26 / 12)));
  });

  it('ignores irregular spending and series that are too short', () => {
    const irregular: RecurringInput[] = ['2026-01-01', '2026-01-04', '2026-02-20', '2026-02-22', '2026-04-30'].map((d, i) => ({
      id: String(i),
      date: d,
      amount: -1500 - i * 700,
      merchant: 'CAFE',
      categoryId: 'eating',
    }));
    expect(detectRecurring(irregular)).toHaveLength(0);
    expect(detectRecurring(series('GYM', '2026-01-01', 30, 2, -5000))).toHaveLength(0);
  });

  it('marks series with no recent payment as inactive', () => {
    const res = detectRecurring(series('OLD SUB', '2025-01-01', 30, 4, -1000), { asOf: '2026-01-01' });
    expect(res[0]!.active).toBe(false);
  });
});
