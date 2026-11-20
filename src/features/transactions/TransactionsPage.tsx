import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Badge, Button, CategoryDot, Checkbox, ConfirmButton, EmptyState, Field, Input, Modal, Notice, PageHeader, Select, Spinner, Tabs, Textarea, cx } from '@/ui/components';
import { useAccounts, useAnalytics } from '@/hooks/useAppData';
import { db } from '@/data/db';
import { setTransactionCategory, updateTransactionNotes } from '@/data/transactions';
import { undoImport } from '@/data/imports';
import { loadDemoData } from '@/data/demo/load';
import { formatDate } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { findTransferPairs } from '@/engine/cashflow';
import { merchantLabel } from '@/engine/merchant';
import { toCsv } from '@/engine/csv';
import type { Category, Transaction } from '@/domain/types';
import { useToast } from '@/ui/toast';
import { ImportWizard } from './ImportWizard';
import { RulesPanel } from './RulesPanel';
import { downloadText } from '@/ui/download';

type Tab = 'transactions' | 'imports' | 'rules';
const PAGE = 100;

export function CategorySelect({ categories, value, onChange, id, ariaLabel, includeNone = true, className }: {
  categories: Category[];
  value: string | null;
  onChange: (id: string | null) => void;
  id?: string;
  ariaLabel?: string;
  includeNone?: boolean;
  className?: string;
}) {
  const groups: [string, Category['kind']][] = [
    ['Expenses', 'expense'],
    ['Income', 'income'],
    ['Transfers', 'transfer'],
    ['Savings', 'savings'],
  ];
  return (
    <Select id={id} aria-label={ariaLabel} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className={className}>
      {includeNone && <option value="">Uncategorised</option>}
      {groups.map(([label, kind]) => (
        <optgroup key={kind} label={label}>
          {categories
            .filter((c) => c.kind === kind && (!c.archived || c.id === value))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </optgroup>
      ))}
    </Select>
  );
}

export function TransactionsPage() {
  const analytics = useAnalytics();
  const accounts = useAccounts();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('transactions');
  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [direction, setDirection] = useState<'' | 'in' | 'out'>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [remember, setRemember] = useState(true);
  const [selected, setSelected] = useState<Transaction | null>(null);

  const accountName = useMemo(() => new Map((accounts ?? []).map((a) => [a.id, a.name])), [accounts]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return analytics.transactions.filter(
      (t) =>
        (!q || t.description.toLowerCase().includes(q) || t.notes?.toLowerCase().includes(q) || (t.amount / 100).toFixed(2).includes(q)) &&
        (!accountFilter || t.accountId === accountFilter) &&
        (!categoryFilter || (categoryFilter === '__none' ? t.categoryId === null : t.categoryId === categoryFilter)) &&
        (!direction || (direction === 'in' ? t.amount > 0 : t.amount < 0)) &&
        (!from || t.date >= from) &&
        (!to || t.date <= to),
    );
  }, [analytics.transactions, search, accountFilter, categoryFilter, direction, from, to]);

  const transferPairs = useMemo(() => findTransferPairs(analytics.transactions, analytics.categoryMap), [analytics.transactions, analytics.categoryMap]);
  const uncategorisedCount = analytics.transactions.filter((t) => t.categoryId === null).length;
  const total = filtered.reduce((a, t) => a + t.amount, 0);

  async function changeCategory(t: Transaction, categoryId: string | null) {
    const others = await setTransactionCategory(t.id, categoryId, remember);
    toast({
      message: others > 0 ? `Category updated, and applied to ${others} other “${merchantLabel(t.merchant)}” transactions.` : 'Category updated.',
      tone: 'good',
    });
  }

  function exportFiltered() {
    const csv = toCsv(
      ['Date', 'Account', 'Description', 'Category', 'Amount', 'Notes'],
      filtered.map((t) => [
        t.date,
        accountName.get(t.accountId) ?? '',
        t.description,
        t.categoryId ? analytics.categoryMap.get(t.categoryId)?.name ?? '' : '',
        (t.amount / 100).toFixed(2),
        t.notes ?? '',
      ]),
    );
    downloadText(`decisionlab-transactions-${analytics.today}.csv`, csv, 'text/csv');
  }

  if (analytics.loading) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Transactions"
        description="Imported bank transactions. Change a category to teach DecisionLab; manual choices are never overwritten by rules."
        actions={
          <>
            {analytics.transactions.length > 0 && <Button onClick={exportFiltered}>Export CSV</Button>}
            <Button variant="primary" onClick={() => setImportOpen(true)}>
              Import CSV
            </Button>
          </>
        }
      />
      <ImportWizard open={importOpen} onClose={() => setImportOpen(false)} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'transactions', label: 'Transactions', badge: uncategorisedCount > 0 ? <Badge tone="warn">{uncategorisedCount} to review</Badge> : undefined },
          { value: 'imports', label: 'Import history' },
          { value: 'rules', label: 'Categorisation rules' },
        ]}
      />

      {tab === 'transactions' &&
        (analytics.transactions.length === 0 ? (
          <EmptyState
            title="No transactions yet"
            action={
              <>
                <Button variant="primary" onClick={() => setImportOpen(true)}>
                  Import a CSV statement
                </Button>
                <Button
                  onClick={async () => {
                    await loadDemoData();
                    toast({ message: 'Synthetic demonstration data loaded.', tone: 'good' });
                  }}
                >
                  Load demo data
                </Button>
              </>
            }
          >
            Import a CSV from your bank, or explore with a clearly labelled synthetic dataset.
          </EmptyState>
        ) : (
          <div className="grid gap-4">
            {transferPairs.length > 0 && (
              <Notice tone="warn" title={`${transferPairs.length} possible transfers between your accounts`}>
                <p>
                  Equal and opposite amounts in two of your accounts within 3 days. If these are transfers, categorising them as Transfers stops them being
                  counted as both spending and income.
                </p>
                <Button
                  size="sm"
                  className="mt-2"
                  onClick={async () => {
                    for (const [o, i] of transferPairs) {
                      await setTransactionCategory(o.id, 'cat-transfers', false);
                      await setTransactionCategory(i.id, 'cat-transfers', false);
                    }
                    toast({ message: `Marked ${transferPairs.length * 2} transactions as transfers.`, tone: 'good' });
                  }}
                >
                  Mark all as transfers
                </Button>
              </Notice>
            )}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
              <Input aria-label="Search" placeholder="Search description, notes or amount" value={search} onChange={(e) => setSearch(e.target.value)} className="lg:col-span-2" />
              <Select aria-label="Account" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
                <option value="">All accounts</option>
                {(accounts ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
              <Select aria-label="Category" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="">All categories</option>
                <option value="__none">Uncategorised</option>
                {analytics.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Input aria-label="From date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <Input aria-label="To date" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-2">
              <div className="flex flex-wrap items-center gap-3">
                <Select aria-label="Direction" value={direction} onChange={(e) => setDirection(e.target.value as '' | 'in' | 'out')} className="w-36">
                  <option value="">Money in and out</option>
                  <option value="out">Money out</option>
                  <option value="in">Money in</option>
                </Select>
                <span>
                  {filtered.length.toLocaleString()} transactions · net <span className="tabular">{formatMoney(total, { signed: true })}</span>
                </span>
              </div>
              <Checkbox label="Apply category changes to the same merchant" checked={remember} onChange={setRemember} />
            </div>

            <div className="overflow-x-auto rounded-xl border border-border bg-surface">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-xs text-muted">
                  <tr className="border-b border-border text-left">
                    <th scope="col" className="px-3 py-2 font-medium">Date</th>
                    <th scope="col" className="px-3 py-2 font-medium">Description</th>
                    <th scope="col" className="px-3 py-2 font-medium">Category</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, limit).map((t) => {
                    const cat = t.categoryId ? analytics.categoryMap.get(t.categoryId) : undefined;
                    return (
                      <tr key={t.id} className="border-b border-border/60 last:border-0 hover:bg-surface-2/60">
                        <td className="whitespace-nowrap px-3 py-1.5 text-ink-2 tabular">{formatDate(t.date)}</td>
                        <td className="px-3 py-1.5">
                          <button className="text-left hover:underline" onClick={() => setSelected(t)}>
                            <span className="font-medium text-ink">{merchantLabel(t.merchant)}</span>
                            <span className="block max-w-[28rem] truncate text-xs text-muted">
                              {accountName.get(t.accountId)} · {t.description}
                              {t.notes ? ` · ${t.notes}` : ''}
                            </span>
                          </button>
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-2">
                            <CategoryDot color={cat?.color} />
                            <CategorySelect
                              ariaLabel={`Category for ${t.description}`}
                              categories={analytics.categories}
                              value={t.categoryId}
                              onChange={(id) => changeCategory(t, id)}
                              className={cx('h-8 w-44 text-xs', !t.categoryId && 'border-warn')}
                            />
                            {t.categorySource !== 'none' && (
                              <span className="hidden text-[10px] uppercase tracking-wide text-muted xl:inline" title="How this category was assigned">
                                {t.categorySource}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className={cx('whitespace-nowrap px-3 py-1.5 text-right font-medium tabular', t.amount > 0 && 'text-good')}>
                          {formatMoney(t.amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length === 0 && <p className="p-6 text-center text-sm text-ink-2">No transactions match these filters.</p>}
            </div>
            {filtered.length > limit && (
              <Button onClick={() => setLimit((l) => l + PAGE)} className="justify-self-center">
                Show more ({filtered.length - limit} remaining)
              </Button>
            )}
          </div>
        ))}

      {tab === 'imports' && <ImportHistory accountName={accountName} />}
      {tab === 'rules' && <RulesPanel />}

      <TransactionDetail txn={selected} onClose={() => setSelected(null)} accountName={selected ? accountName.get(selected.accountId) : undefined} />
    </div>
  );
}

function ImportHistory({ accountName }: { accountName: Map<string, string> }) {
  const imports = useLiveQuery(() => db.imports.orderBy('importedAt').reverse().toArray(), []);
  const toast = useToast();
  if (!imports) return <Spinner />;
  if (imports.length === 0) return <EmptyState title="No imports yet">Each CSV you import appears here and can be undone.</EmptyState>;
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-xs text-muted">
          <tr className="border-b border-border text-left">
            <th className="px-3 py-2 font-medium">Imported</th>
            <th className="px-3 py-2 font-medium">File</th>
            <th className="px-3 py-2 font-medium">Account</th>
            <th className="px-3 py-2 font-medium">Period</th>
            <th className="px-3 py-2 text-right font-medium">Added / duplicates / errors</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {imports.map((imp) => (
            <tr key={imp.id} className="border-b border-border/60 last:border-0">
              <td className="whitespace-nowrap px-3 py-2">{new Date(imp.importedAt).toLocaleString('en-NZ')}</td>
              <td className="px-3 py-2">
                {imp.fileName} {imp.isDemo && <Badge tone="warn">Demo</Badge>}
              </td>
              <td className="px-3 py-2">{accountName.get(imp.accountId) ?? '—'}</td>
              <td className="whitespace-nowrap px-3 py-2">{imp.dateRange ? `${formatDate(imp.dateRange.start)} – ${formatDate(imp.dateRange.end)}` : '—'}</td>
              <td className="px-3 py-2 text-right tabular">
                {imp.importedCount} / {imp.duplicateCount} / {imp.errorCount}
              </td>
              <td className="px-3 py-2 text-right">
                {imp.status === 'undone' ? (
                  <Badge>Undone</Badge>
                ) : (
                  <ConfirmButton
                    size="sm"
                    title="Undo this import?"
                    confirmText={`This removes the ${imp.importedCount} transactions added by ${imp.fileName}, including any categories or notes you set on them.`}
                    onConfirm={async () => {
                      const n = await undoImport(imp.id);
                      toast({ message: `Removed ${n} transactions.`, tone: 'good' });
                    }}
                  >
                    Undo
                  </ConfirmButton>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TransactionDetail({ txn, onClose, accountName }: { txn: Transaction | null; onClose: () => void; accountName?: string }) {
  const [notes, setNotes] = useState('');
  const [lastId, setLastId] = useState<string | null>(null);
  const toast = useToast();
  const rule = useLiveQuery(async () => (txn?.ruleId ? db.rules.get(txn.ruleId) : undefined), [txn?.ruleId]);
  if (txn && txn.id !== lastId) {
    setLastId(txn.id);
    setNotes(txn.notes ?? '');
  }
  return (
    <Modal
      open={!!txn}
      onClose={onClose}
      title="Transaction details"
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button
            variant="primary"
            onClick={async () => {
              if (txn) await updateTransactionNotes(txn.id, notes);
              toast({ message: 'Notes saved.', tone: 'good' });
              onClose();
            }}
          >
            Save notes
          </Button>
        </>
      }
    >
      {txn && (
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
            <dt className="text-muted">Merchant key</dt>
            <dd className="font-mono text-xs">{txn.merchant}</dd>
            <dt className="text-muted">Categorised by</dt>
            <dd>
              {txn.categorySource === 'rule' ? `Rule “${rule?.name ?? 'deleted rule'}”` : txn.categorySource === 'memory' ? 'Your earlier correction for this merchant' : txn.categorySource === 'manual' ? 'You (manual)' : 'Not categorised'}
            </dd>
          </dl>
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
        </div>
      )}
    </Modal>
  );
}
