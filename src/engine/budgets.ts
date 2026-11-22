/**
 * Category budgets: planned monthly spending per expense category compared with actual
 * net spending (refunds reduce it; split parts are attributed to their own categories).
 *
 * Pace (current month only): expected spending so far =
 *   recurring bills in the category already due this month (they are lumpy, not spread)
 *   + the rest of the budget × elapsed share of the month (day ÷ days in month).
 * Status:
 *   over     actual > budget
 *   atRisk   current month and actual > expected so far × 1.1
 *   onTrack  otherwise
 * Past months are judged on the full budget only.
 */
import type { Cents } from '@/domain/money';
import type { Budget, Category } from '@/domain/types';
import { addMonths, daysInMonth, firstDayOfMonth, lastDayOfMonth, monthKey, type IsoDate, type MonthKey } from '@/domain/dates';
import { categoryTrend, spendingByCategory, type AnalysedTxn } from './cashflow';
import { occurrences, type RecurringSeries } from './recurring';
import { median } from './stats';

export type BudgetStatus = 'onTrack' | 'atRisk' | 'over';

export interface BudgetLine {
  categoryId: string;
  budget: Cents;
  actual: Cents;
  remaining: Cents;
  usedShare: number;
  status: BudgetStatus;
  /** Spending expected by today under the plan (current month), or the budget for past months. */
  expectedByNow: Cents;
  /** Recurring bills in this category expected during the month. */
  billsThisMonth: Cents;
  /** Amount carried in from earlier months (rollover budgets only; may be negative). */
  carried: Cents;
  /** Budget plus carried amount: what is available this month. */
  available: Cents;
}

export interface BudgetReport {
  month: MonthKey;
  /** Share of the month elapsed (1 for past months). */
  elapsed: number;
  lines: BudgetLine[];
  totalBudget: Cents;
  totalActual: Cents;
  /** Spending in categories without a budget (net, expense categories + uncategorised). */
  unbudgetedActual: Cents;
  essentialBudget: Cents;
  discretionaryBudget: Cents;
}

export const AT_RISK_TOLERANCE = 1.1;

export function budgetReport(
  lines: AnalysedTxn[],
  categories: Map<string, Category>,
  budgets: Budget[],
  month: MonthKey,
  today: IsoDate,
  recurring: Pick<RecurringSeries, 'lastDate' | 'cadence' | 'direction' | 'active' | 'typicalAmount' | 'categoryId'>[] = [],
): BudgetReport {
  const current = monthKey(today) === month;
  const [y, m] = month.split('-').map(Number) as [number, number];
  const elapsed = current ? Number(today.slice(8, 10)) / daysInMonth(y, m) : month < monthKey(today) ? 1 : 0;
  const actualByCat = new Map(spendingByCategory(lines, categories, { start: firstDayOfMonth(month), end: lastDayOfMonth(month) }).map((c) => [c.categoryId, c.total]));
  const active = budgets.filter((b) => {
    const c = categories.get(b.categoryId);
    return b.monthlyAmount > 0 && c?.kind === 'expense' && !c.archived;
  });
  const budgeted = new Set(active.map((b) => b.categoryId));
  const start = firstDayOfMonth(month);
  const end = lastDayOfMonth(month);
  const out: BudgetLine[] = active.map((b) => {
    const actual = actualByCat.get(b.categoryId) ?? 0;
    const carried = rolloverCarry(lines, categories, b, month);
    const available = b.monthlyAmount + carried;
    const usedShare = available > 0 ? actual / available : actual > 0 ? Infinity : 0;
    let billsThisMonth = 0;
    let billsDue = 0;
    for (const r of recurring) {
      if (!r.active || r.direction !== 'out' || r.categoryId !== b.categoryId) continue;
      for (const d of occurrences(r, start, end)) {
        billsThisMonth += r.typicalAmount;
        if (d <= today) billsDue += r.typicalAmount;
      }
    }
    const flexible = Math.max(0, available - billsThisMonth);
    const expectedByNow = current ? Math.min(Math.max(available, 0), Math.round(billsDue + flexible * elapsed)) : available;
    const status: BudgetStatus = actual > available ? 'over' : current && actual > expectedByNow * AT_RISK_TOLERANCE ? 'atRisk' : 'onTrack';
    return { categoryId: b.categoryId, budget: b.monthlyAmount, actual, remaining: available - actual, usedShare, status, expectedByNow, billsThisMonth, carried, available };
  });
  let unbudgetedActual = 0;
  for (const [id, total] of actualByCat) if (id === null || !budgeted.has(id)) unbudgetedActual += total;
  const sumBy = (pred: (c: Category | undefined) => boolean) => active.filter((b) => pred(categories.get(b.categoryId))).reduce((a, b) => a + b.monthlyAmount, 0);
  return {
    month,
    elapsed,
    lines: out.sort((a, b) => b.usedShare - a.usedShare),
    totalBudget: active.reduce((a, b) => a + b.monthlyAmount, 0),
    totalActual: out.reduce((a, l) => a + l.actual, 0),
    unbudgetedActual,
    essentialBudget: sumBy((c) => c?.essential === true),
    discretionaryBudget: sumBy((c) => c?.essential !== true),
  };
}

/**
 * Rollover carry into `month`: Σ (budget − actual) over complete months from rolloverFrom up
 * to the month before. Unspent amounts add to this month's budget; overspending reduces it.
 */
export function rolloverCarry(lines: AnalysedTxn[], categories: Map<string, Category>, b: Budget, month: MonthKey): Cents {
  if (!b.rollover || !b.rolloverFrom || b.rolloverFrom >= month) return 0;
  let carry = 0;
  for (let m = b.rolloverFrom; m < month; m = addMonths(m, 1)) {
    const actual = spendingByCategory(lines, categories, { start: firstDayOfMonth(m), end: lastDayOfMonth(m) }).find((c) => c.categoryId === b.categoryId)?.total ?? 0;
    carry += b.monthlyAmount - actual;
  }
  return carry;
}

export interface BudgetHistoryRow {
  month: MonthKey;
  cells: { categoryId: string; budget: Cents; actual: Cents }[];
  totalBudget: Cents;
  totalActual: Cents;
}

/** Planned vs actual per budgeted category for each month (uses today's budget amounts). */
export function budgetHistory(lines: AnalysedTxn[], categories: Map<string, Category>, budgets: Budget[], months: MonthKey[]): BudgetHistoryRow[] {
  const active = budgets.filter((b) => b.monthlyAmount > 0 && categories.get(b.categoryId)?.kind === 'expense');
  return months.map((month) => {
    const totals = new Map(spendingByCategory(lines, categories, { start: firstDayOfMonth(month), end: lastDayOfMonth(month) }).map((c) => [c.categoryId, c.total]));
    const cells = active.map((b) => ({ categoryId: b.categoryId, budget: b.monthlyAmount, actual: totals.get(b.categoryId) ?? 0 }));
    return { month, cells, totalBudget: cells.reduce((a, c) => a + c.budget, 0), totalActual: cells.reduce((a, c) => a + c.actual, 0) };
  });
}

/**
 * Suggested budget per expense category: the median of its monthly net spending over the
 * given complete months, rounded up to the next $10. Categories with no spending are omitted.
 */
export function suggestBudgets(lines: AnalysedTxn[], categories: Map<string, Category>, months: MonthKey[]): Map<string, Cents> {
  const rows = categoryTrend(lines, categories, months);
  const out = new Map<string, Cents>();
  for (const c of categories.values()) {
    if (c.kind !== 'expense' || c.archived) continue;
    const values = rows.map((r) => Math.max(0, r.totals[c.id] ?? 0));
    if (values.every((v) => v === 0)) continue;
    out.set(c.id, Math.ceil(median(values) / 1000) * 1000);
  }
  return out;
}
