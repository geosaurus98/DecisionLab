/**
 * Recurring transaction detection.
 *
 * Transactions are grouped by (merchant key, direction). A group is recurring when it has
 * at least `minOccurrences` transactions whose intervals cluster around a known cadence.
 * Confidence combines interval regularity and amount stability. This is a heuristic: the
 * UI labels results as "estimated" and lets the user dismiss them.
 */
import type { Cents } from '@/domain/money';
import { addDays, daysBetween, daysInMonth, parseIso, toIsoDate, type IsoDate } from '@/domain/dates';
import type { RecurringOverride } from '@/domain/types';
import { mean, median, stdev } from './stats';

export type Cadence = 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annual';

export const CADENCES: { cadence: Cadence; days: number; tolerance: number; perMonth: number }[] = [
  { cadence: 'weekly', days: 7, tolerance: 1, perMonth: 52 / 12 },
  { cadence: 'fortnightly', days: 14, tolerance: 2, perMonth: 26 / 12 },
  { cadence: 'monthly', days: 30.44, tolerance: 4, perMonth: 1 },
  { cadence: 'quarterly', days: 91.3, tolerance: 8, perMonth: 1 / 3 },
  { cadence: 'annual', days: 365.25, tolerance: 12, perMonth: 1 / 12 },
];

export interface RecurringInput {
  id: string;
  date: IsoDate;
  amount: Cents;
  merchant: string;
  categoryId: string | null;
}

export interface RecurringSeries {
  key: string;
  merchant: string;
  direction: 'in' | 'out';
  cadence: Cadence;
  occurrences: number;
  /** Median absolute amount per occurrence. */
  typicalAmount: Cents;
  /** Signed monthly equivalent (negative = outflow). */
  monthlyEquivalent: Cents;
  lastDate: IsoDate;
  nextExpected: IsoDate;
  /** 0–1. Share of intervals matching the cadence × amount stability. */
  confidence: number;
  /** Coefficient of variation of amounts (0 = fixed amount). */
  amountVariation: number;
  categoryId: string | null;
  transactionIds: string[];
  /** False if no occurrence within ~1.5 cadence periods of `asOf` (probably cancelled). */
  active: boolean;
}

export function detectRecurring(
  txns: RecurringInput[],
  opts: { minOccurrences?: number; asOf?: IsoDate; minConfidence?: number } = {},
): RecurringSeries[] {
  const minOcc = opts.minOccurrences ?? 3;
  const minConfidence = opts.minConfidence ?? 0.5;
  const groups = new Map<string, RecurringInput[]>();
  for (const t of txns) {
    if (t.amount === 0) continue;
    const dir = t.amount < 0 ? 'out' : 'in';
    const key = `${dir}:${t.merchant}`;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }
  const asOf = opts.asOf ?? [...txns].map((t) => t.date).sort().at(-1);
  const results: RecurringSeries[] = [];
  for (const [key, group] of groups) {
    if (group.length < minOcc) continue;
    // Quick rejection before any sorting: a series needs at least minOcc distinct days.
    if (new Set(group.map((t) => t.date)).size < minOcc) continue;
    const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
    // Collapse same-day duplicates (e.g. split payments) by summing them.
    const byDay = new Map<IsoDate, RecurringInput[]>();
    for (const t of sorted) {
      const day = byDay.get(t.date);
      if (day) day.push(t);
      else byDay.set(t.date, [t]);
    }
    const days = [...byDay.keys()];
    if (days.length < minOcc) continue;
    const intervals = days.slice(1).map((d, i) => daysBetween(days[i]!, d));
    const med = median(intervals);
    const spec = CADENCES.find((c) => Math.abs(med - c.days) <= c.tolerance);
    if (!spec) continue;
    const matching = intervals.filter((iv) => Math.abs(iv - spec.days) <= spec.tolerance * 1.5).length;
    const regularity = matching / intervals.length;
    const amounts = days.map((d) => Math.abs(byDay.get(d)!.reduce((a, t) => a + t.amount, 0)));
    const avg = mean(amounts);
    const cv = avg > 0 ? stdev(amounts) / avg : 0;
    const amountStability = Math.max(0, 1 - Math.min(cv, 1));
    const confidence = regularity * (0.6 + 0.4 * amountStability);
    if (confidence < minConfidence) continue;
    const typical = Math.round(median(amounts));
    const sign = key.startsWith('out:') ? -1 : 1;
    const lastDate = days.at(-1)!;
    const nextExpected = stepCadence(lastDate, spec.cadence, 1);
    const active = !asOf || daysBetween(lastDate, asOf) <= spec.days * 1.5 + spec.tolerance;
    const categoryCounts = new Map<string | null, number>();
    for (const t of sorted) categoryCounts.set(t.categoryId, (categoryCounts.get(t.categoryId) ?? 0) + 1);
    const categoryId = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    results.push({
      key,
      merchant: sorted[0]!.merchant,
      direction: sign < 0 ? 'out' : 'in',
      cadence: spec.cadence,
      occurrences: days.length,
      typicalAmount: typical,
      monthlyEquivalent: Math.round(sign * typical * spec.perMonth),
      lastDate,
      nextExpected,
      confidence,
      amountVariation: cv,
      categoryId,
      transactionIds: sorted.map((t) => t.id),
      active,
    });
  }
  return results.sort((a, b) => Math.abs(b.monthlyEquivalent) - Math.abs(a.monthlyEquivalent));
}

/**
 * Move a date by n cadence periods. Weekly/fortnightly step in days; monthly, quarterly and
 * annual step in calendar months, keeping the day of month (clamped to the month's length,
 * so 31 Jan + 1 month = 28/29 Feb).
 */
export function stepCadence(date: IsoDate, cadence: Cadence, n: number): IsoDate {
  if (cadence === 'weekly') return addDays(date, 7 * n);
  if (cadence === 'fortnightly') return addDays(date, 14 * n);
  const months = (cadence === 'monthly' ? 1 : cadence === 'quarterly' ? 3 : 12) * n;
  const { year, month, day } = parseIso(date);
  const total = year * 12 + (month - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return toIsoDate(y, m, Math.min(day, daysInMonth(y, m)));
}

/** Dates of a series' occurrences (past and projected) within [start, end]. */
export function occurrences(series: Pick<RecurringSeries, 'lastDate' | 'cadence'>, start: IsoDate, end: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  // Step back from the last payment, then forward, always from the anchor to avoid drift.
  for (let n = 0; n > -1000; n--) {
    const d = stepCadence(series.lastDate, series.cadence, n);
    if (d < start) break;
    if (d <= end) out.push(d);
  }
  for (let n = 1; n < 1000; n++) {
    const d = stepCadence(series.lastDate, series.cadence, n);
    if (d > end) break;
    if (d >= start) out.push(d);
  }
  return out.sort();
}

export interface EffectiveSeries extends RecurringSeries {
  /** Display name (user label or merchant). */
  label: string;
  confirmed: boolean;
  /** True when the expected amount comes from the user rather than detection. */
  amountOverridden: boolean;
}

const PER_MONTH: Record<Cadence, number> = Object.fromEntries(CADENCES.map((c) => [c.cadence, c.perMonth])) as Record<Cadence, number>;

/** Apply user overrides: drop dismissed series, use labels and expected amounts. */
export function applyOverrides(series: RecurringSeries[], overrides: RecurringOverride[]): EffectiveSeries[] {
  const byKey = new Map(overrides.map((o) => [o.key, o]));
  return series
    .filter((s) => byKey.get(s.key)?.status !== 'dismissed')
    .map((s) => {
      const o = byKey.get(s.key);
      const amount = o?.expectedAmount ?? s.typicalAmount;
      const sign = s.direction === 'out' ? -1 : 1;
      return {
        ...s,
        label: o?.label || s.merchant,
        confirmed: o?.status === 'confirmed',
        amountOverridden: o?.expectedAmount !== undefined,
        typicalAmount: amount,
        monthlyEquivalent: Math.round(sign * amount * PER_MONTH[s.cadence]),
      };
    });
}

export interface UpcomingBill {
  key: string;
  label: string;
  date: IsoDate;
  /** Positive amount expected to go out. */
  amount: Cents;
  categoryId: string | null;
}

/** Projected (not yet paid) occurrences of active outgoing series between `from` and `to` inclusive. */
export function upcomingBills(series: (RecurringSeries & { label?: string })[], from: IsoDate, to: IsoDate): UpcomingBill[] {
  const out: UpcomingBill[] = [];
  for (const s of series) {
    if (!s.active || s.direction !== 'out') continue;
    for (const d of occurrences(s, from, to)) {
      if (d <= s.lastDate) continue; // already paid
      out.push({ key: s.key, label: s.label ?? s.merchant, date: d, amount: s.typicalAmount, categoryId: s.categoryId });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
}

/**
 * Bills expected before the next regular income arrives. Money needed for these is not really
 * available for discretionary decisions even though it is sitting in the account today.
 * Returns null when no active recurring income is detected.
 */
export function billsBeforeNextIncome(series: (RecurringSeries & { label?: string })[], today: IsoDate): { nextIncome: IsoDate; bills: UpcomingBill[]; total: Cents } | null {
  const incomeDates = series
    .filter((s) => s.active && s.direction === 'in')
    .map((s) => occurrences(s, addDays(today, 1), addDays(today, 400)).find((d) => d > s.lastDate))
    .filter((d): d is IsoDate => d !== undefined);
  if (incomeDates.length === 0) return null;
  const nextIncome = incomeDates.sort()[0]!;
  const bills = upcomingBills(series, today, addDays(nextIncome, -1));
  return { nextIncome, bills, total: bills.reduce((a, b) => a + b.amount, 0) };
}
