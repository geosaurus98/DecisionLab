import { beforeEach, describe, expect, it } from 'vitest';
import { DecisionLabDb, useDatabase, db } from '../db';
import { ensureSeeded } from '../init';
import { commitImport, previewImport, undoImport } from '../imports';
import { reapplyCategorisation, saveAccount, saveRule, setTransactionCategory, moveRule } from '../transactions';
import { blankDecision, recordChoice, reopenDecision, saveDecision, saveReview } from '../decisions';
import { decryptJson, encryptJson, exportBackup, migrateBackup, restoreBackup, deleteAllData, removeDemoData } from '../backup';
import { defaultAssumptions } from '../settings';
import { loadDemoData } from '../demo/load';
import { generateDemoData } from '../demo/generate';
import { parseCsvText } from '@/engine/csv';
import { summarise } from '@/engine/cashflow';
import type { CsvMapping } from '@/domain/types';

const MAPPING: CsvMapping = {
  dateColumn: 'Date',
  dateFormat: 'DD/MM/YYYY',
  amountMode: 'signed',
  amountColumn: 'Amount',
  descriptionColumns: ['Payee'],
};

const CSV = `Date,Amount,Payee
01/03/2026,-84.20,EFTPOS COUNTDOWN KELBURN
02/03/2026,2150.00,ACME ENGINEERING LTD SALARY
03/03/2026,-4.50,MEMPHIS BELLE CAFE
03/03/2026,-4.50,MEMPHIS BELLE CAFE
04/03/2026,-12.00,KELBURN DAIRY
05/03/2026,-400.00,TRANSFER TO SAVINGS
bad,-1,BROKEN ROW
`;

let counter = 0;
beforeEach(async () => {
  useDatabase(new DecisionLabDb(`test-${++counter}`));
  await ensureSeeded();
});

async function setupAccount() {
  return saveAccount({ name: 'Everyday', type: 'everyday', includeInLiquid: true });
}

describe('import pipeline', () => {
  it('previews without writing, then commits, categorises and keeps originals', async () => {
    const accountId = await setupAccount();
    const preview = await previewImport(accountId, parseCsvText(CSV).rows, MAPPING);
    expect(preview.counts).toEqual({ new: 6, duplicate: 0, error: 1 });
    expect(await db.transactions.count()).toBe(0);

    const batch = await commitImport({ accountId, fileName: 'march.csv', mapping: MAPPING, preview });
    expect(batch.importedCount).toBe(6);
    const txns = await db.transactions.toArray();
    expect(txns).toHaveLength(6);
    const byDesc = (s: string) => txns.find((t) => t.description.includes(s))!;
    expect(byDesc('COUNTDOWN').categoryId).toBe('cat-groceries');
    expect(byDesc('SALARY').categoryId).toBe('cat-income');
    expect(byDesc('TRANSFER').categoryId).toBe('cat-transfers');
    expect(byDesc('DAIRY').categoryId).toBeNull();
    expect(byDesc('COUNTDOWN').original).toEqual({ Date: '01/03/2026', Amount: '-84.20', Payee: 'EFTPOS COUNTDOWN KELBURN' });
  });

  it('detects duplicates on re-import and supports undo', async () => {
    const accountId = await setupAccount();
    const rows = parseCsvText(CSV).rows;
    const first = await commitImport({ accountId, fileName: 'a.csv', mapping: MAPPING, preview: await previewImport(accountId, rows, MAPPING) });
    const again = await previewImport(accountId, rows, MAPPING);
    expect(again.counts.duplicate).toBe(6);
    expect(again.counts.new).toBe(0);

    const removed = await undoImport(first.id);
    expect(removed).toBe(6);
    expect(await db.transactions.count()).toBe(0);
    expect((await db.imports.get(first.id))!.status).toBe('undone');
    expect(await undoImport(first.id)).toBe(0);
    // After undo, the same rows are new again.
    expect((await previewImport(accountId, rows, MAPPING)).counts.new).toBe(6);
  });
});

describe('categorisation corrections', () => {
  it('remembers manual corrections for the merchant and never overrides manual choices', async () => {
    const accountId = await setupAccount();
    await commitImport({ accountId, fileName: 'a.csv', mapping: MAPPING, preview: await previewImport(accountId, parseCsvText(CSV).rows, MAPPING) });
    const cafes = await db.transactions.where('merchant').equals('MEMPHIS BELLE CAFE').toArray();
    expect(cafes).toHaveLength(2);
    const updated = await setTransactionCategory(cafes[0]!.id, 'cat-other', true);
    expect(updated).toBe(1);
    const after = await db.transactions.where('merchant').equals('MEMPHIS BELLE CAFE').toArray();
    expect(after.map((t) => t.categoryId)).toEqual(['cat-other', 'cat-other']);
    expect(after.find((t) => t.id === cafes[0]!.id)!.categorySource).toBe('manual');

    // A new rule does not override memory or manual categories on re-apply.
    await saveRule({ name: 'cafe', field: 'description', operator: 'contains', pattern: 'cafe', caseSensitive: false, direction: 'any', categoryId: 'cat-shopping', enabled: true, priority: 0 });
    await reapplyCategorisation();
    const final = await db.transactions.where('merchant').equals('MEMPHIS BELLE CAFE').toArray();
    expect(final.every((t) => t.categoryId === 'cat-other')).toBe(true);
  });

  it('reorders rules with unique priorities', async () => {
    const rules = await db.rules.orderBy('priority').toArray();
    await moveRule(rules[1]!.id, -1);
    const reordered = await db.rules.orderBy('priority').toArray();
    expect(reordered[0]!.id).toBe(rules[1]!.id);
    expect(new Set(reordered.map((r) => r.priority)).size).toBe(reordered.length);
  });
});

describe('decisions', () => {
  it('snapshots the decision at choice time; later edits do not rewrite it', async () => {
    const d = blankDecision(defaultAssumptions('2026-11-20'));
    d.title = 'Japan trip or invest';
    d.options[0]!.name = 'Japan trip';
    d.options[0]!.upfrontCost = 300_000;
    d.options[1]!.name = 'Invest';
    d.criteria = [{ id: 'c1', name: 'Experience', type: 'rating', direction: 'higher', weight: 1 }];
    d.scores = { [d.options[0]!.id]: { c1: 9 }, [d.options[1]!.id]: { c1: 3 } };
    await saveDecision(d);
    const decided = await recordChoice(d, d.options[0]!.id, 500_000);
    expect(decided.snapshot!.predictedCost).toBe(300_000);
    expect(decided.snapshot!.availableNow).toBe(500_000);
    expect(decided.snapshot!.financials.find((f) => f.optionId === d.options[1]!.id)!.differenceVsBest).toBe(0);

    // Edit live assumptions and costs: snapshot unchanged.
    decided.assumptions.annualReturn = 0.12;
    decided.options[0]!.upfrontCost = 1;
    await saveDecision(decided);
    const stored = (await db.decisions.get(d.id))!;
    expect(stored.snapshot!.assumptions.annualReturn).toBe(0.06);
    expect(stored.snapshot!.options[0]!.upfrontCost).toBe(300_000);
    await expect(recordChoice(stored, d.options[1]!.id)).rejects.toThrow();

    const reopened = await reopenDecision(stored);
    expect(reopened.snapshotHistory).toHaveLength(1);
    const again = await recordChoice(reopened, d.options[1]!.id);
    const reviewed = await saveReview(again, {
      reviewedAt: '2027-01-01T00:00:00Z',
      actualCost: 0,
      actualBenefits: '',
      satisfaction: 6,
      expectationsMet: 'met',
      wouldRepeat: 'unsure',
      unexpected: '',
      lessons: '',
    });
    expect(reviewed.status).toBe('reviewed');
    await expect(reopenDecision(reviewed)).rejects.toThrow();
  });
});

describe('backup', () => {
  it('round-trips all data through export and restore', async () => {
    const accountId = await setupAccount();
    await commitImport({ accountId, fileName: 'a.csv', mapping: MAPPING, preview: await previewImport(accountId, parseCsvText(CSV).rows, MAPPING) });
    const backup = JSON.parse(JSON.stringify(await exportBackup()));
    await deleteAllData();
    expect(await db.transactions.count()).toBe(0);
    const report = await restoreBackup(backup);
    expect(report.ok).toBe(true);
    expect(await db.transactions.count()).toBe(6);
    expect(await db.categories.count()).toBeGreaterThan(10);
  });

  it('rejects invalid or newer backups without touching data', async () => {
    await setupAccount();
    expect(() => migrateBackup({ hello: 'world' })).toThrow(/not a DecisionLab backup/);
    expect(() => migrateBackup({ format: 'decisionlab-backup', version: 99, exportedAt: '', data: {} })).toThrow(/newer/);
    const bad = await exportBackup();
    (bad.data.transactions as unknown[]).push({ id: 'x', amount: 1.5 });
    const report = await restoreBackup(JSON.parse(JSON.stringify(bad)));
    expect(report.ok).toBe(false);
    expect(await db.accounts.count()).toBe(1);
  });

  it('encrypts and decrypts with a passphrase, rejecting the wrong one', async () => {
    const payload = { secret: 'balances', n: 42 };
    const enc = await encryptJson(payload, 'correct horse battery', 100_000);
    expect(JSON.stringify(enc)).not.toContain('balances');
    expect(await decryptJson(enc, 'correct horse battery')).toEqual(payload);
    await expect(decryptJson(enc, 'wrong passphrase!!')).rejects.toThrow(/wrong passphrase/);
    await expect(encryptJson(payload, 'short')).rejects.toThrow();
  });
});

describe('demo dataset', () => {
  it('is deterministic for a given date and seed', () => {
    expect(generateDemoData('2026-11-20').everydayCsv).toBe(generateDemoData('2026-11-20').everydayCsv);
  });

  it('loads through the import pipeline with transfers excluded from spending, and can be removed', async () => {
    await loadDemoData('2026-11-20');
    const txns = await db.transactions.toArray();
    expect(txns.length).toBeGreaterThan(300);
    const uncategorised = txns.filter((t) => t.categoryId === null);
    expect(uncategorised.length / txns.length).toBeLessThan(0.08);
    const cats = new Map((await db.categories.toArray()).map((c) => [c.id, c]));
    const s = summarise(txns, cats, { start: '2026-10-01', end: '2026-10-31' });
    expect(s.income).toBeGreaterThan(400_000);
    expect(s.transfersOut).toBe(40_000);
    expect(s.transfersIn).toBe(40_000);
    expect(s.savingsContributions).toBe(10_000);
    expect(await db.decisions.count()).toBe(1);

    await removeDemoData();
    expect(await db.transactions.count()).toBe(0);
    expect(await db.accounts.count()).toBe(0);
    expect(await db.decisions.count()).toBe(0);
    expect(await db.categories.count()).toBeGreaterThan(10);
  });
});

describe('default rules', () => {
  it('categorise common NZ merchants without false matches', async () => {
    const { defaultRules } = await import('../seed');
    const { categorise, sortRules } = await import('@/engine/categorise');
    const { normaliseMerchant } = await import('@/engine/merchant');
    const rules = sortRules(defaultRules());
    const cat = (d: string, amount = -1000) => categorise({ description: d, merchant: normaliseMerchant(d), amount, accountId: 'a' }, rules, new Map()).categoryId;
    expect(cat('ONE NZ MOBILE')).toBe('cat-utilities');
    expect(cat('MOBIL TE ARO')).toBe('cat-transport');
    expect(cat('Z ENERGY TE ARO')).toBe('cat-transport');
    expect(cat('TRANSFER TO SHARESIES')).toBe('cat-savings');
    expect(cat('TRANSFER TO SAVINGS')).toBe('cat-transfers');
    expect(cat('UBER *EATS')).toBe('cat-eating-out');
    expect(cat('UBER TRIP HELP.UBER.COM')).toBe('cat-transport');
    expect(cat('ACME LTD SALARY', 250000)).toBe('cat-income');
    expect(cat("PAK'NSAVE KILBIRNIE")).toBe('cat-groceries');
  });
});

describe('milestone 2: manual entry, splits, links, schema v2', () => {
  it('adds a manual transaction that later dedupes against an import of the same row', async () => {
    const accountId = await setupAccount();
    const { addManualTransaction, deleteManualTransaction } = await import('../transactions');
    const id = await addManualTransaction({ accountId, date: '2026-03-01', amount: -8420, description: 'EFTPOS COUNTDOWN KELBURN', categoryId: null });
    const t = (await db.transactions.get(id))!;
    expect(t.categoryId).toBe('cat-groceries');
    expect(t.importId).toBeNull();
    const preview = await previewImport(accountId, parseCsvText(CSV).rows, MAPPING);
    expect(preview.counts.duplicate).toBe(1);
    await deleteManualTransaction(id);
    expect(await db.transactions.count()).toBe(0);
    await expect(addManualTransaction({ accountId, date: '2026-02-30', amount: -1, description: 'x', categoryId: null })).rejects.toThrow();
  });

  it('splits a transaction across categories and analytics follow the splits', async () => {
    const accountId = await setupAccount();
    const { addManualTransaction, setTransactionSplits } = await import('../transactions');
    const { toAnalysisLines } = await import('@/engine/splits');
    const id = await addManualTransaction({ accountId, date: '2026-03-01', amount: -10000, description: 'THE WAREHOUSE', categoryId: null });
    await expect(setTransactionSplits(id, [{ id: 'a', amount: -6000, categoryId: 'cat-groceries' }, { id: 'b', amount: -3000, categoryId: 'cat-shopping' }])).rejects.toThrow(/add up/);
    await setTransactionSplits(id, [{ id: 'a', amount: -6000, categoryId: 'cat-groceries' }, { id: 'b', amount: -4000, categoryId: 'cat-shopping' }]);
    const t = (await db.transactions.get(id))!;
    expect(t.categoryId).toBe('cat-groceries');
    expect(t.categorySource).toBe('manual');
    const cats = new Map((await db.categories.toArray()).map((c) => [c.id, c]));
    const s = summarise(toAnalysisLines([t]), cats);
    expect(s.essentialSpending).toBe(6000);
    expect(s.discretionarySpending).toBe(4000);
    await setTransactionSplits(id, null);
    expect((await db.transactions.get(id))!.splits).toBeUndefined();
  });

  it('links transactions to a decision via the decisionId index and unlinks them on delete', async () => {
    const accountId = await setupAccount();
    await commitImport({ accountId, fileName: 'a.csv', mapping: MAPPING, preview: await previewImport(accountId, parseCsvText(CSV).rows, MAPPING) });
    const { linkTransactions } = await import('../transactions');
    const { deleteDecision } = await import('../decisions');
    const { linkedCost } = await import('@/engine/decisionLink');
    const d = blankDecision(defaultAssumptions('2026-11-20'));
    d.title = 'Café habit';
    await saveDecision(d);
    const cafes = await db.transactions.where('merchant').equals('MEMPHIS BELLE CAFE').toArray();
    await linkTransactions(d.id, cafes.map((t) => t.id));
    const linked = await db.transactions.where('decisionId').equals(d.id).toArray();
    expect(linkedCost(linked)).toBe(900);
    await deleteDecision(d.id);
    expect(await db.transactions.where('decisionId').equals(d.id).count()).toBe(0);
    expect(await db.transactions.count()).toBe(6);
  });

  it('restores a version 1 backup (no budgets table) into the current schema', async () => {
    const accountId = await setupAccount();
    await commitImport({ accountId, fileName: 'a.csv', mapping: MAPPING, preview: await previewImport(accountId, parseCsvText(CSV).rows, MAPPING) });
    const v1 = JSON.parse(JSON.stringify(await exportBackup()));
    v1.version = 1;
    delete v1.data.budgets;
    await deleteAllData();
    const report = await restoreBackup(v1);
    expect(report.ok).toBe(true);
    expect(migrateBackup(v1).version).toBe(4);
    expect(await db.transactions.count()).toBe(6);
    expect(await db.budgets.count()).toBe(0);
    expect(db.verno).toBe(4);
  });
});

describe('milestone 3: budgets and scenario/decision conversion', () => {
  it('saves, clears and suggests budgets and includes them in backups', async () => {
    const { saveBudget, applySuggestedBudgets } = await import('../budgets');
    await saveBudget('cat-eating-out', 20000);
    await saveBudget('cat-groceries', 0);
    expect(await db.budgets.count()).toBe(1);
    await saveBudget('cat-eating-out', null);
    expect(await db.budgets.count()).toBe(0);
    await expect(saveBudget('cat-transfers', 1000)).rejects.toThrow(/expense/);
    const n = await applySuggestedBudgets(new Map([['cat-eating-out', 25000], ['cat-groceries', 40000]]), { overwrite: false });
    expect(n).toBe(2);
    await saveBudget('cat-groceries', 1);
    expect(await applySuggestedBudgets(new Map([['cat-groceries', 40000]]), { overwrite: false })).toBe(0);
    expect((await exportBackup()).data.budgets).toHaveLength(2);
  });

  it('creates a decision from a scenario set and a scenario set from a decision', async () => {
    const { decisionFromScenario, scenarioFromDecision } = await import('../decisions');
    const { compareVariants, optionToVariant } = await import('@/engine/projection');
    const base = defaultAssumptions('2026-11-20');
    const set = {
      id: 'scn',
      name: 'Trip vs invest',
      base: { ...base, initialBalance: 500_000 },
      variants: [
        { id: 'v1', name: 'Trip', oneOffs: [{ id: 'o', label: 'Trip', month: 0, amount: -300_000 }], recurring: [], contributionDelta: 0 },
        { id: 'v2', name: 'Invest', oneOffs: [], recurring: [], contributionDelta: 5_000 },
      ],
      monteCarlo: { enabled: true, annualVolatility: 0.1, runs: 1000, seed: 1 },
      createdAt: '',
      updatedAt: '',
    };
    const d = decisionFromScenario(set);
    expect(d.title).toBe('Trip vs invest');
    expect(d.options.map((o) => o.name)).toEqual(['Trip', 'Invest']);
    expect(d.options[0]!.upfrontCost).toBe(300_000);
    expect(d.monteCarlo?.enabled).toBe(true);
    const fromSet = compareVariants(set.base, set.variants).map((c) => c.result.finalNominal);
    const fromDecision = compareVariants(d.assumptions, d.options.map(optionToVariant)).map((c) => c.result.finalNominal);
    expect(fromDecision).toEqual(fromSet);
    const back = scenarioFromDecision(d);
    expect(back.variants).toHaveLength(2);
    expect(compareVariants(back.base, back.variants).map((c) => c.result.finalNominal)).toEqual(fromSet);
    expect(back.id).not.toBe(set.id);
  });
});

describe('review reminders', () => {
  it('counts only decided/completed decisions whose review date has arrived', async () => {
    const { countDueReviews, maybeNotifyDueReviews } = await import('../reminders');
    const mk = (status: 'considering' | 'decided' | 'completed' | 'reviewed', reviewDate: string | null) => ({ ...blankDecision(defaultAssumptions('2026-11-20')), status, reviewDate });
    await Promise.all([mk('decided', '2026-11-01'), mk('completed', '2026-11-20'), mk('decided', '2026-12-01'), mk('reviewed', '2026-10-01'), mk('considering', '2026-10-01'), mk('decided', null)].map(saveDecision));
    expect(await countDueReviews('2026-11-20')).toBe(2);
    // No Notification API in Node: must be a silent no-op.
    await expect(maybeNotifyDueReviews('2026-11-20')).resolves.toBeUndefined();
  });
});

describe('milestone 4: statement balances, overrides, schema v4', () => {
  const BAL_CSV = `Date,Amount,Payee,Balance
05/03/2026,-20.00,SHOP,980.00
04/03/2026,1000.00,PAY,1000.00
03/03/2026,-50.00,FUEL,0.00
`;
  const BAL_MAP: CsvMapping = { ...MAPPING, balanceColumn: 'Balance' };

  it('stores printed balances, sets the account statement balance and recomputes it on undo', async () => {
    const accountId = await setupAccount();
    const p1 = await previewImport(accountId, parseCsvText(BAL_CSV).rows, BAL_MAP);
    expect(p1.closingBalance).toEqual({ amount: 98000, asOf: '2026-03-05' });
    expect(p1.closingBalanceSource).toBe('column');
    expect(p1.balanceGaps).toEqual([]);
    const first = await commitImport({ accountId, fileName: 'mar.csv', mapping: BAL_MAP, preview: p1 });
    expect((await db.accounts.get(accountId))!.statementBalance).toEqual({ amount: 98000, asOf: '2026-03-05', importId: first.id });
    const t = (await db.transactions.toArray()).find((x) => x.description === 'PAY')!;
    expect(t).toMatchObject({ balanceAfter: 100000, rowIndex: 1 });

    const LATER = `Date,Amount,Payee,Balance\n07/03/2026,-30.00,CAFE,950.00\n`;
    const second = await commitImport({ accountId, fileName: 'later.csv', mapping: BAL_MAP, preview: await previewImport(accountId, parseCsvText(LATER).rows, BAL_MAP) });
    expect((await db.accounts.get(accountId))!.statementBalance).toMatchObject({ amount: 95000, asOf: '2026-03-07', importId: second.id });

    // An older statement imported afterwards does not replace the newer balance.
    const OLDER = `Date,Amount,Payee,Balance\n01/03/2026,10.00,INTEREST,50.00\n`;
    await commitImport({ accountId, fileName: 'old.csv', mapping: BAL_MAP, preview: await previewImport(accountId, parseCsvText(OLDER).rows, BAL_MAP) });
    expect((await db.accounts.get(accountId))!.statementBalance!.amount).toBe(95000);

    await undoImport(second.id);
    expect((await db.accounts.get(accountId))!.statementBalance).toEqual({ amount: 98000, asOf: '2026-03-05', importId: first.id });
  });

  it('flags a statement whose running balance does not reconcile', async () => {
    const accountId = await setupAccount();
    const broken = BAL_CSV.replace('04/03/2026,1000.00,PAY,1000.00\n', '');
    const p = await previewImport(accountId, parseCsvText(broken).rows, BAL_MAP);
    expect(p.balanceGaps).toHaveLength(1);
    expect(p.balanceGaps[0]!.difference).toBe(100000);
  });

  it('persists recurring overrides', async () => {
    const { setRecurringOverride, restoreDismissedRecurring } = await import('../recurring');
    await setRecurringOverride('out:SPARK', { label: 'Internet', expectedAmount: 9000 });
    expect(await db.recurringOverrides.get('out:SPARK')).toMatchObject({ status: 'confirmed', label: 'Internet', expectedAmount: 9000 });
    await setRecurringOverride('out:GYM', { status: 'dismissed' });
    await expect(setRecurringOverride('out:X', { expectedAmount: -5 })).rejects.toThrow();
    expect(await restoreDismissedRecurring()).toBe(1);
    await setRecurringOverride('out:SPARK', null);
    expect(await db.recurringOverrides.count()).toBe(0);
  });

  it('migrates the old dismissed-recurring setting when upgrading a v3 database', async () => {
    const Dexie = (await import('dexie')).default;
    const name = `upgrade-${Math.random()}`;
    const old = new Dexie(name);
    old.version(3).stores({ settings: 'key', budgets: 'categoryId', transactions: 'id, accountId, importId, date, categoryId, merchant, fingerprint, decisionId' });
    await old.open();
    await old.table('settings').put({ key: 'dismissedRecurring', value: ['out:A', 'out:B'] });
    old.close();
    const upgraded = new DecisionLabDb(name);
    await upgraded.open();
    expect((await upgraded.recurringOverrides.toArray()).map((o) => `${o.key}:${o.status}`).sort()).toEqual(['out:A:dismissed', 'out:B:dismissed']);
    expect(await upgraded.settings.get('dismissedRecurring')).toBeUndefined();
    upgraded.close();
  });

  it('migrates dismissed-recurring settings in a v3 backup', () => {
    const v3 = { format: 'decisionlab-backup', version: 3, exportedAt: '2026-11-01T00:00:00Z', data: { settings: [{ key: 'dismissedRecurring', value: ['out:A'] }, { key: 'seeded', value: true }] } };
    const b = migrateBackup(v3);
    expect(b.version).toBe(4);
    expect(b.data.recurringOverrides).toEqual([{ key: 'out:A', status: 'dismissed', updatedAt: '2026-11-01T00:00:00Z' }]);
    expect((b.data.settings as { key: string }[]).map((r) => r.key)).toEqual(['seeded']);
  });
});

describe('demo statement balances', () => {
  it('derives known balances from the demo statements, which reconcile exactly', async () => {
    const { balanceGaps } = await import('@/engine/balances');
    await loadDemoData('2026-11-20');
    const accounts = await db.accounts.toArray();
    expect(accounts.every((a) => a.statementBalance && !a.balance)).toBe(true);
    for (const a of accounts) {
      const txns = await db.transactions.where('accountId').equals(a.id).toArray();
      expect(balanceGaps(txns)).toEqual([]);
      const opening = a.name.includes('Savings') ? 400_000 : 120_000;
      expect(a.statementBalance!.amount).toBe(opening + txns.reduce((s, t) => s + t.amount, 0));
    }
  });
});

describe('summary balances (e.g. Heartland exports)', () => {
  const FILE = ['Generated at 9:05 am Mon 2 Mar 2026', '', 'Some Bank', 'Everyday Saver', '00-0000-0000000-000', '$1,234.56 balance with $1,234.56 available as at Mon 2 Mar 2026', '', 'Date,Transaction Code,Transaction Reference,Amount', '', '01/03/2026,PRC,Credit Interest,$2.60', '01/02/2026,ICT,Opening deposit,$1231.96'].join('\r\n');
  const MAP: CsvMapping = { dateColumn: 'Date', dateFormat: 'DD/MM/YYYY', amountMode: 'signed', amountColumn: 'Amount', descriptionColumns: ['Transaction Reference'], referenceColumn: 'Transaction Code' };

  it('uses the stated balance as a known balance, reports a complete history, and clears it on undo', async () => {
    const accountId = await setupAccount();
    const parsed = parseCsvText(FILE);
    const p = await previewImport(accountId, parsed.rows, MAP, parsed.preamble.statementBalance);
    expect(p.closingBalance).toEqual({ amount: 123456, asOf: '2026-03-02' });
    expect(p.closingBalanceSource).toBe('summary');
    expect(p.impliedOpening).toEqual({ amount: 0, before: '2026-02-01' });
    const batch = await commitImport({ accountId, fileName: 'h.csv', mapping: MAP, preview: p });
    expect((await db.imports.get(batch.id))!.statementBalance).toEqual({ amount: 123456, asOf: '2026-03-02' });
    expect((await db.accounts.get(accountId))!.statementBalance).toEqual({ amount: 123456, asOf: '2026-03-02', importId: batch.id });
    await undoImport(batch.id);
    expect((await db.accounts.get(accountId))!.statementBalance).toBeUndefined();
  });

  it('ignores a stated balance older than the file’s transactions', async () => {
    const accountId = await setupAccount();
    const parsed = parseCsvText(FILE);
    const p = await previewImport(accountId, parsed.rows, MAP, { amount: 1, asOf: '2026-02-15' });
    expect(p.closingBalance).toBeNull();
  });
});
