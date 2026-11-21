/** Persistence for user edits to detected recurring series. */
import { db } from './db';
import { nowTimestamp } from '@/domain/ids';
import type { RecurringOverride } from '@/domain/types';

/** Create or update an override; pass null to remove it (back to detection only). */
export async function setRecurringOverride(key: string, patch: Partial<Omit<RecurringOverride, 'key' | 'updatedAt'>> | null): Promise<void> {
  if (patch === null) {
    await db.recurringOverrides.delete(key);
    return;
  }
  const existing = await db.recurringOverrides.get(key);
  if (patch.expectedAmount !== undefined && (!Number.isSafeInteger(patch.expectedAmount) || patch.expectedAmount <= 0)) {
    throw new Error('Expected amount must be a positive amount.');
  }
  await db.recurringOverrides.put({ status: 'confirmed', ...existing, ...patch, key, updatedAt: nowTimestamp() });
}

export async function restoreDismissedRecurring(): Promise<number> {
  return db.recurringOverrides.filter((o) => o.status === 'dismissed').delete();
}
