/**
 * Duplicate detection for repeated or overlapping statement imports.
 *
 * Identical rows can legitimately occur (two $4.50 coffees on the same day), so a row's
 * fingerprint includes its occurrence index among identical rows in the same file. An
 * incoming row is a duplicate when the account already holds at least that many
 * transactions with the same base key. Re-importing an overlapping statement therefore
 * adds only genuinely new rows, while two real identical purchases are both kept.
 */
import type { Cents } from '@/domain/money';
import type { IsoDate } from '@/domain/dates';

export function baseKey(accountId: string, date: IsoDate, amount: Cents, description: string): string {
  const desc = description.toUpperCase().replace(/\s+/g, ' ').trim();
  return `${accountId}|${date}|${amount}|${desc}`;
}

export interface DedupeCandidate {
  date: IsoDate;
  amount: Cents;
  description: string;
}

export interface DedupeResult<T> {
  item: T;
  fingerprint: string;
  duplicate: boolean;
}

/**
 * @param existingBaseKeyCounts count of existing transactions per base key for this account
 */
export function classifyDuplicates<T extends DedupeCandidate>(
  accountId: string,
  incoming: T[],
  existingBaseKeyCounts: Map<string, number>,
): DedupeResult<T>[] {
  const seen = new Map<string, number>();
  return incoming.map((item) => {
    const key = baseKey(accountId, item.date, item.amount, item.description);
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    const existing = existingBaseKeyCounts.get(key) ?? 0;
    return { item, fingerprint: `${key}|${occurrence}`, duplicate: occurrence <= existing };
  });
}

/** Base key of a stored fingerprint (strips the occurrence index). */
export function fingerprintBase(fingerprint: string): string {
  const idx = fingerprint.lastIndexOf('|');
  return idx >= 0 ? fingerprint.slice(0, idx) : fingerprint;
}

export function countBaseKeys(fingerprints: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of fingerprints) {
    const k = fingerprintBase(f);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}
