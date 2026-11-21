import { describe, expect, it } from 'vitest';
import { detectPreset } from '../csvPresets';
import { mapRows, parseCsvText, suggestMapping } from '../csv';
import { balanceGaps, balanceSeries, chronological, closingBalance, fileOrder } from '../balances';
import { applyOverrides, billsBeforeNextIncome, detectRecurring, occurrences, stepCadence, upcomingBills, type RecurringSeries } from '../recurring';
import { budgetReport } from '../budgets';
import { estimateFlexibility, currentBalance } from '../flexibility';
import { categoryMap } from '@/test/fixtures';
import type { CsvMapping } from '@/domain/types';

describe('bank presets', () => {
  it('detects presets from header signatures, using the file’s header spelling', () => {
    expect(detectPreset(['Date', 'Unique Id', 'Tran Type', 'Cheque Number', 'Payee', 'Memo', 'Amount'])?.bank).toBe('ASB');
    expect(detectPreset(['Type', 'Details', 'Particulars', 'Code', 'Reference', 'Amount', 'Date', 'ForeignCurrencyAmount', 'ConversionCharge'])?.bank).toBe('ANZ');
    const kb = detectPreset(['Account number', 'DATE', 'Memo/Description', 'Amount', 'Balance']);
    expect(kb?.bank).toBe('Kiwibank');
    expect(kb?.mapping.dateColumn).toBe('DATE');
    expect(kb?.mapping.balanceColumn).toBe('Balance');
    expect(kb?.verified).toBe(false);
    expect(detectPreset(['When', 'What', 'How much'])).toBeNull();
  });
});

describe('statement balances', () => {
  const csv = `Date,Amount,Payee,Balance
03/03/2026,-20.00,Shop,980.00
02/03/2026,-50.00,Fuel,1000.00
02/03/2026,1000.00,Pay,1050.00
01/03/2026,10.00,Interest,50.00
`;
  it('parses a balance column and suggests it in the mapping', () => {
    const parsed = parseCsvText(csv);
    const m = suggestMapping(parsed);
    expect(m.balanceColumn).toBe('Balance');
    const rows = mapRows(parsed.rows, m as CsvMapping);
    expect(rows.map((r) => r.balance)).toEqual([98000, 100000, 105000, 5000]);
  });

  const rows = [
    { id: 'a', date: '2026-03-03', amount: -2000, balanceAfter: 98000, rowIndex: 0, importId: 'i' },
    { id: 'b', date: '2026-03-02', amount: -5000, balanceAfter: 100000, rowIndex: 1, importId: 'i' },
    { id: 'c', date: '2026-03-02', amount: 100000, balanceAfter: 105000, rowIndex: 2, importId: 'i' },
    { id: 'd', date: '2026-03-01', amount: 1000, balanceAfter: 5000, rowIndex: 3, importId: 'i' },
  ];
  it('detects newest-first files and orders same-day rows by statement position', () => {
    expect(fileOrder(rows)).toBe('newestFirst');
    expect(chronological(rows).map((r) => r.id)).toEqual(['d', 'c', 'b', 'a']);
    const sameDay = [
      { date: '2026-03-02', amount: 100000, balanceAfter: 105000 },
      { date: '2026-03-02', amount: -5000, balanceAfter: 100000 },
    ];
    expect(fileOrder(sameDay)).toBe('oldestFirst');
    expect(fileOrder([...sameDay].reverse())).toBe('newestFirst');
  });
  it('finds the closing balance, including later rows without a printed balance', () => {
    expect(closingBalance(rows)).toEqual({ amount: 98000, asOf: '2026-03-03', rowId: 'a' });
    const withManual = [...rows, { id: 'm', date: '2026-03-05', amount: -1500, importId: null }];
    expect(closingBalance(withManual)).toMatchObject({ amount: 96500, asOf: '2026-03-05' });
    expect(closingBalance([{ id: 'x', date: '2026-01-01', amount: 1 }])).toBeNull();
  });
  it('reports gaps where printed balances do not reconcile', () => {
    expect(balanceGaps(rows)).toEqual([]);
    const missing = rows.filter((r) => r.id !== 'b'); // drop the fuel purchase
    const gaps = balanceGaps(missing);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ from: '2026-03-02', to: '2026-03-03', expected: 103000, printed: 98000, difference: -5000 });
  });
  it('reconstructs a daily balance series from one anchor', () => {
    const series = balanceSeries(rows, { amount: 98000, asOf: '2026-03-03' });
    expect(series).toEqual([
      { date: '2026-03-01', balance: 5000 },
      { date: '2026-03-02', balance: 100000 },
      { date: '2026-03-03', balance: 98000 },
    ]);
    const fwd = balanceSeries(rows, { amount: 5000, asOf: '2026-03-01' });
    expect(fwd.at(-1)).toEqual({ date: '2026-03-03', balance: 98000 });
  });
  it('prefers the more recent of statement and manual balances', () => {
    const base = { id: 'a', name: 'A', type: 'everyday' as const, currency: 'NZD' as const, includeInLiquid: true, createdAt: '' };
    expect(currentBalance({ ...base, balance: { amount: 1, asOf: '2026-03-01' }, statementBalance: { amount: 2, asOf: '2026-03-02', importId: 'i' } })).toMatchObject({ amount: 2, source: 'statement' });
    expect(currentBalance({ ...base, balance: { amount: 1, asOf: '2026-03-05' }, statementBalance: { amount: 2, asOf: '2026-03-02', importId: 'i' } })).toMatchObject({ amount: 1, source: 'manual' });
    expect(currentBalance(base)).toBeNull();
  });
});

describe('recurring calendar', () => {
  it('steps months by calendar, clamping to month length', () => {
    expect(stepCadence('2026-01-31', 'monthly', 1)).toBe('2026-02-28');
    expect(stepCadence('2026-01-31', 'monthly', 2)).toBe('2026-03-31');
    expect(stepCadence('2026-03-15', 'quarterly', -1)).toBe('2025-12-15');
    expect(stepCadence('2026-03-15', 'fortnightly', 2)).toBe('2026-04-12');
    expect(occurrences({ lastDate: '2026-03-15', cadence: 'monthly' }, '2026-01-01', '2026-05-31')).toEqual(['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15', '2026-05-15']);
  });

  const series = (over: Partial<RecurringSeries>): RecurringSeries => ({
    key: 'out:X',
    merchant: 'X',
    direction: 'out',
    cadence: 'monthly',
    occurrences: 5,
    typicalAmount: 8500,
    monthlyEquivalent: -8500,
    lastDate: '2026-11-18',
    nextExpected: '2026-12-18',
    confidence: 1,
    amountVariation: 0,
    categoryId: 'subs',
    transactionIds: [],
    active: true,
    ...over,
  });

  it('applies overrides: dismiss, label and expected amount', () => {
    const res = applyOverrides(
      [series({ key: 'a' }), series({ key: 'b' }), series({ key: 'c', cadence: 'fortnightly' })],
      [
        { key: 'a', status: 'dismissed', updatedAt: '' },
        { key: 'c', status: 'confirmed', label: 'Gym', expectedAmount: 4000, updatedAt: '' },
      ],
    );
    expect(res.map((r) => r.key)).toEqual(['b', 'c']);
    expect(res[1]).toMatchObject({ label: 'Gym', confirmed: true, amountOverridden: true, typicalAmount: 4000, monthlyEquivalent: Math.round(-4000 * (26 / 12)) });
    expect(res[0]!.label).toBe('X');
  });

  it('lists upcoming bills and those due before the next pay', () => {
    const rent = series({ key: 'rent', merchant: 'RENT', cadence: 'weekly', typicalAmount: 31000, lastDate: '2026-11-20', categoryId: 'rent' });
    const power = series({ key: 'power', merchant: 'POWER', typicalAmount: 9000, lastDate: '2026-10-24' });
    const pay = series({ key: 'pay', merchant: 'PAY', direction: 'in', cadence: 'fortnightly', typicalAmount: 215000, lastDate: '2026-11-19' });
    const old = series({ key: 'old', active: false, lastDate: '2026-11-01' });
    const bills = upcomingBills([rent, power, pay, old], '2026-11-21', '2026-12-05');
    expect(bills.map((b) => `${b.label} ${b.date}`)).toEqual(['POWER 2026-11-24', 'RENT 2026-11-27', 'RENT 2026-12-04']);
    const before = billsBeforeNextIncome([rent, power, pay], '2026-11-21')!;
    expect(before.nextIncome).toBe('2026-12-03');
    expect(before.total).toBe(9000 + 31000);
    expect(billsBeforeNextIncome([rent], '2026-11-21')).toBeNull();
  });

  it('uses calendar months for next expected dates', () => {
    const txns = ['2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31'].map((date, i) => ({ id: String(i), date, amount: -1000, merchant: 'M', categoryId: null }));
    expect(detectRecurring(txns, { asOf: '2026-11-05' })[0]!.nextExpected).toBe('2026-11-30');
  });
});

describe('bill-aware budget pace', () => {
  const rent = { lastDate: '2026-11-06', cadence: 'weekly' as const, direction: 'out' as const, active: true, typicalAmount: 31000, categoryId: 'rent' };
  const b = [{ categoryId: 'rent', monthlyAmount: 124000, updatedAt: '' }];
  it('treats recurring bills as due on their dates rather than spread evenly', () => {
    // Rent paid weekly on Fridays: 6, 13, 20, 27 Nov. On the 21st, three are due ($930).
    const lines = ['2026-11-06', '2026-11-13', '2026-11-20'].map((date) => ({ date, amount: -31000, categoryId: 'rent' }));
    const withBills = budgetReport(lines, categoryMap, b, '2026-11', '2026-11-21', [rent]);
    expect(withBills.lines[0]).toMatchObject({ billsThisMonth: 124000, expectedByNow: 93000, status: 'onTrack' });
    const naive = budgetReport(lines, categoryMap, b, '2026-11', '2026-11-21');
    expect(naive.lines[0]!.expectedByNow).toBe(Math.round(124000 * 0.7));
    expect(naive.lines[0]!.status).toBe('onTrack'); // 93000 ≤ 86800 × 1.1
  });
});

describe('flexibility with statement balances and payday bills', () => {
  it('uses a known statement balance and subtracts bills due before the next pay', () => {
    const res = estimateFlexibility({
      accounts: [{ id: 'a', name: 'Everyday', type: 'everyday', currency: 'NZD', includeInLiquid: true, statementBalance: { amount: 300000, asOf: '2026-11-20', importId: 'i' }, createdAt: '' }],
      goals: [],
      profile: { emergencyReserveTarget: 0, monthlySavingsCommitment: 0, monthlyIncomeOverride: null, monthlyObligationsOverride: null, lookbackMonths: 3, upcomingExpenses: [], upcomingHorizonDays: 90 },
      completeMonths: [],
      recurring: [
        { key: 'r', merchant: 'RENT', direction: 'out', cadence: 'weekly', occurrences: 9, typicalAmount: 31000, monthlyEquivalent: -134333, lastDate: '2026-11-20', nextExpected: '2026-11-27', confidence: 1, amountVariation: 0, categoryId: 'rent', transactionIds: [], active: true },
        { key: 's', merchant: 'SAVINGS', direction: 'out', cadence: 'weekly', occurrences: 9, typicalAmount: 10000, monthlyEquivalent: -43333, lastDate: '2026-11-20', nextExpected: '2026-11-27', confidence: 1, amountVariation: 0, categoryId: 'transfer', transactionIds: [], active: true },
        { key: 'p', merchant: 'PAY', direction: 'in', cadence: 'fortnightly', occurrences: 9, typicalAmount: 215000, monthlyEquivalent: 465833, lastDate: '2026-11-19', nextExpected: '2026-12-03', confidence: 1, amountVariation: 0, categoryId: 'income', transactionIds: [], active: true },
      ],
      categories: categoryMap,
      today: '2026-11-21',
    });
    expect(res.availableNowLines[0]).toMatchObject({ amount: 300000, provenance: 'known' });
    const bills = res.availableNowLines.find((l) => l.label.startsWith('Bills due'))!;
    expect(bills).toMatchObject({ amount: -31000, provenance: 'estimated' }); // transfer excluded
    expect(res.availableNow).toBe(300000 - 31000);
  });
});
