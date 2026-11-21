import { useMemo, useState } from 'react';
import { Badge, Button, Card, Field, InfoTip, Input, Modal, MoneyInput } from '@/ui/components';
import { SimpleTable } from '@/ui/charts';
import type { Analytics } from '@/hooks/useAppData';
import { restoreDismissedRecurring, setRecurringOverride } from '@/data/recurring';
import { upcomingBills, type EffectiveSeries } from '@/engine/recurring';
import { merchantLabel } from '@/engine/merchant';
import { addDays, formatDate } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { DEFINITIONS } from '@/ui/definitions';
import { useToast } from '@/ui/toast';

export function RecurringCard({ a }: { a: Analytics }) {
  const toast = useToast();
  const [editing, setEditing] = useState<EffectiveSeries | null>(null);
  const out = a.recurring.filter((r) => r.direction === 'out');
  const inc = a.recurring.filter((r) => r.direction === 'in');
  const name = (r: EffectiveSeries) => (r.label === r.merchant ? merchantLabel(r.merchant) : r.label);

  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          Recurring payments <InfoTip>{DEFINITIONS.recurring}</InfoTip>
        </span>
      }
      description="Detected automatically. Confirm the real ones, correct names and amounts, and dismiss anything that isn’t recurring — your edits feed obligations, upcoming bills and budget pace."
      actions={
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            const n = await restoreDismissedRecurring();
            toast({ message: n ? `Restored ${n} dismissed series.` : 'Nothing dismissed.', tone: 'good' });
          }}
        >
          Restore dismissed
        </Button>
      }
    >
      {a.recurring.length === 0 ? (
        <p className="text-sm text-ink-2">No regular payments detected yet (needs at least three occurrences).</p>
      ) : (
        <div className="overflow-x-auto">
          <SimpleTable
            headers={['Payment', 'Cadence', 'Amount', 'Per month', 'Next expected', 'Confidence', '']}
            align={['left', 'left', 'right', 'right', 'left', 'right', 'right']}
            rows={[...out, ...inc].map((r) => [
              <span key="m" className="inline-flex flex-wrap items-center gap-1">
                {name(r)}
                {r.confirmed && <Badge tone="accent">Confirmed</Badge>}
                {!r.active && <Badge>Possibly ended</Badge>}
                {r.direction === 'in' && <Badge tone="good">Income</Badge>}
              </span>,
              r.cadence,
              <span key="a">
                {formatMoney(r.typicalAmount)}
                {r.amountOverridden && <span className="text-xs text-muted"> (yours)</span>}
              </span>,
              formatMoney(r.monthlyEquivalent),
              r.active ? formatDate(r.nextExpected) : '—',
              r.confirmed ? '—' : `${Math.round(r.confidence * 100)}%`,
              <span key="x" className="inline-flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                  Edit
                </Button>
                {!r.confirmed && (
                  <Button size="sm" variant="ghost" onClick={() => setRecurringOverride(r.key, { status: 'confirmed' })}>
                    Confirm
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setRecurringOverride(r.key, { status: 'dismissed' })}>
                  Dismiss
                </Button>
              </span>,
            ])}
          />
          <p className="mt-2 text-xs text-muted">
            Active recurring outgoings total {formatMoney(-out.filter((r) => r.active).reduce((s, r) => s + r.monthlyEquivalent, 0))} per month (monthly equivalent).
          </p>
        </div>
      )}
      <RecurringEditor series={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}

function RecurringEditor({ series, onClose }: { series: EffectiveSeries | null; onClose: () => void }) {
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [lastKey, setLastKey] = useState<string | null>(null);
  if (series && series.key !== lastKey) {
    setLastKey(series.key);
    setLabel(series.label === series.merchant ? merchantLabel(series.merchant) : series.label);
    setAmount(series.amountOverridden ? series.typicalAmount : null);
  }
  return (
    <Modal
      open={!!series}
      onClose={onClose}
      title="Edit recurring payment"
      footer={
        <>
          {series && (
            <Button
              onClick={async () => {
                await setRecurringOverride(series.key, null);
                onClose();
              }}
            >
              Reset to detected
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              if (!series) return;
              await setRecurringOverride(series.key, { status: 'confirmed', label: label.trim() || undefined, expectedAmount: amount ?? undefined });
              onClose();
            }}
          >
            Save and confirm
          </Button>
        </>
      }
    >
      {series && (
        <div className="grid gap-3">
          <p className="text-sm text-ink-2">
            Detected from {series.occurrences} payments to “{series.merchant}”, {series.cadence}, last on {formatDate(series.lastDate)}.
          </p>
          <Field label="Name" htmlFor="rec-label">
            <Input id="rec-label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Field label="Expected amount per payment" htmlFor="rec-amount" hint="Leave blank to use the detected typical amount (e.g. set it after a price rise).">
            <MoneyInput id="rec-amount" value={amount} onChange={setAmount} />
          </Field>
        </div>
      )}
    </Modal>
  );
}

/** Next 30 days of projected bills from active recurring outgoings. */
export function UpcomingBillsCard({ a }: { a: Analytics }) {
  const bills = useMemo(() => {
    const consumption = a.recurring.filter((r) => {
      const kind = r.categoryId ? a.categoryMap.get(r.categoryId)?.kind : undefined;
      return kind === undefined || kind === 'expense';
    });
    return upcomingBills(consumption, a.today, addDays(a.today, 30));
  }, [a.recurring, a.categoryMap, a.today]);
  if (a.recurring.length === 0) return null;
  const total = bills.reduce((s, b) => s + b.amount, 0);
  return (
    <Card title="Upcoming bills" description="Projected from your recurring payments for the next 30 days (estimated).">
      {bills.length === 0 ? (
        <p className="text-sm text-ink-2">No recurring bills expected in the next 30 days.</p>
      ) : (
        <>
          <ul className="grid gap-1 text-sm">
            {bills.map((b) => (
              <li key={`${b.key}-${b.date}`} className="flex items-center gap-2 border-b border-border/60 py-1 last:border-0">
                <span className="w-24 text-ink-2 tabular">{formatDate(b.date)}</span>
                <span className="min-w-0 flex-1 truncate">{b.label === b.label.toUpperCase() ? merchantLabel(b.label) : b.label}</span>
                <span className="tabular">{formatMoney(b.amount)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm font-semibold">
            Total {formatMoney(total)} <Badge tone="warn">Estimated</Badge>
          </p>
        </>
      )}
    </Card>
  );
}
