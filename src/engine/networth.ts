/**
 * Net worth over time: the sum of month-end balances across accounts. Each account's balance
 * history is reconstructed from its current balance anchor and its transactions (see
 * balances.ts). An account contributes from the month its history starts (its first
 * transaction, or its balance date if it has none); credit cards contribute negative balances.
 */
import type { Cents } from '@/domain/money';
import type { Account } from '@/domain/types';
import { lastDayOfMonth, monthKey, type MonthKey } from '@/domain/dates';
import { balanceSeries } from './balances';
import { currentBalance } from './flexibility';

export interface NetWorthPoint {
  month: MonthKey;
  total: Cents;
  liquid: Cents;
  byAccount: Record<string, Cents>;
  /** Accounts with a known balance at this month end. */
  accounts: number;
}

export function netWorthSeries(accounts: Account[], txns: { accountId: string; date: string; amount: Cents }[], months: MonthKey[]): { points: NetWorthPoint[]; excluded: Account[] } {
  const excluded: Account[] = [];
  const series = new Map<string, { date: string; balance: Cents }[]>();
  for (const a of accounts) {
    const cur = currentBalance(a, txns);
    if (!cur) {
      excluded.push(a);
      continue;
    }
    series.set(a.id, balanceSeries(txns.filter((t) => t.accountId === a.id), cur.anchor));
  }
  const points = months.map((month) => {
    const end = lastDayOfMonth(month);
    const byAccount: Record<string, Cents> = {};
    let total = 0;
    let liquid = 0;
    let n = 0;
    for (const a of accounts) {
      const s = series.get(a.id);
      if (!s || s.length === 0 || monthKey(s[0]!.date) > month) continue;
      // Last point on or before month end (binary search).
      let lo = 0;
      let hi = s.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (s[mid]!.date <= end) lo = mid;
        else hi = mid - 1;
      }
      const v = s[lo]!.date <= end ? s[lo]!.balance : null;
      if (v === null) continue;
      byAccount[a.id] = v;
      total += v;
      if (a.includeInLiquid) liquid += v;
      n++;
    }
    return { month, total, liquid, byAccount, accounts: n };
  });
  return { points, excluded };
}
