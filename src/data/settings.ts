/** Typed access to key–value settings stored in IndexedDB. */
import { db } from './db';
import type { FinancialProfile, ProjectionAssumptions } from '@/domain/types';
import { addMonths, monthKey, todayIso } from '@/domain/dates';

export const DEFAULT_PROFILE: FinancialProfile = {
  emergencyReserveTarget: 0,
  monthlySavingsCommitment: 0,
  monthlyIncomeOverride: null,
  monthlyObligationsOverride: null,
  lookbackMonths: 6,
  upcomingExpenses: [],
  upcomingHorizonDays: 90,
};

/**
 * Default projection assumptions. These are illustrative placeholders, not forecasts:
 * a 6% nominal return roughly matches long-run diversified growth funds before fees; 2.5%
 * inflation sits inside the Reserve Bank of NZ's 1–3% target band.
 */
export function defaultAssumptions(today = todayIso()): ProjectionAssumptions {
  return {
    startMonth: addMonths(monthKey(today), 1),
    horizonMonths: 60,
    initialBalance: 0,
    monthlyContribution: 0,
    timing: 'end',
    annualReturn: 0.06,
    annualFee: 0.005,
    taxRateOnReturns: 0.28,
    annualInflation: 0.025,
  };
}

export const SETTING_KEYS = {
  profile: 'financialProfile',
  assumptions: 'defaultAssumptions',
  seeded: 'seeded',
  dismissedRecurring: 'dismissedRecurring',
} as const;

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const rec = await db.settings.get(key);
  return rec ? (rec.value as T) : fallback;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await db.settings.put({ key, value });
}

export async function getProfile(): Promise<FinancialProfile> {
  return { ...DEFAULT_PROFILE, ...(await getSetting<Partial<FinancialProfile>>(SETTING_KEYS.profile, {})) };
}

export async function getDefaultAssumptions(): Promise<ProjectionAssumptions> {
  const stored = await getSetting<Partial<ProjectionAssumptions> | null>(SETTING_KEYS.assumptions, null);
  const defaults = defaultAssumptions();
  // The start month always rolls forward to next month; other values are the user's defaults.
  return { ...defaults, ...(stored ?? {}), startMonth: defaults.startMonth };
}
