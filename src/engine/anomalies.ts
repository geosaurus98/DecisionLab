/**
 * Unusually large transactions, using a robust z-score per category:
 *   z = (x − median) / (1.4826 · MAD)
 * where x is the spend amount and MAD is the median absolute deviation. 1.4826 makes MAD a
 * consistent estimator of the standard deviation for normally distributed data. Robust
 * statistics are used because spending is skewed and a few big purchases would inflate a
 * plain standard deviation. Categories need `minSamples` transactions to be assessed, and a
 * flagged amount must also be at least `minRatio` × the category median and ≥ `minAmount`.
 */
import type { Cents } from '@/domain/money';
import type { Category } from '@/domain/types';
import { mad, median } from './stats';

export interface Anomaly {
  id: string;
  categoryId: string;
  amount: Cents;
  typical: Cents;
  score: number;
  sampleSize: number;
}

export function findAnomalies<T extends { id: string; amount: Cents; categoryId: string | null; date: string }>(
  txns: T[],
  categories: Map<string, Category>,
  opts: { threshold?: number; minSamples?: number; minAmount?: Cents; minRatio?: number; since?: string } = {},
): Anomaly[] {
  const threshold = opts.threshold ?? 3.5;
  const minSamples = opts.minSamples ?? 8;
  const minAmount = opts.minAmount ?? 10_000;
  const minRatio = opts.minRatio ?? 2;
  const byCat = new Map<string, T[]>();
  for (const t of txns) {
    if (t.amount >= 0 || !t.categoryId || categories.get(t.categoryId)?.kind !== 'expense') continue;
    const list = byCat.get(t.categoryId) ?? [];
    list.push(t);
    byCat.set(t.categoryId, list);
  }
  const out: Anomaly[] = [];
  for (const [categoryId, list] of byCat) {
    if (list.length < minSamples) continue;
    const amounts = list.map((t) => -t.amount);
    const med = median(amounts);
    const spread = 1.4826 * mad(amounts);
    for (const t of list) {
      const x = -t.amount;
      if (x < minAmount || (opts.since && t.date < opts.since)) continue;
      // With zero spread (identical amounts) any different amount is unusual; use a 10% floor.
      const scale = spread > 0 ? spread : Math.max(1, med * 0.1);
      const score = (x - med) / scale;
      // Also require the amount to be materially larger than typical, so mixed categories
      // (e.g. $20 bus top-ups and $60 fuel in Transport) do not flag ordinary purchases.
      if (score > threshold && x >= med * minRatio) out.push({ id: t.id, categoryId, amount: x, typical: Math.round(med), score, sampleSize: list.length });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
