/** Transaction, category, rule and account mutations. */
import { db } from './db';
import { categorise, memoryMap, recategoriseAll, sortRules } from '@/engine/categorise';
import { normaliseMerchant } from '@/engine/merchant';
import { baseKey } from '@/engine/dedupe';
import { dominantSplitCategory, validateSplits } from '@/engine/splits';
import { isIsoDate } from '@/domain/dates';
import type { Account, Category, CategoryRule, Transaction, TransactionSplit } from '@/domain/types';
import { newId, nowTimestamp } from '@/domain/ids';

/**
 * Set a transaction's category manually. When `remember` is true, the choice is stored as
 * merchant memory and applied to other non-manual transactions from the same merchant.
 * Returns the number of other transactions updated.
 */
export async function setTransactionCategory(txnId: string, categoryId: string | null, remember: boolean): Promise<number> {
  return db.transaction('rw', db.transactions, db.merchantMemory, db.rules, async () => {
    const txn = await db.transactions.get(txnId);
    if (!txn) throw new Error('Transaction not found');
    const now = nowTimestamp();
    await db.transactions.update(txnId, {
      categoryId,
      categorySource: categoryId ? 'manual' : 'none',
      ruleId: undefined,
      updatedAt: now,
    });
    if (!remember || !categoryId) return 0;
    await db.merchantMemory.put({ merchant: txn.merchant, categoryId, updatedAt: now });
    const same = await db.transactions.where('merchant').equals(txn.merchant).toArray();
    const toUpdate = same.filter((t) => t.id !== txnId && t.categorySource !== 'manual' && t.categoryId !== categoryId);
    await Promise.all(
      toUpdate.map((t) => db.transactions.update(t.id, { categoryId, categorySource: 'memory', ruleId: undefined, updatedAt: now })),
    );
    return toUpdate.length;
  });
}

export async function updateTransactionNotes(txnId: string, notes: string): Promise<void> {
  await db.transactions.update(txnId, { notes, updatedAt: nowTimestamp() });
}

/** Re-apply memory and rules to all non-manual transactions. Returns number changed. */
export async function reapplyCategorisation(): Promise<number> {
  return db.transaction('rw', db.transactions, db.rules, db.merchantMemory, async () => {
    const [txns, rules, memory] = await Promise.all([db.transactions.toArray(), db.rules.toArray(), db.merchantMemory.toArray()]);
    const changes = recategoriseAll(txns, rules, memoryMap(memory));
    const now = nowTimestamp();
    await Promise.all(
      changes.map((c) =>
        db.transactions.update(c.id, {
          categoryId: c.result.categoryId,
          categorySource: c.result.categorySource,
          ruleId: c.result.ruleId,
          updatedAt: now,
        }),
      ),
    );
    return changes.length;
  });
}

// ── Rules ──

export async function saveRule(rule: Omit<CategoryRule, 'id' | 'createdAt' | 'priority'> & Partial<CategoryRule>): Promise<string> {
  const existing = rule.id ? await db.rules.get(rule.id) : undefined;
  const maxPriority = (await db.rules.orderBy('priority').last())?.priority ?? 0;
  const record: CategoryRule = {
    ...rule,
    id: rule.id ?? newId('rule'),
    createdAt: existing?.createdAt ?? nowTimestamp(),
    priority: rule.priority ?? existing?.priority ?? maxPriority + 10,
  } as CategoryRule;
  await db.rules.put(record);
  return record.id;
}

export async function deleteRule(id: string): Promise<void> {
  await db.rules.delete(id);
}

/** Move a rule up or down one place in the evaluation order. */
export async function moveRule(id: string, direction: -1 | 1): Promise<void> {
  await db.transaction('rw', db.rules, async () => {
    const rules = await db.rules.orderBy('priority').toArray();
    const idx = rules.findIndex((r) => r.id === id);
    const swapWith = idx + direction;
    if (idx < 0 || swapWith < 0 || swapWith >= rules.length) return;
    [rules[idx], rules[swapWith]] = [rules[swapWith]!, rules[idx]!];
    // Renumber so priorities stay unique and evenly spaced.
    await Promise.all(rules.map((r, i) => db.rules.update(r.id, { priority: (i + 1) * 10 })));
  });
}

// ── Categories ──

export async function saveCategory(cat: Omit<Category, 'id' | 'sortOrder'> & Partial<Category>): Promise<string> {
  const maxSort = (await db.categories.orderBy('sortOrder').last())?.sortOrder ?? 0;
  const record: Category = { ...cat, id: cat.id ?? newId('cat'), sortOrder: cat.sortOrder ?? maxSort + 10 } as Category;
  await db.categories.put(record);
  return record.id;
}

/** Categories in use are archived (hidden from pickers) rather than deleted, to keep history intact. */
export async function removeCategory(id: string): Promise<'deleted' | 'archived'> {
  return db.transaction('rw', db.categories, db.transactions, db.rules, async () => {
    const used = (await db.transactions.where('categoryId').equals(id).count()) > 0;
    const inRules = (await db.rules.filter((r) => r.categoryId === id).count()) > 0;
    if (used || inRules) {
      await db.categories.update(id, { archived: true });
      return 'archived';
    }
    await db.categories.delete(id);
    return 'deleted';
  });
}

// ── Accounts ──

export async function saveAccount(account: Omit<Account, 'id' | 'createdAt' | 'currency'> & Partial<Account>): Promise<string> {
  const record: Account = {
    ...account,
    id: account.id ?? newId('acc'),
    currency: 'NZD',
    createdAt: account.createdAt ?? nowTimestamp(),
  } as Account;
  await db.accounts.put(record);
  return record.id;
}

/** Delete an account and all of its transactions and import history. */
export async function deleteAccount(id: string): Promise<void> {
  await db.transaction('rw', db.accounts, db.transactions, db.imports, async () => {
    await db.transactions.where('accountId').equals(id).delete();
    await db.imports.where('accountId').equals(id).delete();
    await db.accounts.delete(id);
  });
}


// ── Manual entry, splits and decision links ──

/**
 * Add a transaction by hand (e.g. a cash purchase). It goes through the same categorisation
 * as imports unless a category is given. Its fingerprint uses the same base key as imports, so
 * importing a statement that contains the same transaction later flags it as a duplicate.
 */
export async function addManualTransaction(input: {
  accountId: string;
  date: string;
  amount: number;
  description: string;
  categoryId: string | null;
  notes?: string;
}): Promise<string> {
  if (!Number.isSafeInteger(input.amount) || input.amount === 0) throw new Error('Enter a non-zero amount.');
  if (!isIsoDate(input.date)) throw new Error('Enter a valid date.');
  if (!input.description.trim()) throw new Error('Enter a description.');
  return db.transaction('rw', db.transactions, db.rules, db.merchantMemory, async () => {
    const merchant = normaliseMerchant(input.description);
    const id = newId('txn');
    const now = nowTimestamp();
    let categoryId = input.categoryId;
    let categorySource: Transaction['categorySource'] = input.categoryId ? 'manual' : 'none';
    let ruleId: string | undefined;
    if (!categoryId) {
      const [rules, memory] = await Promise.all([db.rules.toArray(), db.merchantMemory.toArray()]);
      const result = categorise({ description: input.description, merchant, amount: input.amount, accountId: input.accountId }, sortRules(rules), memoryMap(memory));
      categoryId = result.categoryId;
      categorySource = result.categorySource;
      ruleId = result.ruleId;
    }
    await db.transactions.add({
      id,
      accountId: input.accountId,
      importId: null,
      date: input.date,
      amount: input.amount,
      description: input.description.trim(),
      merchant,
      categoryId,
      categorySource,
      ruleId,
      notes: input.notes,
      fingerprint: `${baseKey(input.accountId, input.date, input.amount, input.description.trim())}|m-${id}`,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  });
}

/** Only manually entered transactions can be deleted individually; imported ones are removed by undoing the import. */
export async function deleteManualTransaction(id: string): Promise<void> {
  const t = await db.transactions.get(id);
  if (!t) return;
  if (t.importId !== null) throw new Error('Imported transactions are removed by undoing their import.');
  await db.transactions.delete(id);
}

/** Set (or clear, with null) a transaction's split. Parts must sum exactly to the amount. */
export async function setTransactionSplits(id: string, splits: TransactionSplit[] | null): Promise<void> {
  const t = await db.transactions.get(id);
  if (!t) throw new Error('Transaction not found');
  if (splits === null) {
    await db.transactions.update(id, { splits: undefined, updatedAt: nowTimestamp() });
    return;
  }
  const errors = validateSplits(t.amount, splits);
  if (errors.length) throw new Error(errors.join(' '));
  await db.transactions.update(id, {
    splits,
    categoryId: dominantSplitCategory(splits),
    categorySource: 'manual',
    ruleId: undefined,
    updatedAt: nowTimestamp(),
  });
}

/** Link transactions to a decision (replacing any previous link of those transactions). */
export async function linkTransactions(decisionId: string, txnIds: string[]): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    const now = nowTimestamp();
    await Promise.all(txnIds.map((id) => db.transactions.update(id, { decisionId, updatedAt: now })));
  });
}

export async function unlinkTransactions(txnIds: string[]): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    const now = nowTimestamp();
    await Promise.all(txnIds.map((id) => db.transactions.update(id, { decisionId: undefined, updatedAt: now })));
  });
}

// ── Transfer pair review ──

/** Mark pairs (outflow id, inflow id) as transfers between your own accounts. */
export async function confirmTransferPairs(pairs: [string, string][]): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    const now = nowTimestamp();
    for (const [o, i] of pairs) {
      for (const id of [o, i]) await db.transactions.update(id, { categoryId: 'cat-transfers', categorySource: 'manual', ruleId: undefined, updatedAt: now });
    }
  });
}

/** Remember that these pairs are not transfers, so they are not suggested again. */
export async function rejectTransferPairs(keys: string[]): Promise<void> {
  const rec = await db.settings.get('rejectedTransferPairs');
  const existing = new Set((rec?.value as string[] | undefined) ?? []);
  for (const k of keys) existing.add(k);
  await db.settings.put({ key: 'rejectedTransferPairs', value: [...existing] });
}
