/**
 * Backup and restore.
 *
 * Plain backups are JSON files containing every table. Encrypted backups wrap the same JSON
 * with AES-256-GCM using a key derived from a passphrase via PBKDF2-SHA-256 (600,000
 * iterations, random 16-byte salt, random 12-byte IV). GCM authenticates the ciphertext, so
 * a wrong passphrase or tampered file fails to decrypt instead of producing garbage.
 *
 * Restores are validated with zod before anything is written, and are applied in a single
 * IndexedDB transaction (all-or-nothing).
 */
import { z } from 'zod';
import { db, TABLE_NAMES, type TableName } from './db';
import { isIsoDate } from '@/domain/dates';

export const BACKUP_FORMAT = 'decisionlab-backup';
export const ENCRYPTED_FORMAT = 'decisionlab-encrypted-backup';
export const BACKUP_VERSION = 3;
export const PBKDF2_ITERATIONS = 600_000;

const isoDate = z.string().refine(isIsoDate, 'Invalid date');
const cents = z.number().int();
const id = z.string().min(1);

const schemas: Record<TableName, z.ZodType> = {
  accounts: z.looseObject({ id, name: z.string(), type: z.string(), includeInLiquid: z.boolean() }),
  categories: z.looseObject({
    id,
    name: z.string(),
    kind: z.enum(['income', 'expense', 'transfer', 'savings']),
    essential: z.boolean(),
    sortOrder: z.number(),
  }),
  transactions: z.looseObject({
    id,
    accountId: id,
    importId: z.string().nullable(),
    date: isoDate,
    amount: cents,
    description: z.string(),
    merchant: z.string(),
    categoryId: z.string().nullable(),
    categorySource: z.enum(['rule', 'memory', 'manual', 'none']),
    fingerprint: z.string(),
    decisionId: z.string().optional(),
    splits: z.array(z.looseObject({ id, amount: cents, categoryId: z.string().nullable() })).optional(),
  }),
  rules: z.looseObject({
    id,
    pattern: z.string(),
    field: z.enum(['description', 'merchant']),
    operator: z.enum(['contains', 'startsWith', 'equals', 'regex']),
    categoryId: id,
    enabled: z.boolean(),
    priority: z.number(),
  }),
  merchantMemory: z.looseObject({ merchant: z.string(), categoryId: id }),
  imports: z.looseObject({ id, accountId: id, fileName: z.string(), status: z.enum(['active', 'undone']) }),
  importProfiles: z.looseObject({ id, name: z.string() }),
  goals: z.looseObject({ id, name: z.string(), targetAmount: cents, currentAmount: cents, earmarked: z.boolean() }),
  decisions: z.looseObject({
    id,
    title: z.string(),
    status: z.enum(['considering', 'decided', 'completed', 'reviewed']),
    options: z.array(z.looseObject({ id, name: z.string(), upfrontCost: cents, monthlyCost: cents })),
    criteria: z.array(z.looseObject({ id, name: z.string(), weight: z.number() })),
    assumptions: z.looseObject({ horizonMonths: z.number().int(), annualReturn: z.number() }),
  }),
  scenarioSets: z.looseObject({ id, name: z.string(), base: z.looseObject({}), variants: z.array(z.looseObject({ id })) }),
  settings: z.looseObject({ key: z.string() }),
  budgets: z.looseObject({ categoryId: id, monthlyAmount: cents }),
};

const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.number().int().min(1),
  exportedAt: z.string(),
  data: z.record(z.string(), z.array(z.unknown())),
});

export type BackupFile = z.infer<typeof backupSchema>;

export async function exportBackup(): Promise<BackupFile> {
  const data: Record<string, unknown[]> = {};
  for (const name of TABLE_NAMES) data[name] = await db.table(name).toArray();
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data };
}

/**
 * Upgrade older backup versions to the current shape, one step at a time.
 * - v1 → v2: transactions gained optional `decisionId` and `splits`; decisions and scenario
 *   sets gained optional `monteCarlo`. All optional, so no data changes are needed.
 * - v2 → v3: new `budgets` table (empty for older backups); optional `pairwise`,
 *   `extraFlows`, `goalId` and goal `accountId` fields.
 */
export function migrateBackup(raw: unknown): BackupFile {
  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success) throw new Error('This file is not a DecisionLab backup.');
  const backup = parsed.data;
  if (backup.version > BACKUP_VERSION) {
    throw new Error(`Backup version ${backup.version} is newer than this app supports (${BACKUP_VERSION}). Update DecisionLab first.`);
  }
  if (backup.version === 1) backup.version = 2;
  if (backup.version === 2) backup.version = 3;
  for (const name of TABLE_NAMES) backup.data[name] ??= [];
  return backup;
}

export interface ValidationReport {
  ok: boolean;
  counts: Record<string, number>;
  errors: string[];
}

export function validateBackup(backup: BackupFile): ValidationReport {
  const errors: string[] = [];
  const counts: Record<string, number> = {};
  for (const name of TABLE_NAMES) {
    const rows = backup.data[name] ?? [];
    counts[name] = rows.length;
    rows.forEach((row, i) => {
      const r = schemas[name].safeParse(row);
      if (!r.success && errors.length < 20) {
        errors.push(`${name}[${i}]: ${r.error.issues.map((iss) => `${iss.path.join('.')} ${iss.message}`).join('; ')}`);
      }
    });
  }
  const unknownTables = Object.keys(backup.data).filter((k) => !(TABLE_NAMES as readonly string[]).includes(k));
  if (unknownTables.length) errors.push(`Unknown tables: ${unknownTables.join(', ')}`);
  return { ok: errors.length === 0, counts, errors };
}

/** Replace all data with the backup contents (after validation). */
export async function restoreBackup(raw: unknown): Promise<ValidationReport> {
  const backup = migrateBackup(raw);
  const report = validateBackup(backup);
  if (!report.ok) return report;
  await db.transaction('rw', TABLE_NAMES.map((n) => db.table(n)), async () => {
    for (const name of TABLE_NAMES) {
      await db.table(name).clear();
      await db.table(name).bulkAdd(backup.data[name] ?? []);
    }
  });
  return report;
}

// ───────────────────────── Encryption ─────────────────────────

const encryptedSchema = z.object({
  format: z.literal(ENCRYPTED_FORMAT),
  version: z.literal(1),
  kdf: z.object({ name: z.literal('PBKDF2'), hash: z.literal('SHA-256'), iterations: z.number().int().min(100_000), salt: z.string() }),
  cipher: z.object({ name: z.literal('AES-GCM'), iv: z.string() }),
  ciphertext: z.string(),
});
export type EncryptedBackup = z.infer<typeof encryptedSchema>;

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export const MIN_PASSPHRASE_LENGTH = 10;

export async function encryptJson(value: unknown, passphrase: string, iterations = PBKDF2_ITERATIONS): Promise<EncryptedBackup> {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) throw new Error(`Use a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters.`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  return {
    format: ENCRYPTED_FORMAT,
    version: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    ciphertext: toBase64(ciphertext),
  };
}

export async function decryptJson(raw: unknown, passphrase: string): Promise<unknown> {
  const parsed = encryptedSchema.safeParse(raw);
  if (!parsed.success) throw new Error('This file is not a DecisionLab encrypted backup.');
  const env = parsed.data;
  const key = await deriveKey(passphrase, fromBase64(env.kdf.salt), env.kdf.iterations);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(env.cipher.iv) }, key, fromBase64(env.ciphertext));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new Error('Could not decrypt: wrong passphrase or damaged file.');
  }
}

export function isEncryptedBackup(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && (raw as { format?: unknown }).format === ENCRYPTED_FORMAT;
}

// ───────────────────────── Deletion ─────────────────────────

/** Permanently delete all data in this browser. */
export async function deleteAllData(): Promise<void> {
  await db.transaction('rw', TABLE_NAMES.map((n) => db.table(n)), async () => {
    for (const name of TABLE_NAMES) await db.table(name).clear();
  });
}

/** Remove only demonstration data (accounts, their transactions/imports, demo decisions). */
export async function removeDemoData(): Promise<void> {
  await db.transaction('rw', [db.accounts, db.transactions, db.imports, db.decisions, db.scenarioSets, db.settings], async () => {
    const demoAccounts = await db.accounts.filter((a) => a.isDemo === true).toArray();
    for (const a of demoAccounts) {
      await db.transactions.where('accountId').equals(a.id).delete();
      await db.imports.where('accountId').equals(a.id).delete();
      await db.accounts.delete(a.id);
    }
    await db.decisions.filter((d) => d.isDemo === true).delete();
    await db.settings.delete('demoProfileApplied');
  });
}
