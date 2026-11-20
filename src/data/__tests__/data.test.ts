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
