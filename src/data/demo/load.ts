/** Loads the synthetic demo dataset through the real import pipeline. */
import { db } from '../db';
import { commitImport, previewImport } from '../imports';
import { getProfile, setSetting, SETTING_KEYS, DEFAULT_PROFILE, getDefaultAssumptions } from '../settings';
import { generateDemoData } from './generate';
import { parseCsvText } from '@/engine/csv';
import type { CsvMapping, Decision } from '@/domain/types';
import { addDays, todayIso } from '@/domain/dates';
import { newId, nowTimestamp } from '@/domain/ids';
import { buildSnapshot } from '../decisions';

export const DEMO_MAPPING: CsvMapping = {
  dateColumn: 'Date',
  dateFormat: 'DD/MM/YYYY',
  amountMode: 'signed',
  amountColumn: 'Amount',
  descriptionColumns: ['Payee', 'Particulars'],
  referenceColumn: 'Reference',
};

export async function hasDemoData(): Promise<boolean> {
  return (await db.accounts.filter((a) => a.isDemo === true).count()) > 0;
}

export async function loadDemoData(today = todayIso()): Promise<void> {
  if (await hasDemoData()) return;
  const data = generateDemoData(today);
  const now = nowTimestamp();
  const everydayId = newId('acc');
  const savingsId = newId('acc');
  await db.accounts.bulkAdd([
    {
      id: everydayId,
      name: 'Demo – Everyday',
      institution: 'Demo Bank',
      type: 'everyday',
      currency: 'NZD',
      includeInLiquid: true,
      balance: { amount: 284_055, asOf: today },
      isDemo: true,
      createdAt: now,
    },
    {
      id: savingsId,
      name: 'Demo – Savings',
      institution: 'Demo Bank',
      type: 'savings',
      currency: 'NZD',
      includeInLiquid: true,
      balance: { amount: 912_000, asOf: today },
      isDemo: true,
      createdAt: now,
    },
  ]);
  for (const [accountId, csv, fileName] of [
    [everydayId, data.everydayCsv, 'demo-everyday.csv'],
    [savingsId, data.savingsCsv, 'demo-savings.csv'],
  ] as const) {
    const parsed = parseCsvText(csv);
    const preview = await previewImport(accountId, parsed.rows, DEMO_MAPPING);
    await commitImport({ accountId, fileName, mapping: DEMO_MAPPING, preview, isDemo: true });
  }

  // Only fill planning inputs if the user has not set any yet.
  const profile = await getProfile();
  if (JSON.stringify(profile) === JSON.stringify(DEFAULT_PROFILE)) {
    await setSetting(SETTING_KEYS.profile, {
      ...DEFAULT_PROFILE,
      emergencyReserveTarget: 500_000,
      monthlySavingsCommitment: 50_000,
      upcomingExpenses: [{ id: newId('up'), label: 'Car registration (demo)', amount: 12_000, dueDate: addDays(today, 40) }],
    });
  }

  // One reviewed historical decision, so history and insights have an example.
  const assumptions = { ...(await getDefaultAssumptions()), horizonMonths: 36, startMonth: data.start.slice(0, 7) };
  const a = newId('opt');
  const b = newId('opt');
  const quality = newId('crit');
  const comfort = newId('crit');
  const decision: Decision = {
    id: newId('dec'),
    title: 'Noise-cancelling headphones (demo)',
    description: 'Better headphones for the open-plan office and commuting.',
    category: 'purchase',
    date: addDays(data.start, 60),
    status: 'decided',
    options: [
      { id: a, name: 'Premium headphones', upfrontCost: 54_900, costMonth: 0, monthlyCost: 0, expectedBenefits: 'Excellent noise cancelling' },
      { id: b, name: 'Keep current earbuds', upfrontCost: 0, costMonth: 0, monthlyCost: 0 },
    ],
    criteria: [
      { id: quality, name: 'Focus at work', type: 'rating', direction: 'higher', weight: 3 },
      { id: comfort, name: 'Comfort', type: 'rating', direction: 'higher', weight: 2 },
    ],
    scores: { [a]: { [quality]: 9, [comfort]: 8 }, [b]: { [quality]: 4, [comfort]: 6 } },
    assumptions,
    notes: '',
    links: [],
    selectedOptionId: a,
    reasoning: 'Daily use; expected to noticeably improve focus.',
    predictedSatisfaction: 8,
    confidence: 4,
    reviewDate: addDays(data.start, 150),
    snapshot: null,
    review: null,
    createdAt: now,
    updatedAt: now,
    isDemo: true,
  };
  decision.snapshot = buildSnapshot(decision, a);
  decision.review = {
    reviewedAt: now,
    actualCost: 61_400,
    actualBenefits: 'Used daily; focus improved, though the case was an extra cost.',
    satisfaction: 7,
    expectationsMet: 'met',
    wouldRepeat: 'yes',
    unexpected: 'Needed a $65 hard case.',
    lessons: 'Include accessories in the cost estimate.',
  };
  decision.status = 'reviewed';
  await db.decisions.add(decision);
}
