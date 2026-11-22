/**
 * Rule health: which categorisation rules are doing useful work.
 *
 * - matches:    transactions the rule's condition matches (enabled or not, any category source)
 * - effective:  transactions currently categorised by this rule
 * - shadowedBy: rules earlier in the order that also match all of this rule's matches that
 *               aren't decided by your corrections — the rule can never win
 * - conflicts:  matching transactions you categorised differently yourself (manual choice or
 *               merchant memory) — a sign the rule is too broad or pointing at the wrong category
 */
import type { CategoryRule, Transaction } from '@/domain/types';
import { ruleMatches, sortRules } from './categorise';

export interface RuleHealth {
  ruleId: string;
  matches: number;
  effective: number;
  conflicts: number;
  /** Most common category you chose instead, for conflicting transactions. */
  conflictCategoryId: string | null;
  shadowedBy: string | null;
  status: 'ok' | 'neverMatches' | 'shadowed' | 'conflicts' | 'disabled';
}

type Txn = Pick<Transaction, 'description' | 'merchant' | 'amount' | 'accountId' | 'categoryId' | 'categorySource' | 'ruleId'>;

export function ruleHealth(rules: CategoryRule[], txns: Txn[]): RuleHealth[] {
  const sorted = sortRules(rules);
  return sorted.map((rule, idx) => {
    const asEnabled = { ...rule, enabled: true };
    const matching = txns.filter((t) => ruleMatches(asEnabled, t));
    const effective = txns.filter((t) => t.categorySource === 'rule' && t.ruleId === rule.id).length;
    const userDecided = matching.filter((t) => t.categorySource === 'manual' || t.categorySource === 'memory');
    const conflicting = userDecided.filter((t) => t.categoryId !== rule.categoryId);
    const counts = new Map<string | null, number>();
    for (const t of conflicting) counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
    const conflictCategoryId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const contested = matching.filter((t) => t.categorySource !== 'manual' && t.categorySource !== 'memory');
    let shadowedBy: string | null = null;
    if (contested.length > 0) {
      const earlier = sorted.slice(0, idx).filter((r) => r.enabled);
      const winner = earlier.find((r) => contested.every((t) => ruleMatches(r, t)));
      shadowedBy = winner?.id ?? null;
    }
    const status: RuleHealth['status'] = !rule.enabled
      ? 'disabled'
      : matching.length === 0
        ? 'neverMatches'
        : shadowedBy
          ? 'shadowed'
          : conflicting.length > 0 && conflicting.length >= Math.max(1, effective)
            ? 'conflicts'
            : 'ok';
    return { ruleId: rule.id, matches: matching.length, effective, conflicts: conflicting.length, conflictCategoryId, shadowedBy, status };
  });
}
