/**
 * Import pipeline: preview (pure, nothing written) → commit (single transaction) → undo.
 */
import { db } from './db';
import { mapRows, type MappedRow } from '@/engine/csv';
import { classifyDuplicates, countBaseKeys } from '@/engine/dedupe';
import { categorise, memoryMap, sortRules, type CategorisationResult } from '@/engine/categorise';
import { normaliseMerchant } from '@/engine/merchant';
import type { CsvMapping, ImportBatch, Transaction } from '@/domain/types';
import { balanceGaps, closingBalance, type BalanceGap, type BalanceRow } from '@/engine/balances';
import { newId, nowTimestamp } from '@/domain/ids';

export type PreviewStatus = 'new' | 'duplicate' | 'error';

export interface PreviewRow extends MappedRow {
  status: PreviewStatus;
  fingerprint?: string;
  merchant: string;
  categorisation?: CategorisationResult;
}

export interface ImportPreview {
  rows: PreviewRow[];
  counts: Record<PreviewStatus, number>;
  dateRange?: { start: string; end: string };
  netTotal: number;
  /** Closing balance printed in this file (when a balance column is mapped). */
  closingBalance?: { amount: number; asOf: string } | null;
  /** Places where the file's own running balance does not reconcile with its amounts. */
  balanceGaps: BalanceGap[];
}

export async function previewImport(accountId: string, rows: Record<string, string>[], mapping: CsvMapping): Promise<ImportPreview> {
  const mapped = mapRows(rows, mapping);
  const [existing, rules, memory] = await Promise.all([
    db.transactions.where('accountId').equals(accountId).toArray(),
    db.rules.toArray(),
    db.merchantMemory.toArray(),
  ]);
  const sorted = sortRules(rules);
  const mem = memoryMap(memory);
  const valid = mapped.filter((r) => r.errors.length === 0) as (MappedRow & { date: string; amount: number })[];
  const dedupe = classifyDuplicates(accountId, valid, countBaseKeys(existing.map((t) => t.fingerprint)));
  const byRow = new Map(dedupe.map((d) => [d.item.rowNumber, d]));

  const out: PreviewRow[] = mapped.map((r) => {
    const merchant = normaliseMerchant(r.description || '');
    if (r.errors.length > 0) return { ...r, status: 'error', merchant };
    const d = byRow.get(r.rowNumber)!;
    const categorisation = categorise({ description: r.description, merchant, amount: r.amount!, accountId }, sorted, mem);
    return { ...r, status: d.duplicate ? 'duplicate' : 'new', fingerprint: d.fingerprint, merchant, categorisation };
  });
  const counts = { new: 0, duplicate: 0, error: 0 };
  for (const r of out) counts[r.status]++;
  const dates = out.filter((r) => r.status === 'new').map((r) => r.date!).sort();
  const fileRows: BalanceRow[] = out
    .filter((r) => r.status !== 'error')
    .map((r) => ({ id: String(r.rowNumber), date: r.date!, amount: r.amount!, balanceAfter: r.balance ?? null, rowIndex: r.rowNumber - 1, importId: 'file' }));
  const hasBalances = fileRows.some((r) => r.balanceAfter != null);
  return {
    closingBalance: hasBalances ? closingBalance(fileRows) : null,
    balanceGaps: hasBalances ? balanceGaps(fileRows) : [],
    rows: out,
    counts,
    dateRange: dates.length ? { start: dates[0]!, end: dates.at(-1)! } : undefined,
    netTotal: out.filter((r) => r.status === 'new').reduce((a, r) => a + r.amount!, 0),
  };
}

export async function commitImport(args: {
  accountId: string;
  fileName: string;
  mapping: CsvMapping;
  preview: ImportPreview;
  isDemo?: boolean;
}): Promise<ImportBatch> {
  const { accountId, fileName, mapping, preview } = args;
  const now = nowTimestamp();
  const batch: ImportBatch = {
    id: newId('imp'),
    accountId,
    fileName,
    importedAt: now,
    mapping,
    totalRows: preview.rows.length,
    importedCount: preview.counts.new,
    duplicateCount: preview.counts.duplicate,
    errorCount: preview.counts.error,
    dateRange: preview.dateRange,
    status: 'active',
    isDemo: args.isDemo,
  };
  const txns: Transaction[] = preview.rows
    .filter((r) => r.status === 'new')
    .map((r) => ({
      id: newId('txn'),
      accountId,
      importId: batch.id,
      date: r.date!,
      amount: r.amount!,
      description: r.description,
      merchant: r.merchant,
      reference: r.reference,
      categoryId: r.categorisation?.categoryId ?? null,
      categorySource: r.categorisation?.categorySource ?? 'none',
      ruleId: r.categorisation?.ruleId,
      fingerprint: r.fingerprint!,
      original: r.original,
      balanceAfter: r.balance ?? undefined,
      rowIndex: r.rowNumber - 1,
      createdAt: now,
      updatedAt: now,
    }));
  await db.transaction('rw', db.imports, db.transactions, db.accounts, async () => {
    // A statement's closing balance becomes the account's known balance if it is the newest.
    const closing = preview.closingBalance;
    if (closing) {
      const account = await db.accounts.get(accountId);
      if (account && (!account.statementBalance || closing.asOf >= account.statementBalance.asOf)) {
        await db.accounts.update(accountId, { statementBalance: { amount: closing.amount, asOf: closing.asOf, importId: batch.id } });
      }
    }
    // Re-check duplicates inside the write transaction in case another import ran meanwhile.
    const existing = new Set((await db.transactions.where('accountId').equals(accountId).toArray()).map((t) => t.fingerprint));
    const fresh = txns.filter((t) => !existing.has(t.fingerprint));
    batch.importedCount = fresh.length;
    batch.duplicateCount += txns.length - fresh.length;
    await db.imports.add(batch);
    await db.transactions.bulkAdd(fresh);
  });
  return batch;
}

/** Remove every transaction created by an import. The batch record is kept (status 'undone') for history. */
export async function undoImport(importId: string): Promise<number> {
  return db.transaction('rw', db.imports, db.transactions, db.accounts, async () => {
    const batch = await db.imports.get(importId);
    if (!batch || batch.status === 'undone') return 0;
    const removed = await db.transactions.where('importId').equals(importId).delete();
    await db.imports.update(importId, { status: 'undone', undoneAt: nowTimestamp() });
    // If this import supplied the account's statement balance, recompute it from what remains.
    const account = await db.accounts.get(batch.accountId);
    if (account?.statementBalance?.importId === importId) {
      const remaining = await db.transactions.where('accountId').equals(batch.accountId).toArray();
      const closing = closingBalance(remaining);
      const source = closing ? remaining.find((t) => t.id === closing.rowId) : undefined;
      await db.accounts.update(batch.accountId, {
        statementBalance: closing && source?.importId ? { amount: closing.amount, asOf: closing.asOf, importId: source.importId } : undefined,
      });
    }
    return removed;
  });
}
