/** Monthly category budgets (manual planning values). */
import { db } from './db';
import { nowTimestamp } from '@/domain/ids';
import type { Cents } from '@/domain/money';

/** Set a category's monthly budget; null or 0 removes it. Only expense categories can be budgeted. */
export async function saveBudget(categoryId: string, monthlyAmount: Cents | null): Promise<void> {
  if (monthlyAmount === null || monthlyAmount === 0) {
    await db.budgets.delete(categoryId);
    return;
  }
  if (!Number.isSafeInteger(monthlyAmount) || monthlyAmount < 0) throw new Error('Budgets must be a positive amount.');
  const cat = await db.categories.get(categoryId);
  if (cat?.kind !== 'expense') throw new Error('Only expense categories can have a budget.');
  await db.budgets.put({ categoryId, monthlyAmount, updatedAt: nowTimestamp() });
}

/** Apply suggested budgets; by default only to categories without a budget. Returns the number set. */
export async function applySuggestedBudgets(suggestions: Map<string, Cents>, opts: { overwrite: boolean }): Promise<number> {
  return db.transaction('rw', db.budgets, db.categories, async () => {
    let n = 0;
    for (const [categoryId, amount] of suggestions) {
      if (amount <= 0) continue;
      if (!opts.overwrite && (await db.budgets.get(categoryId))) continue;
      const cat = await db.categories.get(categoryId);
      if (cat?.kind !== 'expense') continue;
      await db.budgets.put({ categoryId, monthlyAmount: amount, updatedAt: nowTimestamp() });
      n++;
    }
    return n;
  });
}
