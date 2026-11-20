/**
 * Recurring transaction detection.
 *
 * Transactions are grouped by (merchant key, direction). A group is recurring when it has
 * at least `minOccurrences` transactions whose intervals cluster around a known cadence.
 * Confidence combines interval regularity and amount stability. This is a heuristic: the
 * UI labels results as "estimated" and lets the user dismiss them.
 */
import type { Cents } from '@/domain/money';
import { addDays, daysBetween, type IsoDate } from '@/domain/dates';
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
    const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
    // Collapse same-day duplicates (e.g. split payments) by summing them.
    const byDay = new Map<IsoDate, RecurringInput[]>();
    for (const t of sorted) byDay.set(t.date, [...(byDay.get(t.date) ?? []), t]);
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
    const nextExpected = addDays(lastDate, Math.round(spec.days));
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
