/**
 * Money is represented as integer minor units (cents) to avoid binary floating-point
 * rounding errors in ledger arithmetic. All persisted and summed amounts are `Cents`.
 *
 * Projection engines (compound growth, Monte Carlo) work with fractional cents internally,
 * because they are illustrative models rather than ledgers, and round only at their outputs.
 */
export type Cents = number;

export const CURRENCY = 'NZD';

/** Assert that a value is a safe integer number of cents. */
export function assertCents(value: number, label = 'amount'): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be an integer number of cents, received ${value}`);
  }
  return value;
}

/** Round a (possibly fractional) cent value half away from zero. */
export function roundCents(value: number): Cents {
  if (!Number.isFinite(value)) throw new Error(`Cannot round non-finite value ${value}`);
  const rounded = Math.sign(value) * Math.round(Math.abs(value));
  return rounded === 0 ? 0 : rounded; // normalise -0
}

/** Convert whole/decimal dollars (e.g. user input already validated) to cents. */
export function dollarsToCents(dollars: number): Cents {
  return roundCents(dollars * 100);
}

export function centsToDollars(cents: Cents): number {
  return cents / 100;
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/**
 * Parse a user- or bank-supplied money string into cents without floating-point
 * multiplication. Accepts New Zealand formats such as:
 *   "1234.56", "-1,234.56", "$1,234.56", "NZ$12", "(45.00)", "45.00 DR", "45.00 CR",
 *   "−12.50" (unicode minus), "+3.1", ".5"
 * Returns null for empty or unparseable input.
 */
export function parseMoney(input: string | null | undefined): Cents | null {
  if (input === null || input === undefined) return null;
  let s = String(input).trim();
  if (s === '') return null;

  let negative = false;
  // Accounting negative: (123.45)
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  // DR / CR suffix (debit = money out, credit = money in)
  const drcr = /\s*(DR|CR)\.?$/i.exec(s);
  if (drcr) {
    if (drcr[1]!.toUpperCase() === 'DR') negative = !negative;
    s = s.slice(0, drcr.index).trim();
  }
  s = s.replace(/[−‒–—]/g, '-'); // unicode minus/dashes
  // Leading sign may appear before or after currency symbol: -$5, $-5
  s = s.replace(/^(NZ\$|NZD|\$)\s*/i, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1).trim();
  } else if (s.startsWith('+')) {
    s = s.slice(1).trim();
  }
  s = s.replace(/^(NZ\$|NZD|\$)\s*/i, '');
  // Trailing minus: "12.50-"
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1).trim();
  }
  // Remove thousands separators (commas, spaces, thin spaces)
  s = s.replace(/[,\s  ]/g, '');
  if (!/^(\d+)?(\.\d*)?$/.test(s) || s === '' || s === '.') return null;

  const [wholePart = '', fracPartRaw = ''] = s.split('.');
  const whole = wholePart === '' ? 0 : Number(wholePart);
  if (!Number.isSafeInteger(whole)) return null;
  let cents: number;
  if (fracPartRaw.length <= 2) {
    cents = whole * 100 + Number(fracPartRaw.padEnd(2, '0') || '0');
  } else {
    // More than two decimals: round half away from zero on the third digit onwards.
    const firstTwo = Number(fracPartRaw.slice(0, 2));
    const rest = fracPartRaw.slice(2);
    const roundUp = rest[0] !== undefined && Number(rest[0]) >= 5;
    cents = whole * 100 + firstTwo + (roundUp ? 1 : 0);
  }
  if (!Number.isSafeInteger(cents)) return null;
  const result = negative ? -cents : cents;
  return result === 0 ? 0 : result;
}

const nzdFormatter = new Intl.NumberFormat('en-NZ', {
  style: 'currency',
  currency: 'NZD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const nzdWholeFormatter = new Intl.NumberFormat('en-NZ', {
  style: 'currency',
  currency: 'NZD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Format cents as NZ dollars, e.g. -123456 -> "-$1,234.56". */
export function formatMoney(cents: Cents, opts: { whole?: boolean; signed?: boolean } = {}): string {
  const formatter = opts.whole ? nzdWholeFormatter : nzdFormatter;
  const text = formatter.format(cents / 100);
  if (opts.signed && cents > 0) return `+${text}`;
  return text;
}

/** Compact format for chart axes: $1.2k, $35k, $1.4m. */
export function formatMoneyCompact(cents: Cents): string {
  const dollars = cents / 100;
  const abs = Math.abs(dollars);
  const sign = dollars < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}m`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function formatPercent(fraction: number, digits = 1): string {
  if (!Number.isFinite(fraction)) return '—';
  return `${(fraction * 100).toFixed(digits)}%`;
}
