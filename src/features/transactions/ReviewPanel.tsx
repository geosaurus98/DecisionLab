import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Badge, Button, Card, Checkbox, EmptyState, Input } from '@/ui/components';
import type { Analytics } from '@/hooks/useAppData';
import { db } from '@/data/db';
import { SETTING_KEYS } from '@/data/settings';
import { confirmTransferPairs, rejectTransferPairs, saveRule, setTransactionCategory } from '@/data/transactions';
import { findTransferPairs } from '@/engine/cashflow';
import { groupUncategorised, pairKey, suggestRulePattern, type MerchantGroup } from '@/engine/review';
import { buildSuggestionIndex, type CategorySuggestion } from '@/engine/suggest';
import { merchantLabel } from '@/engine/merchant';
import { formatDate } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { useToast } from '@/ui/toast';
import { CategorySelect } from './TransactionsPage';

const PAGE = 40;

export function useReviewCounts(a: Analytics): { pairs: number; merchants: number } {
  const rejected = useRejectedPairs();
  return useMemo(
    () => ({ pairs: findTransferPairs(a.transactions, a.categoryMap, 3, rejected).length, merchants: groupUncategorised(a.transactions).length }),
    [a.transactions, a.categoryMap, rejected],
  );
}

function useRejectedPairs(): Set<string> {
  const rec = useLiveQuery(() => db.settings.get(SETTING_KEYS.rejectedTransferPairs), []);
  return useMemo(() => new Set((rec?.value as string[] | undefined) ?? []), [rec]);
}

export function ReviewPanel({ a, accountName }: { a: Analytics; accountName: Map<string, string> }) {
  const rejected = useRejectedPairs();
  const pairs = useMemo(() => findTransferPairs(a.transactions, a.categoryMap, 3, rejected), [a.transactions, a.categoryMap, rejected]);
  const groups = useMemo(() => groupUncategorised(a.transactions), [a.transactions]);
  if (pairs.length === 0 && groups.length === 0) {
    return <EmptyState title="Nothing to review">Every transaction has a category and there are no unconfirmed transfers. New imports will appear here.</EmptyState>;
  }
  return (
    <div className="grid gap-5">
      {pairs.length > 0 && <TransferPairs pairs={pairs} accountName={accountName} />}
      {groups.length > 0 && <MerchantGroups groups={groups} a={a} />}
    </div>
  );
}

type Pair = ReturnType<typeof findTransferPairs<Analytics['transactions'][number]>>[number];

function TransferPairs({ pairs, accountName }: { pairs: Pair[]; accountName: Map<string, string> }) {
  const toast = useToast();
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const shown = pairs.slice(0, limit);
  const selected = shown.filter(([o, i]) => !unticked.has(pairKey(o.id, i.id)));
  return (
    <Card
      title={`Possible transfers between your accounts (${pairs.length})`}
      description="Equal and opposite amounts in two of your accounts within 3 days. Confirmed transfers are excluded from spending and income. Untick any that are real payments, or reject them so they are not suggested again."
      actions={
        <>
          <Button
            size="sm"
            variant="primary"
            disabled={selected.length === 0}
            onClick={async () => {
              await confirmTransferPairs(selected.map(([o, i]) => [o.id, i.id]));
              setUnticked(new Set());
              toast({ message: `Marked ${selected.length} pair${selected.length === 1 ? '' : 's'} as transfers.`, tone: 'good' });
            }}
          >
            Mark {selected.length} as transfers
          </Button>
          <Button
            size="sm"
            disabled={selected.length === 0}
            onClick={async () => {
              await rejectTransferPairs(selected.map(([o, i]) => pairKey(o.id, i.id)));
              setUnticked(new Set());
              toast({ message: `${selected.length} pair${selected.length === 1 ? '' : 's'} will not be suggested again.`, tone: 'good' });
            }}
          >
            Not transfers
          </Button>
        </>
      }
    >
      <ul className="grid gap-1">
        {shown.map(([o, i]) => {
          const key = pairKey(o.id, i.id);
          return (
            <li key={key} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 py-1.5 text-sm last:border-0">
              <Checkbox
                label={
                  <span>
                    <span className="tabular text-ink-2">{formatDate(o.date)}</span> · {accountName.get(o.accountId)} → {accountName.get(i.accountId)}
                    <span className="block text-xs text-muted">
                      {o.description} / {i.description}
                      {o.date !== i.date && ` · received ${formatDate(i.date)}`}
                    </span>
                  </span>
                }
                checked={!unticked.has(key)}
                onChange={(v) => {
                  const next = new Set(unticked);
                  if (v) next.delete(key);
                  else next.add(key);
                  setUnticked(next);
                }}
              />
              <span className="ml-auto font-medium tabular">{formatMoney(-o.amount)}</span>
            </li>
          );
        })}
      </ul>
      {pairs.length > limit && (
        <Button size="sm" className="mt-2" onClick={() => setLimit(limit + PAGE)}>
          Show more ({pairs.length - limit} remaining)
        </Button>
      )}
    </Card>
  );
}

function MerchantGroups({ groups, a }: { groups: MerchantGroup[]; a: Analytics }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const filtered = groups.filter((g) => !q.trim() || g.merchant.toLowerCase().includes(q.trim().toLowerCase()) || g.sample.toLowerCase().includes(q.trim().toLowerCase()));
  const remaining = groups.reduce((s, g) => s + g.count, 0);
  // Learn from everything already categorised (rules, your corrections, manual choices).
  const suggestions = useMemo(() => {
    const idx = buildSuggestionIndex(
      a.transactions.filter((t) => t.categoryId !== null && !t.splits?.length).map((t) => ({ merchant: t.merchant, categoryId: t.categoryId! })),
    );
    return new Map(groups.map((g) => [g.merchant, idx.suggest(g.merchant)] as const).filter((x): x is [string, CategorySuggestion] => x[1] !== null));
  }, [a.transactions, groups]);
  const suggestedGroups = groups.filter((g) => suggestions.has(g.merchant));

  async function acceptAll() {
    for (const g of suggestedGroups) await setTransactionCategory(g.ids[0]!, suggestions.get(g.merchant)!.categoryId, true);
    toast({ message: `Applied ${suggestedGroups.length} suggestions (${suggestedGroups.reduce((n, g) => n + g.count, 0)} transactions).`, tone: 'good' });
  }

  async function categorise(g: MerchantGroup, categoryId: string | null) {
    if (!categoryId) return;
    await setTransactionCategory(g.ids[0]!, categoryId, true);
    const name = a.categoryMap.get(categoryId)?.name;
    toast({
      message: `${g.count} “${merchantLabel(g.merchant)}” transaction${g.count === 1 ? '' : 's'} → ${name}. Future ones will be too.`,
      tone: 'good',
      action: {
        label: 'Also make a rule',
        onClick: async () => {
          const pattern = suggestRulePattern(g.merchant);
          await saveRule({ name: merchantLabel(g.merchant), field: 'merchant', operator: 'contains', pattern, caseSensitive: false, direction: 'any', categoryId, enabled: true });
          toast({ message: `Rule created: merchant contains “${pattern}” → ${name}.`, tone: 'good' });
        },
      },
    });
  }

  return (
    <Card
      title={`Uncategorised, by merchant (${groups.length} merchants, ${remaining} transactions)`}
      description="Choose a category once per merchant: it applies to all of that merchant’s transactions, past and future. Largest groups first."
      actions={
        <>
          {suggestedGroups.length > 0 && (
            <Button size="sm" onClick={acceptAll} title="Each suggestion comes from a similar merchant you have already categorised">
              Accept all {suggestedGroups.length} suggestions
            </Button>
          )}
          <Input aria-label="Filter merchants" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} className="w-48" />
        </>
      }
    >
      <ul className="grid gap-1">
        {filtered.slice(0, limit).map((g) => (
          <li key={g.merchant} className="grid items-center gap-2 border-b border-border/60 py-2 text-sm last:border-0 sm:grid-cols-[1fr_auto_12rem]">
            <div className="min-w-0">
              <p className="font-medium">
                {merchantLabel(g.merchant)} <Badge>{g.count}×</Badge> {g.inCount > 0 && g.outCount > 0 && <Badge tone="warn">in and out</Badge>}
              </p>
              <p className="truncate text-xs text-muted">
                {g.sample} · {formatDate(g.firstDate)}
                {g.firstDate !== g.lastDate && ` – ${formatDate(g.lastDate)}`}
              </p>
              {suggestions.has(g.merchant) && (
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-ink-2">
                    Suggested: <strong>{a.categoryMap.get(suggestions.get(g.merchant)!.categoryId)?.name}</strong> — like “{merchantLabel(suggestions.get(g.merchant)!.like)}”
                  </span>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => categorise(g, suggestions.get(g.merchant)!.categoryId)}>
                    Use
                  </Button>
                </p>
              )}
            </div>
            <span className={`tabular ${g.total > 0 ? 'text-good' : ''}`}>{formatMoney(g.total)}</span>
            <CategorySelect ariaLabel={`Category for ${merchantLabel(g.merchant)}`} categories={a.categories} value={null} onChange={(id) => categorise(g, id)} className="h-9 text-sm" />
          </li>
        ))}
      </ul>
      {filtered.length === 0 && <p className="text-sm text-ink-2">No merchants match.</p>}
      {filtered.length > limit && (
        <Button size="sm" className="mt-2" onClick={() => setLimit(limit + PAGE)}>
          Show more ({filtered.length - limit} remaining)
        </Button>
      )}
    </Card>
  );
}
