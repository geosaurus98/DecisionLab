/**
 * Split transactions: one bank transaction allocated across several categories.
 * Analytics operate on "analysis lines": one line per split part, or the whole
 * transaction when it has no splits. Split parts must sum exactly (in cents) to the
 * transaction amount, so totals are unchanged by splitting.
 */
import type { Cents } from '@/domain/money';
import type { Transaction, TransactionSplit } from '@/domain/types';

export interface AnalysisLine {
  /** Unique line id: the transaction id, or `${transactionId}:${splitId}` for split parts. */
  id: string;
  parentId: string;
  accountId: string;
  date: string;
  amount: Cents;
  categoryId: string | null;
}

export function validateSplits(amount: Cents, splits: Pick<TransactionSplit, 'amount' | 'categoryId'>[]): string[] {
  const errors: string[] = [];
  if (splits.length < 2) errors.push('A split needs at least two parts.');
  if (splits.some((s) => !Number.isSafeInteger(s.amount))) errors.push('Split amounts must be whole cents.');
  if (splits.some((s) => s.amount === 0)) errors.push('Split parts cannot be zero.');
  if (splits.some((s) => Math.sign(s.amount) !== Math.sign(amount))) errors.push('Every part must have the same direction (in or out) as the transaction.');
  const total = splits.reduce((a, s) => a + s.amount, 0);
  if (total !== amount) errors.push(`Parts add up to ${(total / 100).toFixed(2)} but the transaction is ${(amount / 100).toFixed(2)}.`);
  return errors;
}

export function toAnalysisLines(txns: Pick<Transaction, 'id' | 'accountId' | 'date' | 'amount' | 'categoryId' | 'splits'>[]): AnalysisLine[] {
  const out: AnalysisLine[] = [];
  for (const t of txns) {
    if (t.splits && t.splits.length > 0) {
      for (const s of t.splits) {
        out.push({ id: `${t.id}:${s.id}`, parentId: t.id, accountId: t.accountId, date: t.date, amount: s.amount, categoryId: s.categoryId });
      }
    } else {
      out.push({ id: t.id, parentId: t.id, accountId: t.accountId, date: t.date, amount: t.amount, categoryId: t.categoryId });
    }
  }
  return out;
}

/** Category shown for a split transaction in single-category contexts: the largest part's category. */
export function dominantSplitCategory(splits: Pick<TransactionSplit, 'amount' | 'categoryId'>[]): string | null {
  let best: Pick<TransactionSplit, 'amount' | 'categoryId'> | undefined;
  for (const s of splits) if (!best || Math.abs(s.amount) > Math.abs(best.amount)) best = s;
  return best?.categoryId ?? null;
}

/** Whether a transaction (or any of its split parts) is in the category; null = uncategorised. */
export function hasCategory(t: Pick<Transaction, 'categoryId' | 'splits'>, categoryId: string | null): boolean {
  if (t.splits && t.splits.length > 0) return t.splits.some((s) => s.categoryId === categoryId);
  return t.categoryId === categoryId;
}
