/**
 * Rule-based transaction categorisation.
 *
 * Precedence (highest first):
 *  1. Manual category set by the user on the transaction — never overwritten.
 *  2. Merchant memory — the category the user last chose manually for the same merchant key.
 *  3. Rules — enabled rules in ascending priority order; the first match wins.
 *  4. Uncategorised.
 *
 * Learned corrections outrank generic rules because they encode an explicit user decision
 * about that exact merchant.
 */
import type { CategoryRule, CategorySource, MerchantMemory, Transaction } from '@/domain/types';

export interface CategorisationResult {
  categoryId: string | null;
  categorySource: CategorySource;
  ruleId?: string;
}

type Categorisable = Pick<Transaction, 'description' | 'merchant' | 'amount' | 'accountId'> &
  Partial<Pick<Transaction, 'categoryId' | 'categorySource'>>;

const regexCache = new Map<string, RegExp | null>();

function compileRegex(pattern: string, caseSensitive: boolean): RegExp | null {
  const key = `${caseSensitive ? 's' : 'i'}:${pattern}`;
  if (!regexCache.has(key)) {
    try {
      regexCache.set(key, new RegExp(pattern, caseSensitive ? '' : 'i'));
    } catch {
      regexCache.set(key, null);
    }
  }
  return regexCache.get(key)!;
}

export function isValidRegex(pattern: string): boolean {
  return compileRegex(pattern, true) !== null;
}

export function ruleMatches(rule: CategoryRule, txn: Categorisable): boolean {
  if (!rule.enabled || rule.pattern.trim() === '') return false;
  if (rule.direction === 'in' && txn.amount <= 0) return false;
  if (rule.direction === 'out' && txn.amount >= 0) return false;
  if (rule.accountId && rule.accountId !== txn.accountId) return false;
  const haystackRaw = rule.field === 'merchant' ? txn.merchant : txn.description;
  if (rule.operator === 'regex') {
    const re = compileRegex(rule.pattern, rule.caseSensitive);
    return re ? re.test(haystackRaw) : false;
  }
  const haystack = rule.caseSensitive ? haystackRaw : haystackRaw.toLowerCase();
  const needle = rule.caseSensitive ? rule.pattern.trim() : rule.pattern.trim().toLowerCase();
  switch (rule.operator) {
    case 'contains':
      return haystack.includes(needle);
    case 'startsWith':
      return haystack.startsWith(needle);
    case 'equals':
      return haystack.trim() === needle;
    default:
      return false;
  }
}

export function sortRules(rules: CategoryRule[]): CategoryRule[] {
  return [...rules].sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
}

export function categorise(
  txn: Categorisable,
  sortedRules: CategoryRule[],
  memory: Map<string, string>,
): CategorisationResult {
  if (txn.categorySource === 'manual') {
    return { categoryId: txn.categoryId ?? null, categorySource: 'manual' };
  }
  const remembered = memory.get(txn.merchant);
  if (remembered) return { categoryId: remembered, categorySource: 'memory' };
  for (const rule of sortedRules) {
    if (ruleMatches(rule, txn)) return { categoryId: rule.categoryId, categorySource: 'rule', ruleId: rule.id };
  }
  return { categoryId: null, categorySource: 'none' };
}

export function memoryMap(entries: MerchantMemory[]): Map<string, string> {
  return new Map(entries.map((m) => [m.merchant, m.categoryId]));
}

/** Re-run categorisation over many transactions; returns only those whose category changed. */
export function recategoriseAll<T extends Categorisable & { id: string; categoryId: string | null; ruleId?: string }>(
  transactions: T[],
  rules: CategoryRule[],
  memory: Map<string, string>,
): { id: string; result: CategorisationResult }[] {
  const sorted = sortRules(rules);
  const changes: { id: string; result: CategorisationResult }[] = [];
  for (const t of transactions) {
    const result = categorise(t, sorted, memory);
    if (result.categoryId !== t.categoryId || result.categorySource !== t.categorySource || result.ruleId !== t.ruleId) {
      changes.push({ id: t.id, result });
    }
  }
  return changes;
}
