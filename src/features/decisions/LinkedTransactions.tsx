import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Badge, Button, Card, Checkbox, Input, Modal, ProvenanceBadge } from '@/ui/components';
import { db } from '@/data/db';
import { linkTransactions, unlinkTransactions } from '@/data/transactions';
import { linkedCost, suggestLinks } from '@/engine/decisionLink';
import type { Decision, Transaction } from '@/domain/types';
import { addDays, formatDate } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { merchantLabel } from '@/engine/merchant';
import { useToast } from '@/ui/toast';

export function useLinkedTransactions(decisionId: string): Transaction[] | undefined {
  return useLiveQuery(() => db.transactions.where('decisionId').equals(decisionId).sortBy('date'), [decisionId]);
}

export function LinkedTransactions({ decision: d }: { decision: Decision }) {
  const linked = useLinkedTransactions(d.id);
  const [open, setOpen] = useState(false);
  const total = linked ? linkedCost(linked) : 0;
  return (
    <Card
      title="Linked transactions"
      description="Attach the real payments (and any refunds) for this decision, so its actual cost comes from your data instead of memory."
      actions={
        <Button size="sm" onClick={() => setOpen(true)}>
          Find transactions
        </Button>
      }
    >
      {!linked || linked.length === 0 ? (
        <p className="text-sm text-ink-2">No transactions linked yet.</p>
      ) : (
        <div className="grid gap-2">
          <ul className="grid gap-1 text-sm">
            {linked.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 border-b border-border/60 py-1">
                <span className="w-24 text-ink-2 tabular">{formatDate(t.date)}</span>
                <span className="min-w-0 flex-1 truncate">{merchantLabel(t.merchant)}</span>
                <span className={`tabular ${t.amount > 0 ? 'text-good' : ''}`}>{formatMoney(t.amount)}</span>
                <Button size="sm" variant="ghost" onClick={() => unlinkTransactions([t.id])}>
                  Unlink
                </Button>
              </li>
            ))}
          </ul>
          <p className="flex items-center gap-2 text-sm font-semibold">
            Actual cost from linked transactions: <span className="tabular">{formatMoney(total)}</span> <ProvenanceBadge provenance="known" />
          </p>
        </div>
      )}
      <FindTransactionsModal open={open} onClose={() => setOpen(false)} decision={d} />
    </Card>
  );
}

function FindTransactionsModal({ open, onClose, decision: d }: { open: boolean; onClose: () => void; decision: Decision }) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Searching covers a year either side of the decision (deposits are often paid early);
  // automatic suggestions use the tighter window in suggestLinks.
  const from = addDays(d.date, -365);
  const candidates = useLiveQuery(
    () => (open ? db.transactions.where('date').between(from, addDays(d.date, 400), true, true).toArray() : Promise.resolve([] as Transaction[])),
    [open, from, d.date],
  );
  const chosen = d.options.find((o) => o.id === (d.snapshot?.selectedOptionId ?? d.selectedOptionId));
  const suggestions = useMemo(
    () =>
      new Map(
        suggestLinks(candidates ?? [], {
          id: d.id,
          date: d.date,
          title: d.title,
          optionName: chosen?.name,
          expectedCost: d.snapshot?.predictedCost ?? chosen?.upfrontCost,
        }).map((s) => [s.transactionId, s]),
      ),
    [candidates, d, chosen],
  );
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (candidates ?? [])
      .filter((t) => t.decisionId !== d.id)
      .filter((t) => (q ? t.description.toLowerCase().includes(q) || (Math.abs(t.amount) / 100).toFixed(2).includes(q) : suggestions.has(t.id)))
      .sort((a, b) => (suggestions.get(b.id)?.score ?? 0) - (suggestions.get(a.id)?.score ?? 0) || a.date.localeCompare(b.date))
      .slice(0, 100);
  }, [candidates, query, suggestions, d.id]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Link transactions to this decision"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={selected.size === 0}
            onClick={async () => {
              await linkTransactions(d.id, [...selected]);
              toast({ message: `Linked ${selected.size} transaction${selected.size === 1 ? '' : 's'}.`, tone: 'good' });
              setSelected(new Set());
              onClose();
            }}
          >
            Link {selected.size || ''} selected
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Input aria-label="Search transactions" placeholder="Search description or amount (shows suggestions when empty)" value={query} onChange={(e) => setQuery(e.target.value)} />
        <p className="text-xs text-muted">
          Search covers {formatDate(from)} to {formatDate(addDays(d.date, 400))}. Suggestions (shown when the search is empty) are outflows from a week before the decision
          onwards that mention words from the decision or chosen alternative, or are close to the expected cost. Linking a transaction already linked to another decision
          moves it here.
        </p>
        {rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-2">{query ? 'No matching transactions.' : 'No suggestions — search for the payments instead.'}</p>
        ) : (
          <ul className="grid max-h-[50vh] gap-1 overflow-y-auto">
            {rows.map((t) => {
              const s = suggestions.get(t.id);
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-2 rounded border border-border/60 px-2 py-1.5 text-sm">
                  <Checkbox
                    label={
                      <span>
                        <span className="text-ink-2 tabular">{formatDate(t.date)}</span> · {t.description}
                        {s && <span className="block text-xs text-muted">Suggested: {s.reasons.join('; ')}</span>}
                      </span>
                    }
                    checked={selected.has(t.id)}
                    onChange={(v) => {
                      const next = new Set(selected);
                      if (v) next.add(t.id);
                      else next.delete(t.id);
                      setSelected(next);
                    }}
                  />
                  {t.decisionId && <Badge tone="warn">Linked elsewhere</Badge>}
                  <span className={`ml-auto tabular ${t.amount > 0 ? 'text-good' : ''}`}>{formatMoney(t.amount)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
