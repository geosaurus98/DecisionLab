import { db } from './db';
import { DEFAULT_CATEGORIES, defaultRules } from './seed';
import { SETTING_KEYS } from './settings';

/** Seed default categories and rules on first run. Idempotent. */
export async function ensureSeeded(): Promise<void> {
  await db.transaction('rw', db.categories, db.rules, db.settings, async () => {
    const seeded = await db.settings.get(SETTING_KEYS.seeded);
    if (seeded) return;
    if ((await db.categories.count()) === 0) await db.categories.bulkAdd(DEFAULT_CATEGORIES);
    if ((await db.rules.count()) === 0) await db.rules.bulkAdd(defaultRules());
    await db.settings.put({ key: SETTING_KEYS.seeded, value: true });
  });
}
