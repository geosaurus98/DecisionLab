/**
 * Category budgets: planned monthly spending per expense category compared with actual
 * net spending (refunds reduce it; split parts are attributed to their own categories).
 *
 * Pace: in the current (partial) month, the expected share of the budget used so far is
 * the elapsed share of the month (day ÷ days in month). Status:
 *   over     actual > budget
 *   atRisk   current month and actual > budget × elapsed share × 1.1 (spending faster than plan)
 *   onTrack  otherwise
 * Past months are judged on the full budget only.
 */
import type { Cents } from '@/domain/money';
import type { Budget, Category } from '@/domain/types';
import { daysInMonth, firstDayOfMonth, lastDayOfMonth, monthKey, type IsoDate, type MonthKey } from '@/domain/dates';
import { categoryTrend, spendingByCategory, type AnalysedTxn } from './cashflow';
import { median } from './stats';

export type BudgetStatus = 'onTrack' | 'atRisk' | 'over';

export interface BudgetLine {
  categoryId: string;
  budget: Cents;
  actual: Cents;
  remaining: Cents;
  usedShare: number;
  status: BudgetStatus;
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

export function budgetReport(lines: AnalysedTxn[], categories: Map<string, Category>, budgets: Budget[], month: MonthKey, today: IsoDate): BudgetReport {
  const current = monthKey(today) === month;
  const [y, m] = month.split('-').map(Number) as [number, number];
  const elapsed = current ? Number(today.slice(8, 10)) / daysInMonth(y, m) : month < monthKey(today) ? 1 : 0;
  const actualByCat = new Map(spendingByCategory(lines, categories, { start: firstDayOfMonth(month), end: lastDayOfMonth(month) }).map((c) => [c.categoryId, c.total]));
  const active = budgets.filter((b) => {
    const c = categories.get(b.categoryId);
    return b.monthlyAmount > 0 && c?.kind === 'expense' && !c.archived;
  });
  const budgeted = new Set(active.map((b) => b.categoryId));
  const out: BudgetLine[] = active.map((b) => {
    const actual = actualByCat.get(b.categoryId) ?? 0;
    const usedShare = actual / b.monthlyAmount;
    const status: BudgetStatus = actual > b.monthlyAmount ? 'over' : current && actual > b.monthlyAmount * elapsed * AT_RISK_TOLERANCE ? 'atRisk' : 'onTrack';
    return { categoryId: b.categoryId, budget: b.monthlyAmount, actual, remaining: b.monthlyAmount - actual, usedShare, status };
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
