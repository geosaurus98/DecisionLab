/**
 * Connecting decisions to real transactions, so a decision's actual cost can be measured
 * from imported data (provenance "known") rather than typed in from memory.
 */
import type { Cents } from '@/domain/money';
import { addDays, type IsoDate } from '@/domain/dates';
import type { Transaction } from '@/domain/types';

/**
 * Actual cost of linked transactions: money out counts as cost, money in (refunds, resale)
 * reduces it. Result may be negative if inflows exceed outflows.
 */
export function linkedCost(txns: Pick<Transaction, 'amount'>[]): Cents {
  return -txns.reduce((a, t) => a + t.amount, 0);
}

export interface LinkSuggestion {
  transactionId: string;
  score: number;
  reasons: string[];
}

const STOP = new Set(['option', 'the', 'and', 'for', 'buy', 'new', 'trip', 'with', 'from', 'instead', 'keep', 'money']);

function keywords(texts: string[]): string[] {
  const words = texts
    .join(' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
  return [...new Set(words)];
}

/**
 * Suggest transactions that probably belong to a decision: outflows dated from a week before
 * the decision to `windowDays` after it, not already linked elsewhere, that either mention a
 * keyword from the decision/option names or have an amount within 25% of the expected cost.
 */
export function suggestLinks(
  txns: Pick<Transaction, 'id' | 'date' | 'amount' | 'description' | 'decisionId'>[],
  decision: { id: string; date: IsoDate; title: string; optionName?: string; expectedCost?: Cents },
  windowDays = 180,
): LinkSuggestion[] {
  const from = addDays(decision.date, -7);
  const to = addDays(decision.date, windowDays);
  const words = keywords([decision.title, decision.optionName ?? '']);
  const out: LinkSuggestion[] = [];
  for (const t of txns) {
    if (t.amount >= 0 || t.date < from || t.date > to) continue;
    if (t.decisionId && t.decisionId !== decision.id) continue;
    const reasons: string[] = [];
    let score = 0;
    const desc = t.description.toLowerCase();
    const matched = words.filter((w) => desc.includes(w));
    if (matched.length) {
      score += 2 + matched.length;
      reasons.push(`mentions “${matched.join('”, “')}”`);
    }
    if (decision.expectedCost && decision.expectedCost > 0) {
      const rel = Math.abs(-t.amount - decision.expectedCost) / decision.expectedCost;
      if (rel <= 0.25) {
        score += 3 * (1 - rel / 0.25) + 1;
        reasons.push(rel < 0.01 ? 'matches the expected cost' : `within ${Math.round(rel * 100)}% of the expected cost`);
      }
    }
    if (score > 0) out.push({ transactionId: t.id, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score);
}
