/**
 * Reactive data hooks. Dexie's useLiveQuery re-runs queries when the underlying tables
 * change, so every page stays consistent after imports, edits and restores. Derived
 * analytics are memoised and computed by the pure engines in src/engine.
 */
import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { DEFAULT_PROFILE, SETTING_KEYS } from '@/data/settings';
import type { Category, FinancialProfile, Transaction } from '@/domain/types';
import { monthlySummaries, lastCompleteMonth, type MonthlySummary } from '@/engine/cashflow';
import { detectRecurring, type RecurringSeries } from '@/engine/recurring';
import { estimateFlexibility, type FlexibilityEstimate } from '@/engine/flexibility';
import { todayIso, type IsoDate, type MonthKey } from '@/domain/dates';

export function useCategories(): Category[] | undefined {
  return useLiveQuery(() => db.categories.orderBy('sortOrder').toArray(), []);
}

export function useCategoryMap(): Map<string, Category> {
  const cats = useCategories();
  return useMemo(() => new Map((cats ?? []).map((c) => [c.id, c])), [cats]);
}

export function useAccounts() {
  return useLiveQuery(() => db.accounts.toArray(), []);
}

export function useTransactions(): Transaction[] | undefined {
  return useLiveQuery(() => db.transactions.orderBy('date').reverse().toArray(), []);
}

export function useProfile(): FinancialProfile | undefined {
  return useLiveQuery(async () => {
    const rec = await db.settings.get(SETTING_KEYS.profile);
    return { ...DEFAULT_PROFILE, ...((rec?.value as Partial<FinancialProfile>) ?? {}) };
  }, []);
}

export function useDismissedRecurring(): Set<string> {
  const v = useLiveQuery(() => db.settings.get(SETTING_KEYS.dismissedRecurring), []);
  return useMemo(() => new Set((v?.value as string[] | undefined) ?? []), [v]);
}

export interface Analytics {
  loading: boolean;
  transactions: Transaction[];
  categories: Category[];
  categoryMap: Map<string, Category>;
  months: MonthlySummary[];
  /** Months strictly before the current month (complete). */
  completeMonths: MonthlySummary[];
  recurring: RecurringSeries[];
  today: IsoDate;
  lastComplete: MonthKey;
}

export function useAnalytics(): Analytics {
  const transactions = useTransactions();
  const categories = useCategories();
  const dismissed = useDismissedRecurring();
  const today = todayIso();
  return useMemo(() => {
    const txns = transactions ?? [];
    const cats = categories ?? [];
    const categoryMap = new Map(cats.map((c) => [c.id, c]));
    const months = monthlySummaries(txns, categoryMap);
    const lastComplete = lastCompleteMonth(today);
    const completeMonths = months.filter((m) => m.month <= lastComplete);
    const recurring = detectRecurring(
      txns.filter((t) => {
        const kind = t.categoryId ? categoryMap.get(t.categoryId)?.kind : undefined;
        return kind !== 'transfer';
      }),
      { asOf: today },
    ).filter((r) => !dismissed.has(r.key));
    return {
      loading: transactions === undefined || categories === undefined,
      transactions: txns,
      categories: cats,
      categoryMap,
      months,
      completeMonths,
      recurring,
      today,
      lastComplete,
    };
  }, [transactions, categories, dismissed, today]);
}

export function useFlexibility(analytics: Analytics): FlexibilityEstimate | undefined {
  const accounts = useAccounts();
  const goals = useLiveQuery(() => db.goals.toArray(), []);
  const profile = useProfile();
  return useMemo(() => {
    if (!accounts || !goals || !profile || analytics.loading) return undefined;
    return estimateFlexibility({
      accounts,
      goals,
      profile,
      completeMonths: analytics.completeMonths,
      recurring: analytics.recurring,
      categories: analytics.categoryMap,
      today: analytics.today,
    });
  }, [accounts, goals, profile, analytics]);
}

export function useHasDemo(): boolean {
  return useLiveQuery(async () => (await db.accounts.filter((a) => a.isDemo === true).count()) > 0, []) ?? false;
}
