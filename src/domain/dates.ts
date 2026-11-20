/**
 * Calendar dates are stored as ISO strings "YYYY-MM-DD" with no time zone. Bank statements
 * record local calendar dates, so treating them as UTC instants would shift transactions
 * across day/month boundaries. Month keys are "YYYY-MM".
 */
export type IsoDate = string;
export type MonthKey = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidYmd(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function toIsoDate(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isIsoDate(value: string): boolean {
  const m = ISO_RE.exec(value);
  return !!m && isValidYmd(Number(m[1]), Number(m[2]), Number(m[3]));
}

export function parseIso(date: IsoDate): { year: number; month: number; day: number } {
  const m = ISO_RE.exec(date);
  if (!m) throw new Error(`Invalid ISO date: ${date}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** Days since 1970-01-01 for an ISO date (UTC arithmetic, no DST issues). */
export function toDayNumber(date: IsoDate): number {
  const { year, month, day } = parseIso(date);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function fromDayNumber(dayNumber: number): IsoDate {
  const d = new Date(dayNumber * 86_400_000);
  return toIsoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromDayNumber(toDayNumber(date) + days);
}

export function daysBetween(a: IsoDate, b: IsoDate): number {
  return toDayNumber(b) - toDayNumber(a);
}

export function monthKey(date: IsoDate): MonthKey {
  return date.slice(0, 7);
}

export function addMonths(key: MonthKey, n: number): MonthKey {
  const [y, m] = key.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Inclusive list of month keys from `start` to `end`. */
export function monthRange(start: MonthKey, end: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  if (start > end) return out;
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    cur = addMonths(cur, 1);
  }
  return out;
}

export function firstDayOfMonth(key: MonthKey): IsoDate {
  return `${key}-01`;
}

export function lastDayOfMonth(key: MonthKey): IsoDate {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return toIsoDate(y, m, daysInMonth(y, m));
}

/** Today's local calendar date. */
export function todayIso(now: Date = new Date()): IsoDate {
  return toIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

const monthFmt = new Intl.DateTimeFormat('en-NZ', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const monthShortFmt = new Intl.DateTimeFormat('en-NZ', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const dateFmt = new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function formatMonth(key: MonthKey, short = false): string {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return (short ? monthShortFmt : monthFmt).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function formatDate(date: IsoDate): string {
  if (!isIsoDate(date)) return date;
  const { year, month, day } = parseIso(date);
  return dateFmt.format(new Date(Date.UTC(year, month - 1, day)));
}

export type DateFormat = 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'DD-MM-YYYY' | 'YYYY/MM/DD' | 'DD MMM YYYY';

export const DATE_FORMATS: { value: DateFormat; label: string; example: string }[] = [
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (NZ banks)', example: '25/03/2026' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (ISO)', example: '2026-03-25' },
  { value: 'DD-MM-YYYY', label: 'DD-MM-YYYY', example: '25-03-2026' },
  { value: 'YYYY/MM/DD', label: 'YYYY/MM/DD', example: '2026/03/25' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (US)', example: '03/25/2026' },
  { value: 'DD MMM YYYY', label: 'DD MMM YYYY', example: '25 Mar 2026' },
];

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function normaliseYear(y: number, raw: string): number {
  if (raw.length === 2) return 2000 + y; // two-digit years are assumed to be 20xx
  return y;
}

/** Parse a date string in the given format. Returns null when invalid (e.g. 31/02/2026). */
export function parseDate(input: string, format: DateFormat): IsoDate | null {
  const s = input.trim().split(/[ T]\d{1,2}:\d{2}/)[0]!.trim(); // drop a trailing time component
  let m: RegExpExecArray | null;
  let y: number, mo: number, d: number;
  switch (format) {
    case 'YYYY-MM-DD':
      m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
      if (!m) return null;
      [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      break;
    case 'YYYY/MM/DD':
      m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s);
      if (!m) return null;
      [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      break;
    case 'DD/MM/YYYY':
    case 'DD-MM-YYYY': {
      const sep = format === 'DD/MM/YYYY' ? '\\/' : '-';
      m = new RegExp(`^(\\d{1,2})${sep}(\\d{1,2})${sep}(\\d{2}|\\d{4})$`).exec(s);
      if (!m) return null;
      [d, mo, y] = [Number(m[1]), Number(m[2]), normaliseYear(Number(m[3]), m[3]!)];
      break;
    }
    case 'MM/DD/YYYY':
      m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
      if (!m) return null;
      [mo, d, y] = [Number(m[1]), Number(m[2]), normaliseYear(Number(m[3]), m[3]!)];
      break;
    case 'DD MMM YYYY': {
      m = /^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-](\d{2}|\d{4})$/.exec(s);
      if (!m) return null;
      const idx = MONTH_NAMES.indexOf(m[2]!.slice(0, 3).toLowerCase());
      if (idx < 0) return null;
      [d, mo, y] = [Number(m[1]), idx + 1, normaliseYear(Number(m[3]), m[3]!)];
      break;
    }
    default:
      return null;
  }
  return isValidYmd(y, mo, d) ? toIsoDate(y, mo, d) : null;
}

/** Guess the most plausible date format from sample values (all samples must parse). */
export function detectDateFormat(samples: string[]): DateFormat | null {
  const clean = samples.map((s) => s.trim()).filter(Boolean);
  if (clean.length === 0) return null;
  for (const f of DATE_FORMATS) {
    if (clean.every((s) => parseDate(s, f.value) !== null)) return f.value;
  }
  return null;
}
