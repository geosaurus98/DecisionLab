/**
 * IndexedDB persistence via Dexie. All personal data stays in this browser profile.
 *
 * Security note: IndexedDB is NOT encrypted by the app. Anyone with access to this
 * browser profile (or the device's disk) can read it. Use encrypted backups for copies
 * that leave the device. See docs/PRIVACY.md.
 *
 * Schema changes: add a new `this.version(n)` block (never edit an old one) and, if
 * shapes change, an `.upgrade()` migration plus a matching backup migration in backup.ts.
 */
import Dexie, { type Table } from 'dexie';
import type {
  Account,
  AppSettingRecord,
  Budget,
  Category,
  CategoryRule,
  Decision,
  Goal,
  ImportBatch,
  ImportProfile,
  RecurringOverride,
  MerchantMemory,
  ScenarioSet,
  Transaction,
} from '@/domain/types';

export const DB_NAME = 'decisionlab';
export const SCHEMA_VERSION = 4;

export class DecisionLabDb extends Dexie {
  accounts!: Table<Account, string>;
  categories!: Table<Category, string>;
  transactions!: Table<Transaction, string>;
  rules!: Table<CategoryRule, string>;
  merchantMemory!: Table<MerchantMemory, string>;
  imports!: Table<ImportBatch, string>;
  importProfiles!: Table<ImportProfile, string>;
  goals!: Table<Goal, string>;
  decisions!: Table<Decision, string>;
  scenarioSets!: Table<ScenarioSet, string>;
  settings!: Table<AppSettingRecord, string>;
  budgets!: Table<Budget, string>;
  recurringOverrides!: Table<RecurringOverride, string>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      accounts: 'id',
      categories: 'id, sortOrder',
      transactions: 'id, accountId, importId, date, categoryId, merchant, fingerprint',
      rules: 'id, priority',
      merchantMemory: 'merchant',
      imports: 'id, accountId, importedAt',
      importProfiles: 'id',
      goals: 'id',
      decisions: 'id, status, date, reviewDate, updatedAt',
      scenarioSets: 'id, updatedAt',
      settings: 'key',
    });
    // v2: transactions can be linked to a decision (decisionId) and split across categories
    // (splits). Both fields are optional, so existing records need no data migration.
    this.version(2).stores({
      transactions: 'id, accountId, importId, date, categoryId, merchant, fingerprint, decisionId',
    });
    // v3: monthly budgets per expense category.
    this.version(3).stores({ budgets: 'categoryId' });
    // v4: user edits to detected recurring series. The old "dismissed" list kept in settings
    // is migrated into the new table.
    this.version(4)
      .stores({ recurringOverrides: 'key' })
      .upgrade(async (tx) => {
        const rec = await tx.table('settings').get('dismissedRecurring');
        const keys = (rec?.value as string[] | undefined) ?? [];
        const now = new Date().toISOString();
        await tx.table('recurringOverrides').bulkPut(keys.map((key) => ({ key, status: 'dismissed', updatedAt: now })));
        await tx.table('settings').delete('dismissedRecurring');
      });
  }
}

export const TABLE_NAMES = [
  'accounts',
  'categories',
  'transactions',
  'rules',
  'merchantMemory',
  'imports',
  'importProfiles',
  'goals',
  'decisions',
  'scenarioSets',
  'settings',
  'budgets',
  'recurringOverrides',
] as const;
export type TableName = (typeof TABLE_NAMES)[number];

export let db = new DecisionLabDb();

/** Tests use isolated databases. */
export function useDatabase(instance: DecisionLabDb): void {
  db = instance;
}
