/**
 * CSV import wizard: file → column mapping → preview (nothing written) → commit.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Badge, Button, Checkbox, Field, Input, Modal, Notice, Select, cx } from '@/ui/components';
import { parseCsvText, suggestMapping, validateMapping, MAX_CSV_BYTES, type ParsedCsv } from '@/engine/csv';
import { detectPreset, type BankPreset } from '@/engine/csvPresets';
import { commitImport, previewImport, type ImportPreview } from '@/data/imports';
import { saveAccount } from '@/data/transactions';
import { db } from '@/data/db';
import { DATE_FORMATS, formatDate } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import type { AccountType, CsvMapping } from '@/domain/types';
import { useCategoryMap } from '@/hooks/useAppData';
import { useToast } from '@/ui/toast';
import { newId, nowTimestamp } from '@/domain/ids';

type Step = 'file' | 'mapping' | 'preview';

export function ImportWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const accounts = useLiveQuery(() => db.accounts.toArray(), []);
  const profiles = useLiveQuery(() => db.importProfiles.toArray(), []);
  const categoryMap = useCategoryMap();
  const toast = useToast();
  const [step, setStep] = useState<Step>('file');
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState('');
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountType, setNewAccountType] = useState<AccountType>('everyday');
  const [mapping, setMapping] = useState<Partial<CsvMapping>>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveProfileName, setSaveProfileName] = useState('');
  const [filter, setFilter] = useState<'all' | 'new' | 'duplicate' | 'error'>('all');
  const [preset, setPreset] = useState<BankPreset | null>(null);

  useEffect(() => {
    if (!open) {
      setStep('file');
      setParsed(null);
      setPreview(null);
      setFileName('');
      setFileError(null);
      setMapping({});
      setSaveProfileName('');
      setPreset(null);
    }
  }, [open]);

  useEffect(() => {
    if (accounts && accounts.length > 0 && !accountId) setAccountId(accounts[0]!.id);
    if (accounts && accounts.length === 0) setAccountId('__new');
  }, [accounts, accountId]);

  const mappingErrors = parsed ? validateMapping(mapping, parsed.headers) : [];

  async function onFile(file: File) {
    setFileError(null);
    if (file.size > MAX_CSV_BYTES) return setFileError('File is larger than 10 MB.');
    if (!/\.(csv|txt)$/i.test(file.name)) return setFileError('Choose a .csv file exported from your bank.');
    try {
      const text = await file.text();
      const p = parseCsvText(text);
      if (p.headers.length < 2 || p.rows.length === 0) return setFileError('No rows found. Is this a CSV with a header row?');
      setParsed(p);
      setFileName(file.name);
      const detected = detectPreset(p.headers);
      setPreset(detected);
      setMapping(detected ? detected.mapping : suggestMapping(p));
    } catch (e) {
      setFileError(e instanceof Error ? e.message : 'Could not read the file.');
    }
  }

  async function goPreview() {
    if (!parsed || mappingErrors.length) return;
    setBusy(true);
    try {
      let accId = accountId;
      if (accId === '__new') {
        if (!newAccountName.trim()) {
          toast({ message: 'Name the new account first.', tone: 'bad' });
          return;
        }
        accId = await saveAccount({ name: newAccountName.trim(), type: newAccountType, includeInLiquid: newAccountType !== 'credit' && newAccountType !== 'investment' });
        setAccountId(accId);
      }
      setPreview(await previewImport(accId, parsed.rows, mapping as CsvMapping));
      setStep('preview');
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!preview) return;
    setBusy(true);
    try {
      const batch = await commitImport({ accountId, fileName, mapping: mapping as CsvMapping, preview });
      if (saveProfileName.trim()) {
        await db.importProfiles.add({ id: newId('prof'), name: saveProfileName.trim(), mapping: mapping as CsvMapping, createdAt: nowTimestamp() });
      }
      toast({ message: `Imported ${batch.importedCount} transactions (${batch.duplicateCount} duplicates skipped).`, tone: 'good' });
      onClose();
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : 'Import failed; nothing was saved.', tone: 'bad' });
    } finally {
      setBusy(false);
    }
  }

  const visibleRows = useMemo(() => (preview?.rows ?? []).filter((r) => filter === 'all' || r.status === filter).slice(0, 300), [preview, filter]);
  const set = (patch: Partial<CsvMapping>) => setMapping((m) => ({ ...m, ...patch }));
  const headerOptions = (parsed?.headers ?? []).map((h) => (
    <option key={h} value={h}>
      {h}
    </option>
  ));

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={step === 'file' ? 'Import bank statement · 1 of 3' : step === 'mapping' ? 'Map columns · 2 of 3' : 'Review before importing · 3 of 3'}
      footer={
        <>
          {step !== 'file' && (
            <Button onClick={() => setStep(step === 'preview' ? 'mapping' : 'file')} disabled={busy}>
              Back
            </Button>
          )}
          {step === 'file' && (
            <Button variant="primary" disabled={!parsed || !accountId} onClick={() => setStep('mapping')}>
              Next
            </Button>
          )}
          {step === 'mapping' && (
            <Button variant="primary" disabled={mappingErrors.length > 0 || busy} onClick={goPreview}>
              {busy ? 'Checking…' : 'Preview import'}
            </Button>
          )}
          {step === 'preview' && (
            <Button variant="primary" disabled={!preview || preview.counts.new === 0 || busy} onClick={commit}>
              {busy ? 'Importing…' : `Import ${preview?.counts.new ?? 0} transactions`}
            </Button>
          )}
        </>
      }
    >
      {step === 'file' && (
        <div className="grid gap-4">
          <Notice>
            Files are read inside your browser and never uploaded. Export a CSV from your bank’s internet banking (most NZ banks offer
            “Export → CSV”). The original values of every row are kept for auditing.
          </Notice>
          <Field label="CSV file" htmlFor="csv-file" error={fileError}>
            <input
              id="csv-file"
              type="file"
              accept=".csv,text/csv,.txt"
              className="text-sm file:mr-3 file:rounded-lg file:border file:border-border file:bg-surface-2 file:px-3 file:py-2 file:text-sm file:text-ink"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
          </Field>
          {parsed && (
            <p className="text-sm text-ink-2">
              Found <strong>{parsed.rows.length}</strong> rows and columns: {parsed.headers.join(', ')}.
              {parsed.warnings.length > 0 && <span className="text-warn"> {parsed.warnings.length} parsing warnings.</span>}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Import into account" htmlFor="imp-account">
              <Select id="imp-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {(accounts ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
                <option value="__new">+ New account…</option>
              </Select>
            </Field>
            {accountId === '__new' && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Account name" htmlFor="new-acc">
                  <Input id="new-acc" value={newAccountName} onChange={(e) => setNewAccountName(e.target.value)} placeholder="e.g. Everyday" />
                </Field>
                <Field label="Type" htmlFor="new-acc-type">
                  <Select id="new-acc-type" value={newAccountType} onChange={(e) => setNewAccountType(e.target.value as AccountType)}>
                    <option value="everyday">Everyday</option>
                    <option value="savings">Savings</option>
                    <option value="credit">Credit card</option>
                    <option value="investment">Investment</option>
                    <option value="other">Other</option>
                  </Select>
                </Field>
              </div>
            )}
          </div>
        </div>
      )}

      {step === 'mapping' && parsed && (
        <div className="grid gap-4">
          {preset && (
            <Notice tone={preset.verified ? 'good' : 'warn'} title={`Looks like a ${preset.bank} export`}>
              The columns below were filled in from DecisionLab’s {preset.bank} layout
              {preset.verified ? `, verified on ${preset.verified.on}.` : ', which has not yet been verified against a real export — check the date format and that spending shows as negative in the preview.'}
              {preset.notes && <span className="block">{preset.notes}</span>}
            </Notice>
          )}
          {profiles && profiles.length > 0 && (
            <Field label="Use a saved mapping" htmlFor="profile">
              <Select
                id="profile"
                defaultValue=""
                onChange={(e) => {
                  const p = profiles.find((x) => x.id === e.target.value);
                  if (p) setMapping(p.mapping);
                }}
              >
                <option value="">Choose…</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Date column" htmlFor="m-date">
              <Select id="m-date" value={mapping.dateColumn ?? ''} onChange={(e) => set({ dateColumn: e.target.value })}>
                <option value="">Choose…</option>
                {headerOptions}
              </Select>
            </Field>
            <Field label="Date format" htmlFor="m-datefmt" hint={mapping.dateColumn ? `Sample: ${parsed.rows[0]?.[mapping.dateColumn] ?? ''}` : undefined}>
              <Select id="m-datefmt" value={mapping.dateFormat ?? ''} onChange={(e) => set({ dateFormat: e.target.value as CsvMapping['dateFormat'] })}>
                {DATE_FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amounts are" htmlFor="m-mode">
              <Select id="m-mode" value={mapping.amountMode ?? 'signed'} onChange={(e) => set({ amountMode: e.target.value as CsvMapping['amountMode'] })}>
                <option value="signed">One signed amount column</option>
                <option value="debitCredit">Separate debit and credit columns</option>
              </Select>
            </Field>
            {mapping.amountMode !== 'debitCredit' ? (
              <>
                <Field label="Amount column" htmlFor="m-amount">
                  <Select id="m-amount" value={mapping.amountColumn ?? ''} onChange={(e) => set({ amountColumn: e.target.value })}>
                    <option value="">Choose…</option>
                    {headerOptions}
                  </Select>
                </Field>
                <div className="flex items-end pb-2">
                  <Checkbox
                    label="Spending appears as positive numbers"
                    hint="Flip signs so money out is negative"
                    checked={!!mapping.invertSign}
                    onChange={(v) => set({ invertSign: v })}
                  />
                </div>
              </>
            ) : (
              <>
                <Field label="Debit (money out) column" htmlFor="m-debit">
                  <Select id="m-debit" value={mapping.debitColumn ?? ''} onChange={(e) => set({ debitColumn: e.target.value || undefined })}>
                    <option value="">None</option>
                    {headerOptions}
                  </Select>
                </Field>
                <Field label="Credit (money in) column" htmlFor="m-credit">
                  <Select id="m-credit" value={mapping.creditColumn ?? ''} onChange={(e) => set({ creditColumn: e.target.value || undefined })}>
                    <option value="">None</option>
                    {headerOptions}
                  </Select>
                </Field>
              </>
            )}
            <Field label="Balance column (optional)" htmlFor="m-bal" hint="Lets DecisionLab read your balance and check for missing transactions">
              <Select id="m-bal" value={mapping.balanceColumn ?? ''} onChange={(e) => set({ balanceColumn: e.target.value || undefined })}>
                <option value="">None</option>
                {headerOptions}
              </Select>
            </Field>
            <Field label="Reference column (optional)" htmlFor="m-ref">
              <Select id="m-ref" value={mapping.referenceColumn ?? ''} onChange={(e) => set({ referenceColumn: e.target.value || undefined })}>
                <option value="">None</option>
                {headerOptions}
              </Select>
            </Field>
          </div>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Description columns (joined in order)</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {parsed.headers.map((h) => (
                <Checkbox
                  key={h}
                  label={h}
                  checked={mapping.descriptionColumns?.includes(h) ?? false}
                  onChange={(v) =>
                    set({ descriptionColumns: v ? [...(mapping.descriptionColumns ?? []), h] : (mapping.descriptionColumns ?? []).filter((c) => c !== h) })
                  }
                />
              ))}
            </div>
          </fieldset>
          {mappingErrors.length > 0 && <Notice tone="warn">{mappingErrors.join(' ')}</Notice>}
          <div>
            <p className="mb-1 text-sm font-medium">First rows of the file</p>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-surface-2">
                  <tr>
                    {parsed.headers.map((h) => (
                      <th key={h} className="px-2 py-1 text-left font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 5).map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      {parsed.headers.map((h) => (
                        <td key={h} className="whitespace-nowrap px-2 py-1">
                          {r[h]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {step === 'preview' && preview && (
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            {(['all', 'new', 'duplicate', 'error'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cx('rounded-full border px-3 py-1 text-sm', filter === f ? 'border-accent bg-accent-soft text-accent' : 'border-border text-ink-2')}
              >
                {f === 'all' ? `All ${preview.rows.length}` : `${f === 'new' ? 'New' : f === 'duplicate' ? 'Duplicates' : 'Errors'} ${preview.counts[f]}`}
              </button>
            ))}
          </div>
          <p className="text-sm text-ink-2">
            {preview.dateRange ? (
              <>
                New transactions span {formatDate(preview.dateRange.start)} – {formatDate(preview.dateRange.end)}, net {formatMoney(preview.netTotal, { signed: true })}.{' '}
              </>
            ) : null}
            Duplicates of transactions already in this account are skipped. Rows with errors are not imported.
          </p>
          {preview.closingBalance && (
            <p className="text-sm">
              Closing balance in this statement: <strong className="tabular">{formatMoney(preview.closingBalance.amount)}</strong> on {formatDate(preview.closingBalance.asOf)}{' '}
              <Badge tone="good">Known</Badge> — it becomes the account’s current balance if it is the most recent.
            </p>
          )}
          {preview.balanceGaps.length > 0 && (
            <Notice tone="warn" title="The statement’s running balance doesn’t add up in places">
              {preview.balanceGaps.slice(0, 3).map((g) => (
                <span key={`${g.from}-${g.to}`} className="block">
                  Between {formatDate(g.from)} and {formatDate(g.to)}: expected {formatMoney(g.expected)}, statement shows {formatMoney(g.printed)} ({formatMoney(g.difference, { signed: true })}).
                </span>
              ))}
              Rows may be missing from the file, or the file may mix several accounts.
            </Notice>
          )}
          <div className="max-h-[45vh] overflow-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="px-2 py-1.5 text-left">Row</th>
                  <th className="px-2 py-1.5 text-left">Status</th>
                  <th className="px-2 py-1.5 text-left">Date</th>
                  <th className="px-2 py-1.5 text-left">Description</th>
                  <th className="px-2 py-1.5 text-left">Category</th>
                  <th className="px-2 py-1.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.rowNumber} className="border-t border-border">
                    <td className="px-2 py-1 text-muted tabular">{r.rowNumber}</td>
                    <td className="px-2 py-1">
                      <Badge tone={r.status === 'new' ? 'good' : r.status === 'duplicate' ? 'neutral' : 'bad'}>{r.status}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1">{r.date ?? '—'}</td>
                    <td className="px-2 py-1">
                      {r.description}
                      {r.errors.length > 0 && <span className="block text-xs text-bad">{r.errors.join(' ')}</span>}
                    </td>
                    <td className="px-2 py-1 text-ink-2">
                      {r.categorisation?.categoryId ? categoryMap.get(r.categorisation.categoryId)?.name : r.status !== 'error' ? 'Uncategorised' : ''}
                    </td>
                    <td className={cx('whitespace-nowrap px-2 py-1 text-right tabular', (r.amount ?? 0) > 0 && 'text-good')}>
                      {r.amount !== null ? formatMoney(r.amount) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Field label="Save this column mapping for next time (optional)" htmlFor="save-profile">
            <Input id="save-profile" value={saveProfileName} onChange={(e) => setSaveProfileName(e.target.value)} placeholder="e.g. My bank – everyday account" />
          </Field>
        </div>
      )}
    </Modal>
  );
}
