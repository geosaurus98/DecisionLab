/**
 * Review queue: turns hundreds of uncategorised transactions into a short list of merchants,
 * so one decision categorises every transaction from that merchant (and future ones, via
 * merchant memory).
 */
import type { Cents } from '@/domain/money';
import type { Transaction } from '@/domain/types';

export interface MerchantGroup {
  merchant: string;
  /** A representative original description. */
  sample: string;
  count: number;
  /** Net amount (negative = net money out). */
  total: Cents;
  outCount: number;
  inCount: number;
  firstDate: string;
  lastDate: string;
  accountIds: string[];
  ids: string[];
}

/** Group uncategorised, unsplit transactions by merchant key, largest groups (by count, then |total|) first. */
export function groupUncategorised(txns: Pick<Transaction, 'id' | 'merchant' | 'description' | 'amount' | 'date' | 'accountId' | 'categoryId' | 'splits'>[]): MerchantGroup[] {
  const groups = new Map<string, MerchantGroup>();
  for (const t of txns) {
    if (t.categoryId !== null || (t.splits && t.splits.length > 0)) continue;
    let g = groups.get(t.merchant);
    if (!g) {
      g = { merchant: t.merchant, sample: t.description, count: 0, total: 0, outCount: 0, inCount: 0, firstDate: t.date, lastDate: t.date, accountIds: [], ids: [] };
      groups.set(t.merchant, g);
    }
    g.count++;
    g.total += t.amount;
    if (t.amount < 0) g.outCount++;
    else g.inCount++;
    if (t.date < g.firstDate) g.firstDate = t.date;
    if (t.date > g.lastDate) {
      g.lastDate = t.date;
      g.sample = t.description;
    }
    if (!g.accountIds.includes(t.accountId)) g.accountIds.push(t.accountId);
    g.ids.push(t.id);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || Math.abs(b.total) - Math.abs(a.total));
}

/**
 * A rule pattern that matches this merchant in descriptions: the merchant key's leading words
 * (up to three), lower-cased. Used to pre-fill "create a rule" from the review queue.
 */
export function suggestRulePattern(merchant: string): string {
  return merchant
    .split(' ')
    .filter((w) => w.length > 1)
    .slice(0, 3)
    .join(' ')
    .toLowerCase();
}

export const pairKey = (outId: string, inId: string) => `${outId}|${inId}`;
