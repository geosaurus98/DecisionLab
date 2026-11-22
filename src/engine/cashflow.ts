/**
 * Cash-flow analytics over categorised transactions.
 *
 * Definitions (also shown in the UI, see src/ui/definitions.ts):
 * - Income: sum of amounts in income-kind categories (positive inflows, net of reversals).
 *   Uncategorised inflows are reported separately and NOT counted as income.
 * - Spending: −(sum of amounts in expense-kind categories). Refunds (positive amounts in an
 *   expense category) reduce spending. Uncategorised outflows are counted as spending
 *   (conservative) and reported separately so they can be reviewed.
 * - Transfers: excluded from income and spending (moving money between your own accounts).
 * - Savings contributions: −(sum of amounts in savings-kind categories); money moved to
 *   savings/investments not tracked as an account here. Not consumption.
 * - Net cash flow: income − spending − savings contributions (change in tracked cash).
 * - Savings rate: (income − spending) / income — the share of income not consumed.
 */
import type { Category, CategoryKind, Transaction } from '@/domain/types';
import type { Cents } from '@/domain/money';
import { monthKey, monthRange, type IsoDate, type MonthKey } from '@/domain/dates';

export type FlowClass = CategoryKind | 'uncategorisedIn' | 'uncategorisedOut';

export type AnalysedTxn = Pick<Transaction, 'date' | 'amount' | 'categoryId'>;

export function classify(txn: AnalysedTxn, categories: Map<string, Category>): FlowClass {
  const cat = txn.categoryId ? categories.get(txn.categoryId) : undefined;
  if (!cat) return txn.amount >= 0 ? 'uncategorisedIn' : 'uncategorisedOut';
  return cat.kind;
}

export interface PeriodSummary {
  income: Cents;
  spending: Cents;
  essentialSpending: Cents;
  discretionarySpending: Cents;
  savingsContributions: Cents;
  transfersIn: Cents;
  transfersOut: Cents;
  uncategorisedIn: Cents;
  uncategorisedOut: Cents;
  netCashFlow: Cents;
  /** null when income is zero (undefined ratio). */
  savingsRate: number | null;
  transactionCount: number;
}

function emptySummary(): PeriodSummary {
  return {
    income: 0,
    spending: 0,
    essentialSpending: 0,
    discretionarySpending: 0,
    savingsContributions: 0,
    transfersIn: 0,
    transfersOut: 0,
    uncategorisedIn: 0,
    uncategorisedOut: 0,
    netCashFlow: 0,
    savingsRate: null,
    transactionCount: 0,
  };
}

function accumulate(s: PeriodSummary, txn: AnalysedTxn, categories: Map<string, Category>): void {
  s.transactionCount++;
  const cls = classify(txn, categories);
  switch (cls) {
    case 'income':
      s.income += txn.amount;
      break;
    case 'expense': {
      const cat = categories.get(txn.categoryId!)!;
      s.spending -= txn.amount;
      if (cat.essential) s.essentialSpending -= txn.amount;
      else s.discretionarySpending -= txn.amount;
      break;
    }
    case 'savings':
      s.savingsContributions -= txn.amount;
      break;
    case 'transfer':
      if (txn.amount >= 0) s.transfersIn += txn.amount;
      else s.transfersOut -= txn.amount;
      break;
    case 'uncategorisedIn':
      s.uncategorisedIn += txn.amount;
      break;
    case 'uncategorisedOut':
      // Conservative: unknown outflows are treated as discretionary spending until reviewed.
      s.uncategorisedOut -= txn.amount;
      s.spending -= txn.amount;
      s.discretionarySpending -= txn.amount;
      break;
  }
}

function finalise(s: PeriodSummary): PeriodSummary {
  s.netCashFlow = s.income + s.uncategorisedIn - s.spending - s.savingsContributions;
  s.savingsRate = s.income > 0 ? (s.income - s.spending) / s.income : null;
  return s;
}

export function inRange(date: IsoDate, start?: IsoDate, end?: IsoDate): boolean {
  return (!start || date >= start) && (!end || date <= end);
}

export function summarise(
  txns: AnalysedTxn[],
  categories: Map<string, Category>,
  range: { start?: IsoDate; end?: IsoDate } = {},
): PeriodSummary {
  const s = emptySummary();
  for (const t of txns) if (inRange(t.date, range.start, range.end)) accumulate(s, t, categories);
  return finalise(s);
}

export interface MonthlySummary extends PeriodSummary {
  month: MonthKey;
}

/** Monthly summaries for every month between the first and last transaction (gaps filled with zeros). */
export function monthlySummaries(
  txns: AnalysedTxn[],
  categories: Map<string, Category>,
  bounds?: { start: MonthKey; end: MonthKey },
): MonthlySummary[] {
  if (txns.length === 0 && !bounds) return [];
  const months = new Map<MonthKey, PeriodSummary>();
  let min = bounds?.start;
  let max = bounds?.end;
  for (const t of txns) {
    const m = monthKey(t.date);
    if (bounds && (m < bounds.start || m > bounds.end)) continue;
    if (!bounds) {
      if (!min || m < min) min = m;
      if (!max || m > max) max = m;
    }
    let s = months.get(m);
    if (!s) months.set(m, (s = emptySummary()));
    accumulate(s, t, categories);
  }
  if (!min || !max) return [];
  return monthRange(min, max).map((month) => ({ month, ...finalise(months.get(month) ?? emptySummary()) }));
}

export interface CategoryTotal {
  categoryId: string | null;
  /** Net spending in the category (positive = money spent). */
  total: Cents;
  count: number;
  share: number;
}

/** Net spending per expense category (plus uncategorised outflows) in a date range. */
export function spendingByCategory(
  txns: AnalysedTxn[],
  categories: Map<string, Category>,
  range: { start?: IsoDate; end?: IsoDate } = {},
): CategoryTotal[] {
  const totals = new Map<string | null, { total: number; count: number }>();
  for (const t of txns) {
    if (!inRange(t.date, range.start, range.end)) continue;
    const cls = classify(t, categories);
    if (cls !== 'expense' && cls !== 'uncategorisedOut') continue;
    const key = cls === 'expense' ? t.categoryId : null;
    const cur = totals.get(key) ?? { total: 0, count: 0 };
    cur.total -= t.amount;
    cur.count++;
    totals.set(key, cur);
  }
  const grand = [...totals.values()].reduce((a, b) => a + Math.max(0, b.total), 0);
  return [...totals.entries()]
    .map(([categoryId, v]) => ({
      categoryId,
      total: v.total,
      count: v.count,
      share: grand > 0 ? Math.max(0, v.total) / grand : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

/** Month × category spending matrix for trend charts. */
export function categoryTrend(
  txns: AnalysedTxn[],
  categories: Map<string, Category>,
  months: MonthKey[],
): { month: MonthKey; totals: Record<string, Cents> }[] {
  const index = new Map(months.map((m, i) => [m, i]));
  const rows = months.map((month) => ({ month, totals: {} as Record<string, Cents> }));
  for (const t of txns) {
    const i = index.get(monthKey(t.date));
    if (i === undefined) continue;
    const cls = classify(t, categories);
    if (cls !== 'expense' && cls !== 'uncategorisedOut') continue;
    const key = cls === 'expense' ? t.categoryId! : 'uncategorised';
    rows[i]!.totals[key] = (rows[i]!.totals[key] ?? 0) - t.amount;
  }
  return rows;
}

export interface CategoryChange {
  categoryId: string | null;
  a: Cents;
  b: Cents;
  change: Cents;
  /** Relative change vs period A, null when A is zero. */
  relative: number | null;
}

/**
 * Compare spending per category between two periods. Periods of different lengths are
 * normalised to a 30-day month so that e.g. a 3-month baseline compares fairly with one month.
 */
export function comparePeriods(
  txns: AnalysedTxn[],
  categories: Map<string, Category>,
  a: { start: IsoDate; end: IsoDate },
  b: { start: IsoDate; end: IsoDate },
  normaliseToMonthly = true,
): CategoryChange[] {
  const days = (r: { start: IsoDate; end: IsoDate }) =>
    (Date.parse(`${r.end}T00:00:00Z`) - Date.parse(`${r.start}T00:00:00Z`)) / 86_400_000 + 1;
  const scaleA = normaliseToMonthly ? 30.4375 / days(a) : 1;
  const scaleB = normaliseToMonthly ? 30.4375 / days(b) : 1;
  const ta = new Map(spendingByCategory(txns, categories, a).map((c) => [c.categoryId, c.total]));
  const tb = new Map(spendingByCategory(txns, categories, b).map((c) => [c.categoryId, c.total]));
  const keys = new Set([...ta.keys(), ...tb.keys()]);
  return [...keys]
    .map((categoryId) => {
      const va = Math.round((ta.get(categoryId) ?? 0) * scaleA);
      const vb = Math.round((tb.get(categoryId) ?? 0) * scaleB);
      return { categoryId, a: va, b: vb, change: vb - va, relative: va !== 0 ? (vb - va) / Math.abs(va) : null };
    })
    .sort((x, y) => Math.abs(y.change) - Math.abs(x.change));
}

/** Latest month that is complete relative to `today` (the month before today's month). */
export function lastCompleteMonth(today: IsoDate): MonthKey {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) - 1;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/**
 * Detect likely internal transfers: an outflow and an equal inflow in two different
 * accounts within `windowDays`, where neither is already categorised as a transfer.
 */
export function findTransferPairs<T extends AnalysedTxn & { id: string; accountId: string }>(
  txns: T[],
  categories: Map<string, Category>,
  windowDays = 3,
  /** Pairs the user said are not transfers, as "outId|inId". */
  excluded?: Set<string>,
): [T, T][] {
  const isTransfer = (t: T) => classify(t, categories) === 'transfer';
  const outs = txns.filter((t) => t.amount < 0 && !isTransfer(t));
  const ins = txns.filter((t) => t.amount > 0 && !isTransfer(t));
  const byAmount = new Map<number, T[]>();
  for (const t of ins) {
    const list = byAmount.get(t.amount) ?? [];
    list.push(t);
    byAmount.set(t.amount, list);
  }
  const used = new Set<string>();
  const pairs: [T, T][] = [];
  const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  for (const o of outs) {
    const candidates = byAmount.get(-o.amount) ?? [];
    // Closest date wins (same-day transfers are the norm), so long histories pair correctly.
    let match: T | undefined;
    let best = Infinity;
    for (const i of candidates) {
      if (used.has(i.id) || i.accountId === o.accountId || excluded?.has(`${o.id}|${i.id}`)) continue;
      const gap = Math.abs(dayNum(i.date) - dayNum(o.date));
      if (gap <= windowDays && gap < best) {
        best = gap;
        match = i;
      }
    }
    if (match) {
      used.add(match.id);
      pairs.push([o, match]);
    }
  }
  return pairs;
}
