/** Transaction, category, rule and account mutations. */
import { db } from './db';
import { memoryMap, recategoriseAll } from '@/engine/categorise';
import type { Account, Category, CategoryRule, Transaction } from '@/domain/types';
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

export type { Transaction };
