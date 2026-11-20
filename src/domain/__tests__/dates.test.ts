import { describe, expect, it } from 'vitest';
import { addMonths, daysBetween, detectDateFormat, lastDayOfMonth, monthRange, parseDate } from '../dates';

describe('parseDate', () => {
  it('parses NZ day-first dates', () => {
    expect(parseDate('25/03/2026', 'DD/MM/YYYY')).toBe('2026-03-25');
    expect(parseDate('5/3/26', 'DD/MM/YYYY')).toBe('2026-03-05');
  });
  it('rejects impossible dates', () => {
    expect(parseDate('31/02/2026', 'DD/MM/YYYY')).toBeNull();
    expect(parseDate('29/02/2025', 'DD/MM/YYYY')).toBeNull();
    expect(parseDate('29/02/2024', 'DD/MM/YYYY')).toBe('2024-02-29');
    expect(parseDate('2026-13-01', 'YYYY-MM-DD')).toBeNull();
  });
  it('parses other formats and strips time components', () => {
    expect(parseDate('2026-03-25', 'YYYY-MM-DD')).toBe('2026-03-25');
    expect(parseDate('03/25/2026', 'MM/DD/YYYY')).toBe('2026-03-25');
    expect(parseDate('25 Mar 2026', 'DD MMM YYYY')).toBe('2026-03-25');
    expect(parseDate('2026-03-25T10:15:00', 'YYYY-MM-DD')).toBe('2026-03-25');
    expect(parseDate('25-03-2026', 'DD-MM-YYYY')).toBe('2026-03-25');
  });
  it('detects formats, preferring NZ day-first when ambiguous', () => {
    expect(detectDateFormat(['01/02/2026', '03/04/2026'])).toBe('DD/MM/YYYY');
    expect(detectDateFormat(['2026-01-02'])).toBe('YYYY-MM-DD');
    expect(detectDateFormat(['12/25/2026'])).toBe('MM/DD/YYYY');
    expect(detectDateFormat([])).toBeNull();
  });
});

describe('month arithmetic', () => {
  it('handles year boundaries', () => {
    expect(addMonths('2025-12', 1)).toBe('2026-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-01', 25)).toBe('2028-02');
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(lastDayOfMonth('2028-02')).toBe('2028-02-29');
    expect(daysBetween('2026-03-28', '2026-04-02')).toBe(5);
  });
});
