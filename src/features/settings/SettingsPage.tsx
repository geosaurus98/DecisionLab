import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Badge, Button, Card, Checkbox, ConfirmButton, Field, Input, Modal, MoneyInput, Notice, NumberInput, PageHeader, Segmented, Select, Spinner, Tabs } from '@/ui/components';
import { db } from '@/data/db';
import { deleteAccount, removeCategory, saveAccount, saveCategory } from '@/data/transactions';
import { DEFAULT_PROFILE, SETTING_KEYS, getDefaultAssumptions, setSetting } from '@/data/settings';
import { decryptJson, deleteAllData, encryptJson, exportBackup, isEncryptedBackup, MIN_PASSPHRASE_LENGTH, removeDemoData, restoreBackup } from '@/data/backup';
import { ensureSeeded } from '@/data/init';
import { loadDemoData } from '@/data/demo/load';
import { generateDemoData } from '@/data/demo/generate';
import type { Account, AccountType, CategoryKind, FinancialProfile, Goal, ProjectionAssumptions } from '@/domain/types';
import { useHasDemo, useProfile } from '@/hooks/useAppData';
import { formatMoney } from '@/domain/money';
import { todayIso } from '@/domain/dates';
import { newId, nowTimestamp } from '@/domain/ids';
import { useTheme } from '@/ui/theme';
import { useToast } from '@/ui/toast';
import { downloadText } from '@/ui/download';
import { AssumptionsEditor } from '../scenarios/AssumptionsEditor';
import { goalSaved } from '@/engine/flexibility';
import { BackupDialog, useBackupState } from './BackupDialog';
import { backupStatus, chooseBackupFolder, folderBackupSupported, forgetBackupFolder, setBackupState } from '@/data/backupSchedule';
import { disableReminders, enableReminders, notificationsSupported, REMINDER_KEY, type ReminderSettings } from '@/data/reminders';

type Tab = 'accounts' | 'planning' | 'categories' | 'data' | 'appearance';

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('accounts');
  return (
    <div>
      <PageHeader title="Settings" description="Accounts, planning inputs, categories and your data." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'accounts', label: 'Accounts & balances' },
          { value: 'planning', label: 'Planning & goals' },
          { value: 'categories', label: 'Categories' },
          { value: 'data', label: 'Data & privacy' },
          { value: 'appearance', label: 'Reminders & appearance' },
        ]}
      />
      {tab === 'accounts' && <AccountsSection />}
      {tab === 'planning' && <PlanningSection />}
      {tab === 'categories' && <CategoriesSection />}
      {tab === 'data' && <DataSection />}
      {tab === 'appearance' && <AppearanceSection />}
    </div>
  );
}

function AccountsSection() {
  const accounts = useLiveQuery(() => db.accounts.toArray(), []);
  const [editing, setEditing] = useState<Partial<Account> | null>(null);
  const toast = useToast();
  if (!accounts) return <Spinner />;
  return (
    <Card
      title="Accounts"
      description="Balances are entered by you and used only for the “available now” estimate. They are never inferred as spendable automatically."
      actions={
        <Button size="sm" variant="primary" onClick={() => setEditing({ name: '', type: 'everyday', includeInLiquid: true })}>
          Add account
        </Button>
      }
    >
      {accounts.length === 0 ? (
        <p className="text-sm text-ink-2">No accounts yet. Accounts are also created when you import a CSV.</p>
      ) : (
        <ul className="grid gap-2">
          {accounts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {a.name} {a.isDemo && <Badge tone="warn">Demo</Badge>} {!a.includeInLiquid && <Badge>Not liquid</Badge>}
                </p>
                <p className="text-xs text-muted">
                  {a.type}
                  {a.institution ? ` · ${a.institution}` : ''}
                </p>
              </div>
              <span className="grid text-right tabular">
                {a.statementBalance && (
                  <span>
                    {formatMoney(a.statementBalance.amount)} <Badge tone="good">From statement</Badge> <span className="text-xs text-muted">{a.statementBalance.asOf}</span>
                  </span>
                )}
                {a.balance ? (
                  <span className={a.statementBalance ? 'text-xs text-muted' : ''}>
                    {formatMoney(a.balance.amount)} entered, as of {a.balance.asOf}
                  </span>
                ) : (
                  !a.statementBalance && <span className="text-muted">No balance</span>
                )}
              </span>
              <Button size="sm" onClick={() => setEditing(a)}>
                Edit
              </Button>
              <ConfirmButton
                size="sm"
                title={`Delete ${a.name}?`}
                confirmText="This permanently deletes the account, all of its transactions and its import history."
                onConfirm={async () => {
                  await deleteAccount(a.id);
                  toast({ message: 'Account deleted.', tone: 'good' });
                }}
              >
                Delete
              </ConfirmButton>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit account' : 'Add account'}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!editing?.name?.trim()}
              onClick={async () => {
                if (!editing) return;
                await saveAccount({ ...(editing as Account), name: editing.name!.trim() });
                setEditing(null);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        {editing && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="acc-name">
              <Input id="acc-name" value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field label="Type" htmlFor="acc-type">
              <Select id="acc-type" value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value as AccountType })}>
                <option value="everyday">Everyday</option>
                <option value="savings">Savings</option>
                <option value="credit">Credit card</option>
                <option value="investment">Investment</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </Select>
            </Field>
            <Field label="Institution (optional)" htmlFor="acc-inst">
              <Input id="acc-inst" value={editing.institution ?? ''} onChange={(e) => setEditing({ ...editing, institution: e.target.value })} />
            </Field>
            <Field label="Current balance" htmlFor="acc-bal" hint="Leave blank if unknown. A more recent balance from an imported statement takes precedence.">
              <MoneyInput
                id="acc-bal"
                allowNegative
                value={editing.balance?.amount ?? null}
                onChange={(v) => setEditing({ ...editing, balance: v === null ? undefined : { amount: v, asOf: editing.balance?.asOf ?? todayIso() } })}
              />
            </Field>
            {editing.balance && (
              <Field label="Balance as of" htmlFor="acc-asof">
                <Input id="acc-asof" type="date" value={editing.balance.asOf} onChange={(e) => setEditing({ ...editing, balance: { ...editing.balance!, asOf: e.target.value } })} />
              </Field>
            )}
            <div className="sm:col-span-2">
              <Checkbox
                label="Count this balance as liquid funds"
                hint="Untick for credit cards, KiwiSaver and investments you would not sell for everyday decisions."
                checked={editing.includeInLiquid ?? true}
                onChange={(v) => setEditing({ ...editing, includeInLiquid: v })}
              />
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}

function PlanningSection() {
  const stored = useProfile();
  const goals = useLiveQuery(() => db.goals.toArray(), []);
  const [profile, setProfile] = useState<FinancialProfile | null>(null);
  const [assumptions, setAssumptions] = useState<ProjectionAssumptions | null>(null);
  const toast = useToast();
  useEffect(() => {
    if (stored && !profile) setProfile(stored);
  }, [stored, profile]);
  useEffect(() => {
    getDefaultAssumptions().then(setAssumptions);
  }, []);
  if (!profile || !goals || !assumptions) return <Spinner />;
  const set = (patch: Partial<FinancialProfile>) => setProfile({ ...profile, ...patch });

  return (
    <div className="grid gap-5">
      <Card title="Flexibility inputs" description="Used to estimate how much you can realistically spend on discretionary decisions.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Emergency reserve target" htmlFor="pf-reserve" hint="Commonly 3–6 months of essential spending">
            <MoneyInput id="pf-reserve" value={profile.emergencyReserveTarget} onChange={(v) => set({ emergencyReserveTarget: v ?? 0 })} />
          </Field>
          <Field label="Monthly savings commitment" htmlFor="pf-save" hint="What you intend to save or invest each month">
            <MoneyInput id="pf-save" value={profile.monthlySavingsCommitment} onChange={(v) => set({ monthlySavingsCommitment: v ?? 0 })} />
          </Field>
          <Field label="Months used for estimates" htmlFor="pf-look">
            <NumberInput id="pf-look" min={1} max={24} value={profile.lookbackMonths} onChange={(v) => set({ lookbackMonths: Math.round(v ?? 6) })} />
          </Field>
          <Field label="Monthly income override" htmlFor="pf-inc" hint="Blank = estimate from transactions">
            <MoneyInput id="pf-inc" value={profile.monthlyIncomeOverride} onChange={(v) => set({ monthlyIncomeOverride: v })} />
          </Field>
          <Field label="Monthly obligations override" htmlFor="pf-obl" hint="Blank = detected recurring payments">
            <MoneyInput id="pf-obl" value={profile.monthlyObligationsOverride} onChange={(v) => set({ monthlyObligationsOverride: v })} />
          </Field>
          <Field label="Count upcoming expenses due within (days)" htmlFor="pf-hz">
            <NumberInput id="pf-hz" min={7} max={730} value={profile.upcomingHorizonDays} onChange={(v) => set({ upcomingHorizonDays: Math.round(v ?? 90) })} />
          </Field>
        </div>
        <div className="mt-4 grid gap-2">
          <p className="text-sm font-medium">Upcoming expenses</p>
          {profile.upcomingExpenses.map((u) => (
            <div key={u.id} className="grid grid-cols-[1fr_8rem_10rem_auto] items-end gap-2">
              <Input aria-label="Expense" value={u.label} onChange={(e) => set({ upcomingExpenses: profile.upcomingExpenses.map((x) => (x.id === u.id ? { ...x, label: e.target.value } : x)) })} />
              <MoneyInput ariaLabel="Amount" value={u.amount} onChange={(v) => set({ upcomingExpenses: profile.upcomingExpenses.map((x) => (x.id === u.id ? { ...x, amount: v ?? 0 } : x)) })} />
              <Input aria-label="Due date" type="date" value={u.dueDate} onChange={(e) => set({ upcomingExpenses: profile.upcomingExpenses.map((x) => (x.id === u.id ? { ...x, dueDate: e.target.value } : x)) })} />
              <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => set({ upcomingExpenses: profile.upcomingExpenses.filter((x) => x.id !== u.id) })}>
                ✕
              </Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => set({ upcomingExpenses: [...profile.upcomingExpenses, { id: newId('up'), label: 'Expense', amount: 0, dueDate: todayIso() }] })}>
            + Add upcoming expense
          </Button>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setProfile({ ...DEFAULT_PROFILE })}>Reset</Button>
          <Button
            variant="primary"
            onClick={async () => {
              await setSetting(SETTING_KEYS.profile, profile);
              toast({ message: 'Planning inputs saved.', tone: 'good' });
            }}
          >
            Save planning inputs
          </Button>
        </div>
      </Card>

      <GoalsCard goals={goals} />

      <Card title="Default projection assumptions" description="Pre-filled into new decisions and scenarios. Existing decisions keep the assumptions they were created with.">
        <AssumptionsEditor idPrefix="def" value={assumptions} onChange={setAssumptions} />
        <div className="mt-3 flex justify-end">
          <Button
            variant="primary"
            onClick={async () => {
              await setSetting(SETTING_KEYS.assumptions, assumptions);
              toast({ message: 'Default assumptions saved.', tone: 'good' });
            }}
          >
            Save defaults
          </Button>
        </div>
      </Card>
    </div>
  );
}

function GoalsCard({ goals }: { goals: Goal[] }) {
  const [editing, setEditing] = useState<Goal | null>(null);
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];
  return (
    <Card
      title="Goals"
      description="Money earmarked for a goal is excluded from what is available for other decisions."
      actions={
        <Button size="sm" onClick={() => setEditing({ id: newId('goal'), name: '', targetAmount: 0, currentAmount: 0, earmarked: true, createdAt: nowTimestamp() })}>
          Add goal
        </Button>
      }
    >
      {goals.length === 0 ? (
        <p className="text-sm text-ink-2">No goals yet.</p>
      ) : (
        <ul className="grid gap-2">
          {goals.map((g) => {
            const saved = goalSaved(g, accounts);
            const progress = g.targetAmount > 0 ? Math.min(1, Math.max(0, saved / g.targetAmount)) : 0;
            return (
              <li key={g.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{g.name}</span>
                  {g.earmarked && <Badge tone="accent">Earmarked</Badge>}
                  <span className="ml-auto tabular">
                    {formatMoney(saved, { whole: true })} / {formatMoney(g.targetAmount, { whole: true })}
                    {g.accountId && ` (from ${accounts.find((a) => a.id === g.accountId)?.name ?? 'deleted account'})`}
                    {g.targetDate ? ` by ${g.targetDate}` : ''}
                  </span>
                  <Button size="sm" onClick={() => setEditing(g)}>
                    Edit
                  </Button>
                  <ConfirmButton size="sm" title="Delete goal?" confirmText="This deletes the goal." onConfirm={() => db.goals.delete(g.id)}>
                    Delete
                  </ConfirmButton>
                </div>
                <div className="mt-2 h-2 rounded bg-surface-2" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${g.name} progress`}>
                  <div className="h-2 rounded bg-accent" style={{ width: `${progress * 100}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Goal"
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!editing?.name.trim()}
              onClick={async () => {
                if (editing) await db.goals.put(editing);
                setEditing(null);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        {editing && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="g-name" className="sm:col-span-2">
              <Input id="g-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field label="Target amount" htmlFor="g-target">
              <MoneyInput id="g-target" value={editing.targetAmount} onChange={(v) => setEditing({ ...editing, targetAmount: v ?? 0 })} />
            </Field>
            <Field label="Track savings with" htmlFor="g-account" hint="Use an account’s balance as the amount saved">
              <Select id="g-account" value={editing.accountId ?? ''} onChange={(e) => setEditing({ ...editing, accountId: e.target.value || undefined })}>
                <option value="">Amount entered below</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} balance
                  </option>
                ))}
              </Select>
            </Field>
            {!editing.accountId && (
              <Field label="Saved so far" htmlFor="g-current">
                <MoneyInput id="g-current" value={editing.currentAmount} onChange={(v) => setEditing({ ...editing, currentAmount: v ?? 0 })} />
              </Field>
            )}
            <Field label="Target date (optional)" htmlFor="g-date">
              <Input id="g-date" type="date" value={editing.targetDate ?? ''} onChange={(e) => setEditing({ ...editing, targetDate: e.target.value || undefined })} />
            </Field>
            <div className="flex items-end pb-2">
              <Checkbox label="Earmark saved amount" checked={editing.earmarked} onChange={(v) => setEditing({ ...editing, earmarked: v })} />
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}

function CategoriesSection() {
  const categories = useLiveQuery(() => db.categories.orderBy('sortOrder').toArray(), []);
  const toast = useToast();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CategoryKind>('expense');
  if (!categories) return <Spinner />;
  return (
    <Card title="Categories" description="The kind controls how a category is counted. Transfers and savings are never counted as spending.">
      <ul className="grid gap-2">
        {categories
          .filter((c) => !c.archived)
          .map((c) => (
            <li key={c.id} className="grid items-center gap-2 rounded-lg border border-border p-2 text-sm sm:grid-cols-[1.5rem_1fr_9rem_9rem_auto]">
              <input aria-label={`Colour for ${c.name}`} type="color" value={c.color} onChange={(e) => saveCategory({ ...c, color: e.target.value })} className="h-6 w-6 rounded border-0 bg-transparent p-0" />
              <Input aria-label="Category name" value={c.name} onChange={(e) => saveCategory({ ...c, name: e.target.value })} className="h-8" />
              <Select aria-label="Kind" value={c.kind} onChange={(e) => saveCategory({ ...c, kind: e.target.value as CategoryKind })} className="h-8">
                <option value="expense">Expense</option>
                <option value="income">Income</option>
                <option value="transfer">Transfer</option>
                <option value="savings">Savings/investment</option>
              </Select>
              {c.kind === 'expense' ? (
                <Checkbox label="Essential" checked={c.essential} onChange={(v) => saveCategory({ ...c, essential: v })} />
              ) : (
                <span />
              )}
              <ConfirmButton
                size="sm"
                title={`Remove ${c.name}?`}
                confirmText="Categories that are used by transactions or rules are archived (hidden) instead of deleted, so history is preserved."
                onConfirm={async () => {
                  const r = await removeCategory(c.id);
                  toast({ message: r === 'archived' ? 'Category archived (still used by history).' : 'Category deleted.', tone: 'good' });
                }}
              >
                Remove
              </ConfirmButton>
            </li>
          ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <Field label="New category" htmlFor="new-cat">
          <Input id="new-cat" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Kind" htmlFor="new-cat-kind">
          <Select id="new-cat-kind" value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="transfer">Transfer</option>
            <option value="savings">Savings/investment</option>
          </Select>
        </Field>
        <Button
          variant="primary"
          disabled={!name.trim()}
          onClick={async () => {
            await saveCategory({ name: name.trim(), kind, essential: false, color: '#898781' });
            setName('');
          }}
        >
          Add
        </Button>
      </div>
    </Card>
  );
}

function DataSection() {
  const toast = useToast();
  const hasDemo = useHasDemo();
  const [encrypt, setEncrypt] = useState(true);
  const [passphrase, setPassphrase] = useState('');
  const [restoreFile, setRestoreFile] = useState<unknown | null>(null);
  const [restorePass, setRestorePass] = useState('');
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [deleteText, setDeleteText] = useState('');
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);

  async function doExport() {
    setBusy(true);
    try {
      const backup = await exportBackup();
      const stamp = todayIso();
      if (encrypt) {
        const enc = await encryptJson(backup, passphrase);
        downloadText(`decisionlab-${stamp}.decisionlab-backup.enc.json`, JSON.stringify(enc));
      } else {
        downloadText(`decisionlab-${stamp}.decisionlab-backup.json`, JSON.stringify(backup, null, 1));
      }
      await setBackupState({ lastBackupAt: new Date().toISOString() });
      toast({ message: 'Backup downloaded.', tone: 'good' });
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : 'Export failed.', tone: 'bad' });
    } finally {
      setBusy(false);
    }
  }

  async function doRestore() {
    setRestoreError(null);
    setBusy(true);
    try {
      const raw = isEncryptedBackup(restoreFile) ? await decryptJson(restoreFile, restorePass) : restoreFile;
      const report = await restoreBackup(raw);
      if (!report.ok) {
        setRestoreError(`Backup failed validation; nothing was changed. ${report.errors.slice(0, 3).join(' ')}`);
        return;
      }
      await ensureSeeded();
      setRestoreFile(null);
      toast({ message: `Restored ${report.counts.transactions ?? 0} transactions and ${report.counts.decisions ?? 0} decisions.`, tone: 'good' });
    } catch (e) {
      setRestoreError(e instanceof Error ? e.message : 'Restore failed; nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5">
      <Card title="Where your data lives">
        <ul className="grid list-disc gap-1 pl-5 text-sm text-ink-2">
          <li>Everything is stored in this browser’s IndexedDB on this device. DecisionLab has no server, account, analytics or tracking, and makes no network requests with your data.</li>
          <li>
            Browser storage is <strong>not encrypted by DecisionLab</strong>. Anyone with access to this device profile (or its disk) could read it. Use your device’s
            login, disk encryption and a separate browser profile for protection.
          </li>
          <li>Clearing site data in the browser deletes everything. Keep regular backups.</li>
          <li>
            Persistent storage: {persisted === null ? 'unknown' : persisted ? 'granted (the browser will not evict data automatically)' : 'not granted — the browser may evict data under storage pressure'}.
          </li>
        </ul>
      </Card>

      <BackupScheduleCard />

      <Card title="Back up" description="Download a copy of all your data. Encrypted backups use AES-256-GCM with a key derived from your passphrase (PBKDF2, 600,000 iterations).">
        <div className="grid gap-3 sm:grid-cols-2">
          <Checkbox label="Encrypt with a passphrase (recommended)" checked={encrypt} onChange={setEncrypt} />
          {encrypt && (
            <Field label="Passphrase" htmlFor="bk-pass" hint={`At least ${MIN_PASSPHRASE_LENGTH} characters. If you forget it, the backup cannot be recovered.`}>
              <Input id="bk-pass" type="password" autoComplete="new-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
            </Field>
          )}
        </div>
        {!encrypt && <Notice tone="warn">An unencrypted backup is a readable file containing all your financial data. Store it carefully.</Notice>}
        <div className="mt-3 flex justify-end">
          <Button variant="primary" disabled={busy || (encrypt && passphrase.length < MIN_PASSPHRASE_LENGTH)} onClick={doExport}>
            {busy ? 'Preparing…' : 'Download backup'}
          </Button>
        </div>
      </Card>

      <Card title="Restore" description="Replaces ALL current data with the backup’s contents after validating it.">
        <div className="grid gap-3">
          <input
            type="file"
            accept=".json,application/json"
            aria-label="Backup file"
            className="text-sm file:mr-3 file:rounded-lg file:border file:border-border file:bg-surface-2 file:px-3 file:py-2 file:text-sm file:text-ink"
            onChange={async (e) => {
              setRestoreError(null);
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 100 * 1024 * 1024) return setRestoreError('File is too large to be a DecisionLab backup.');
              try {
                setRestoreFile(JSON.parse(await f.text()));
              } catch {
                setRestoreError('This file is not valid JSON.');
              }
            }}
          />
          {restoreFile !== null && isEncryptedBackup(restoreFile) && (
            <Field label="Backup passphrase" htmlFor="rs-pass">
              <Input id="rs-pass" type="password" autoComplete="off" value={restorePass} onChange={(e) => setRestorePass(e.target.value)} />
            </Field>
          )}
          {restoreError && <Notice tone="bad">{restoreError}</Notice>}
          <div className="flex justify-end">
            <ConfirmButton
              variant="primary"
              title="Replace all data?"
              confirmText="All current transactions, decisions, scenarios and settings will be replaced by the backup. Consider downloading a backup of the current data first."
              onConfirm={doRestore}
            >
              Restore from backup
            </ConfirmButton>
          </div>
        </div>
      </Card>

      <Card title="Demonstration data" description="A synthetic year of transactions for a fictional person. Never mixed silently with your data: demo accounts are labelled and removable.">
        <div className="flex flex-wrap gap-2">
          {hasDemo ? (
            <Button
              onClick={async () => {
                await removeDemoData();
                toast({ message: 'Demo data removed.', tone: 'good' });
              }}
            >
              Remove demo data
            </Button>
          ) : (
            <Button
              onClick={async () => {
                await loadDemoData();
                toast({ message: 'Demo data loaded.', tone: 'good' });
              }}
            >
              Load demo data
            </Button>
          )}
          <Button variant="ghost" onClick={() => downloadText('decisionlab-sample-statement.csv', generateDemoData(todayIso()).everydayCsv, 'text/csv')}>
            Download a sample CSV (to try the import wizard)
          </Button>
        </div>
      </Card>

      <Card title="Delete everything" description="Permanently deletes all transactions, decisions, scenarios, settings and categories from this browser.">
        <div className="flex flex-wrap items-end gap-2">
          <Field label='Type "DELETE" to confirm' htmlFor="del-confirm">
            <Input id="del-confirm" value={deleteText} onChange={(e) => setDeleteText(e.target.value)} autoComplete="off" />
          </Field>
          <Button
            variant="danger"
            disabled={deleteText !== 'DELETE'}
            onClick={async () => {
              await deleteAllData();
              await ensureSeeded();
              setDeleteText('');
              toast({ message: 'All data deleted. Default categories restored.', tone: 'good' });
            }}
          >
            Delete all data
          </Button>
        </div>
      </Card>
    </div>
  );
}

function RemindersCard() {
  const toast = useToast();
  const settings = useLiveQuery(() => db.settings.get(REMINDER_KEY), []);
  const enabled = (settings?.value as ReminderSettings | undefined)?.enabled ?? false;
  const supported = notificationsSupported();
  return (
    <Card
      title="Review reminders"
      description="When DecisionLab opens, show a notification (at most once a day) if decisions are due for review. The notification never includes amounts or decision details. Because there is no server, reminders only appear when you open the app."
    >
      {!supported ? (
        <p className="text-sm text-ink-2">This browser does not support notifications. Due reviews are still shown on the Overview and as a badge on Decisions.</p>
      ) : (
        <Checkbox
          label="Remind me about decisions due for review"
          checked={enabled}
          onChange={async (v) => {
            if (!v) return disableReminders();
            const ok = await enableReminders();
            toast({ message: ok ? 'Reminders on.' : 'Notifications were blocked by the browser.', tone: ok ? 'good' : 'bad' });
          }}
        />
      )}
    </Card>
  );
}

function AppearanceSection() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="grid gap-5">
    <RemindersCard />
    <Card title="Theme">
      <Segmented
        ariaLabel="Theme"
        value={theme}
        onChange={setTheme}
        options={[
          { value: 'system', label: 'System' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
      />
    </Card>
    </div>
  );
}

function BackupScheduleCard() {
  const state = useBackupState();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const { daysSince } = backupStatus(state, todayIso(), true);
  return (
    <Card
      title="Backup reminders"
      description="DecisionLab reminds you on the Overview when a backup is due. Backups are created only when you click — nothing happens in the background."
      actions={
        <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
          Back up now
        </Button>
      }
    >
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <p>
          Last backup: <strong>{daysSince === null ? 'never' : daysSince === 0 ? 'today' : `${daysSince} day${daysSince === 1 ? '' : 's'} ago`}</strong>
        </p>
        <Field label="Remind me after" htmlFor="bk-interval">
          <Select id="bk-interval" value={state.intervalDays} onChange={(e) => setBackupState({ intervalDays: Number(e.target.value) })}>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={0}>Never remind me</option>
          </Select>
        </Field>
        <div className="sm:col-span-2">
          {folderBackupSupported() ? (
            <div className="flex flex-wrap items-center gap-2">
              <span>{state.folderName ? <>Backups are saved to the folder “{state.folderName}”.</> : 'Backups are downloaded. You can choose a folder (e.g. a synced cloud folder) instead.'}</span>
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    const name = await chooseBackupFolder();
                    if (name) toast({ message: `Backups will be saved to “${name}”.`, tone: 'good' });
                  } catch {
                    /* user cancelled the picker */
                  }
                }}
              >
                {state.folderName ? 'Change folder' : 'Choose folder'}
              </Button>
              {state.folderName && (
                <Button size="sm" variant="ghost" onClick={() => forgetBackupFolder()}>
                  Use downloads instead
                </Button>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted">This browser can’t save to a chosen folder, so backups are downloaded.</p>
          )}
        </div>
      </div>
      <BackupDialog open={open} onClose={() => setOpen(false)} />
    </Card>
  );
}
