/**
 * Account balances from statements.
 *
 * Many bank exports include a running balance after each transaction. From it DecisionLab
 * derives (a) the account's closing balance — a *known* figure, unlike a typed-in balance —
 * and (b) consistency checks: between two printed balances, the transactions in between must
 * add up exactly. A mismatch means transactions are missing (e.g. a gap between imported
 * statements) or duplicated.
 *
 * Ordering: statements list either oldest-first or newest-first. The direction is taken from
 * the dates (first vs last row); if every row has the same date, from which direction the
 * printed balances agree with the amounts.
 */
import type { Cents } from '@/domain/money';
import type { IsoDate } from '@/domain/dates';

export interface BalanceRow {
  id: string;
  date: IsoDate;
  amount: Cents;
  balanceAfter?: Cents | null;
  rowIndex?: number;
  importId?: string | null;
}

export type FileOrder = 'oldestFirst' | 'newestFirst';

/** Direction of a single file's rows (given in file order). */
export function fileOrder(rows: Pick<BalanceRow, 'date' | 'amount' | 'balanceAfter'>[]): FileOrder {
  if (rows.length < 2) return 'oldestFirst';
  const first = rows[0]!.date;
  const last = rows[rows.length - 1]!.date;
  if (first !== last) return first < last ? 'oldestFirst' : 'newestFirst';
  let asc = 0;
  let desc = 0;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]!;
    const cur = rows[i]!;
    if (prev.balanceAfter == null || cur.balanceAfter == null) continue;
    if (prev.balanceAfter + cur.amount === cur.balanceAfter) asc++;
    if (cur.balanceAfter + prev.amount === prev.balanceAfter) desc++;
  }
  return desc > asc ? 'newestFirst' : 'oldestFirst';
}

/**
 * Sort an account's transactions chronologically. Same-day rows keep their statement order
 * (reversed for newest-first files). Rows without a file position (manual entries) sort
 * after imported rows on the same day.
 */
export function chronological<T extends BalanceRow>(rows: T[]): T[] {
  const orders = new Map<string, FileOrder>();
  const byImport = new Map<string, T[]>();
  for (const r of rows) {
    if (r.importId && r.rowIndex !== undefined) {
      const list = byImport.get(r.importId) ?? [];
      list.push(r);
      byImport.set(r.importId, list);
    }
  }
  for (const [id, list] of byImport) orders.set(id, fileOrder([...list].sort((a, b) => a.rowIndex! - b.rowIndex!)));
  const pos = (r: T) => {
    if (r.rowIndex === undefined || !r.importId) return Number.MAX_SAFE_INTEGER;
    return orders.get(r.importId) === 'newestFirst' ? -r.rowIndex : r.rowIndex;
  };
  return [...rows].sort((a, b) => a.date.localeCompare(b.date) || pos(a) - pos(b));
}

/** The latest printed balance (chronologically), or null when no row carries one. */
export function closingBalance(rows: BalanceRow[]): { amount: Cents; asOf: IsoDate; rowId: string } | null {
  const sorted = chronological(rows);
  for (let i = sorted.length - 1; i >= 0; i--) {
    const r = sorted[i]!;
    if (r.balanceAfter != null) {
      // Only trust a closing balance if no later transaction exists without a balance.
      const later = sorted.slice(i + 1);
      const adjust = later.reduce((a, t) => a + t.amount, 0);
      return { amount: r.balanceAfter + adjust, asOf: later.length ? later[later.length - 1]!.date : r.date, rowId: r.id };
    }
  }
  return null;
}

export interface BalanceGap {
  /** Last date with a matching balance before the gap. */
  from: IsoDate;
  /** Date of the printed balance that does not reconcile. */
  to: IsoDate;
  expected: Cents;
  printed: Cents;
  /** printed − expected: positive means money in is missing (or money out duplicated). */
  difference: Cents;
}

/** Check that the transactions between consecutive printed balances add up exactly. */
export function balanceGaps(rows: BalanceRow[]): BalanceGap[] {
  const sorted = chronological(rows);
  const gaps: BalanceGap[] = [];
  let anchor: { balance: Cents; date: IsoDate } | null = null;
  let running = 0;
  for (const r of sorted) {
    if (anchor) running += r.amount;
    if (r.balanceAfter == null) continue;
    if (anchor) {
      const expected: Cents = anchor.balance + running;
      if (expected !== r.balanceAfter) gaps.push({ from: anchor.date, to: r.date, expected, printed: r.balanceAfter, difference: r.balanceAfter - expected });
    }
    anchor = { balance: r.balanceAfter, date: r.date };
    running = 0;
  }
  return gaps;
}

/**
 * End-of-day balances on each date with a transaction (plus the anchor date), reconstructed
 * backwards and forwards from one known balance: balance(d) = anchor − Σ amounts after d up to
 * the anchor date + Σ amounts after the anchor date up to d.
 */
export function balanceSeries(rows: Pick<BalanceRow, 'date' | 'amount'>[], anchor: { amount: Cents; asOf: IsoDate }): { date: IsoDate; balance: Cents }[] {
  const byDate = new Map<IsoDate, Cents>();
  for (const r of rows) byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.amount);
  if (!byDate.has(anchor.asOf)) byDate.set(anchor.asOf, 0);
  const dates = [...byDate.keys()].sort();
  const anchorIdx = dates.indexOf(anchor.asOf);
  const out: { date: IsoDate; balance: Cents }[] = new Array(dates.length);
  out[anchorIdx] = { date: anchor.asOf, balance: anchor.amount };
  for (let i = anchorIdx - 1; i >= 0; i--) out[i] = { date: dates[i]!, balance: out[i + 1]!.balance - byDate.get(dates[i + 1]!)! };
  for (let i = anchorIdx + 1; i < dates.length; i++) out[i] = { date: dates[i]!, balance: out[i - 1]!.balance + byDate.get(dates[i]!)! };
  return out;
}
