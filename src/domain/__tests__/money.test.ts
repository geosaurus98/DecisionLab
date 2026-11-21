import { describe, expect, it } from 'vitest';
import { formatMoney, parseMoney, roundCents, sumCents } from '../money';

describe('parseMoney', () => {
  it.each([
    ['1234.56', 123456],
    ['-1,234.56', -123456],
    ['$1,234.56', 123456],
    ['-$45.10', -4510],
    ['$-45.10', -4510],
    ['NZ$12', 1200],
    ['(45.00)', -4500],
    ['45.00 DR', -4500],
    ['45.00 CR', 4500],
    ['−12.50', -1250],
    ['+3.1', 310],
    ['.5', 50],
    ['12.50-', -1250],
    ['1 234.00', 123400],
    ['0.00', 0],
    ['-0.00', 0],
    ['0.125', 13],
    ['-0.125', -13],
    ['0.124', 12],
  ])('parses %s', (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it.each(['', '  ', 'abc', '12.3.4', '$', '.', '1e5', null, undefined])('rejects %s', (input) => {
    expect(parseMoney(input as string)).toBeNull();
  });

  it('avoids floating point drift that naive parsing would introduce', () => {
    // 0.1 + 0.2 style issues: 1.15 * 100 = 114.99999999999999 in floating point
    expect(parseMoney('1.15')).toBe(115);
    expect(parseMoney('4.35')).toBe(435);
    expect(sumCents([parseMoney('0.10')!, parseMoney('0.20')!])).toBe(30);
  });
});

describe('roundCents / formatMoney', () => {
  it('rounds half away from zero and normalises -0', () => {
    expect(roundCents(2.5)).toBe(3);
    expect(roundCents(-2.5)).toBe(-3);
    expect(Object.is(roundCents(-0.4), 0)).toBe(true);
  });
  it('formats NZD', () => {
    expect(formatMoney(123456)).toBe('$1,234.56');
    expect(formatMoney(-4510)).toBe('-$45.10');
    expect(formatMoney(100, { signed: true })).toBe('+$1.00');
    expect(formatMoney(-0)).toBe('$0.00');
    expect(formatMoney(-40, { whole: true })).toBe('$0');
  });
});
