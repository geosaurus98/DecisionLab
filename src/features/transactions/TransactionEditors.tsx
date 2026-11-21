import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, ConfirmButton, Field, Input, Modal, MoneyInput, Notice, Segmented, Select, Textarea } from '@/ui/components';
import { db } from '@/data/db';
import { addManualTransaction, deleteManualTransaction, linkTransactions, setTransactionSplits, unlinkTransactions, updateTransactionNotes } from '@/data/transactions';
import { validateSplits } from '@/engine/splits';
import type { Category, Transaction, TransactionSplit } from '@/domain/types';
import { formatDate, todayIso } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { newId } from '@/domain/ids';
import { useToast } from '@/ui/toast';
import { CategorySelect } from './TransactionsPage';

export function AddTransactionModal({ open, onClose, categories }: { open: boolean; onClose: () => void; categories: Category[] }) {
  const accounts = useLiveQuery(() => db.accounts.toArray(), []);
  const toast = useToast();
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [amount, setAmount] = useState<number | null>(null);
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open && accounts?.length && !accounts.some((a) => a.id === accountId)) setAccountId(accounts[0]!.id);
    if (open) setError(null);
  }, [open, accounts, accountId]);

  async function save(another: boolean) {
    setError(null);
    try {
      if (!accountId) throw new Error('Create an account first (Settings → Accounts).');
      if (!amount) throw new Error('Enter an amount.');
      await addManualTransaction({ accountId, date, amount: direction === 'out' ? -amount : amount, description, categoryId, notes: notes || undefined });
      toast({ message: 'Transaction added.', tone: 'good' });
      setAmount(null);
      setDescription('');
      setNotes('');
      setCategoryId(null);
      if (!another) onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the transaction.');
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a transaction"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={() => save(true)}>Save and add another</Button>
          <Button variant="primary" onClick={() => save(false)}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <p className="text-sm text-ink-2 sm:col-span-2">For cash or anything not in a bank export. If the same transaction later appears in an imported statement, it is detected as a duplicate.</p>
        <Field label="Account" htmlFor="mt-acc">
          <Select id="mt-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {(accounts ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date" htmlFor="mt-date">
          <Input id="mt-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Direction" htmlFor="mt-dir">
          <Segmented
            ariaLabel="Direction"
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'out', label: 'Money out' },
              { value: 'in', label: 'Money in' },
            ]}
          />
        </Field>
        <Field label="Amount" htmlFor="mt-amount">
          <MoneyInput id="mt-amount" value={amount} onChange={setAmount} />
        </Field>
        <Field label="Description" htmlFor="mt-desc" className="sm:col-span-2">
          <Input id="mt-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Farmers market" maxLength={200} />
        </Field>
        <Field label="Category" htmlFor="mt-cat" hint="Leave uncategorised to apply your rules">
          <CategorySelect id="mt-cat" categories={categories} value={categoryId} onChange={setCategoryId} />
        </Field>
        <Field label="Notes" htmlFor="mt-notes">
          <Input id="mt-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error && (
          <div className="sm:col-span-2">
            <Notice tone="bad">{error}</Notice>
          </div>
        )}
      </div>
    </Modal>
  );
}

type DraftSplit = { id: string; amount: number | null; categoryId: string | null; note: string };

export function TransactionDetail({ txn, onClose, accountName, categories }: { txn: Transaction | null; onClose: () => void; accountName?: string; categories: Category[] }) {
  const toast = useToast();
  const [notes, setNotes] = useState('');
  const [splits, setSplits] = useState<DraftSplit[] | null>(null);
  const [decisionId, setDecisionId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rule = useLiveQuery(async () => (txn?.ruleId ? db.rules.get(txn.ruleId) : undefined), [txn?.ruleId]);
  const decisions = useLiveQuery(() => db.decisions.orderBy('date').reverse().toArray(), []);

  useEffect(() => {
    if (!txn) return;
    setNotes(txn.notes ?? '');
    setDecisionId(txn.decisionId ?? '');
    setError(null);
    setSplits(txn.splits ? txn.splits.map((s) => ({ id: s.id, amount: Math.abs(s.amount), categoryId: s.categoryId, note: s.note ?? '' })) : null);
  }, [txn]);

  if (!txn) return <Modal open={false} onClose={onClose} title="Transaction details">{null}</Modal>;
  const sign = txn.amount < 0 ? -1 : 1;
  const parts: TransactionSplit[] | null = splits
    ? splits.map((s) => ({ id: s.id, amount: sign * (s.amount ?? 0), categoryId: s.categoryId, note: s.note || undefined }))
    : null;
  const splitErrors = parts ? validateSplits(txn.amount, parts) : [];
  const remaining = parts ? txn.amount - parts.reduce((a, p) => a + p.amount, 0) : 0;

  async function save() {
    setError(null);
    try {
      if (parts && splitErrors.length) throw new Error(splitErrors.join(' '));
      await updateTransactionNotes(txn!.id, notes);
      const hadSplits = !!txn!.splits?.length;
      if (parts) await setTransactionSplits(txn!.id, parts);
      else if (hadSplits) await setTransactionSplits(txn!.id, null);
      if (decisionId !== (txn!.decisionId ?? '')) {
        if (decisionId) await linkTransactions(decisionId, [txn!.id]);
        else await unlinkTransactions([txn!.id]);
      }
      toast({ message: 'Transaction updated.', tone: 'good' });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Transaction details"
      footer={
        <>
          {txn.importId === null && (
            <ConfirmButton
              title="Delete this transaction?"
              confirmText="This manually entered transaction will be permanently deleted."
              onConfirm={async () => {
                await deleteManualTransaction(txn.id);
                onClose();
              }}
            >
              Delete
            </ConfirmButton>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!!parts && splitErrors.length > 0}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 text-sm">
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5">
          <dt className="text-muted">Date</dt>
          <dd>{formatDate(txn.date)}</dd>
          <dt className="text-muted">Amount</dt>
          <dd className="tabular">{formatMoney(txn.amount)}</dd>
          <dt className="text-muted">Account</dt>
          <dd>{accountName}</dd>
          <dt className="text-muted">Description</dt>
          <dd>{txn.description}</dd>
          <dt className="text-muted">Source</dt>
          <dd>{txn.importId ? 'Imported from CSV' : 'Entered manually'}</dd>
          <dt className="text-muted">Categorised by</dt>
          <dd>
            {txn.splits?.length
              ? 'Split by you'
              : txn.categorySource === 'rule'
                ? `Rule “${rule?.name ?? 'deleted rule'}”`
                : txn.categorySource === 'memory'
                  ? 'Your earlier correction for this merchant'
                  : txn.categorySource === 'manual'
                    ? 'You (manual)'
                    : 'Not categorised'}
          </dd>
        </dl>

        <section className="grid gap-2 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold">Split across categories</h3>
            {splits ? (
              <Button size="sm" variant="ghost" onClick={() => setSplits(null)}>
                Remove split
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() =>
                  setSplits([
                    { id: newId('spl'), amount: Math.abs(txn.amount), categoryId: txn.categoryId, note: '' },
                    { id: newId('spl'), amount: null, categoryId: null, note: '' },
                  ])
                }
              >
                Split…
              </Button>
            )}
          </div>
          {splits && (
            <>
              {splits.map((s, i) => (
                <div key={s.id} className="grid grid-cols-[7rem_1fr_auto] items-center gap-2">
                  <MoneyInput
                    ariaLabel={`Part ${i + 1} amount`}
                    value={s.amount}
                    onChange={(v) => setSplits(splits.map((x) => (x.id === s.id ? { ...x, amount: v } : x)))}
                  />
                  <CategorySelect
                    ariaLabel={`Part ${i + 1} category`}
                    categories={categories}
                    value={s.categoryId}
                    onChange={(id) => setSplits(splits.map((x) => (x.id === s.id ? { ...x, categoryId: id } : x)))}
                  />
                  <Button size="sm" variant="ghost" aria-label={`Remove part ${i + 1}`} disabled={splits.length <= 2} onClick={() => setSplits(splits.filter((x) => x.id !== s.id))}>
                    ✕
                  </Button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => setSplits([...splits, { id: newId('spl'), amount: null, categoryId: null, note: '' }])}>
                  + Add part
                </Button>
                <span className={`ml-auto text-xs ${remaining === 0 ? 'text-good' : 'text-warn'}`}>
                  {remaining === 0 ? 'Parts add up to the transaction ✓' : `${formatMoney(Math.abs(remaining))} ${Math.sign(remaining) === sign ? 'still to allocate' : 'over-allocated'}`}
                </span>
              </div>
              <p className="text-xs text-muted">Enter parts as positive amounts; they take the transaction’s direction ({txn.amount < 0 ? 'money out' : 'money in'}).</p>
            </>
          )}
        </section>

        <Field label="Belongs to decision" htmlFor="txn-decision" hint="Linked transactions measure a decision’s actual cost.">
          <Select id="txn-decision" value={decisionId} onChange={(e) => setDecisionId(e.target.value)}>
            <option value="">None</option>
            {(decisions ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.title || 'Untitled decision'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes" htmlFor="txn-notes">
          <Textarea id="txn-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
        </Field>
        {txn.original && (
          <details>
            <summary className="cursor-pointer text-ink-2">Original imported values (audit)</summary>
            <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-1 font-mono text-xs">
              {Object.entries(txn.original).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{k}</dt>
                  <dd>{v || '—'}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
        {error && <Notice tone="bad">{error}</Notice>}
      </div>
    </Modal>
  );
}
