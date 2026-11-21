/**
 * Deterministic monthly projection of a savings/investment balance.
 *
 * Conventions (documented in docs/CALCULATIONS.md):
 * - Time step: one calendar month. Month 0 is `startMonth`.
 * - Rates are annual and converted to equivalent monthly rates by geometric conversion:
 *     r_m = (1 + r_annual)^(1/12) − 1
 *     fee_m = 1 − (1 − fee_annual)^(1/12)
 *   so twelve months at r_m compound to exactly r_annual.
 * - Order of operations within a month, for timing = 'start':
 *     1. cash flows (contribution, recurring flows, one-offs) are applied
 *     2. investment return:   gain = max(B, 0) · r_m
 *     3. tax on the return:    tax = gain · taxRate (losses give a credit; simplified NZ PIE)
 *     4. fee:                  fee = max(B, 0) · fee_m
 *   For timing = 'end', step 1 happens after steps 2–4 (ordinary annuity).
 * - A negative balance earns no return and pays no fee (no borrowing cost is modelled);
 *   months with a negative balance are flagged as shortfalls.
 * - Real (inflation-adjusted) values are expressed in start-month dollars:
 *     real_t = nominal_t / (1 + inflation)^((t + 1)/12)  (balance at the END of month t)
 * - Inflation-indexed recurring flows grow by the monthly-equivalent inflation each month.
 * - Values are computed in fractional cents and rounded only in the outputs.
 *
 * Returns are illustrative assumptions, not guaranteed interest.
 */
import { roundCents, type Cents } from '@/domain/money';
import { addMonths, type MonthKey } from '@/domain/dates';
import type { OneOffFlow, ProjectionAssumptions, RecurringFlow, ScenarioVariant } from '@/domain/types';

export interface ProjectionPoint {
  /** Month offset (0-based); the balance is as at the END of this month. */
  t: number;
  month: MonthKey;
  nominal: Cents;
  real: Cents;
  /** Cumulative net cash flows (contributions + recurring + one-offs). */
  cumulativeFlows: Cents;
  cumulativeGrowth: Cents;
  cumulativeFees: Cents;
  cumulativeTax: Cents;
}

export interface ProjectionResult {
  points: ProjectionPoint[];
  finalNominal: Cents;
  finalReal: Cents;
  totalFlows: Cents;
  totalGrowth: Cents;
  totalFees: Cents;
  totalTax: Cents;
  /** First month offset at which the target is reached (end of month), or null. */
  targetReachedAt: number | null;
  /** Month offsets where the balance ended negative. */
  shortfallMonths: number[];
  /** Lowest end-of-month balance. */
  minimumBalance: Cents;
}

export function monthlyRate(annual: number): number {
  if (annual <= -1) throw new Error('Annual return must be greater than −100%.');
  return Math.pow(1 + annual, 1 / 12) - 1;
}

export function monthlyFeeRate(annualFee: number): number {
  if (annualFee < 0 || annualFee >= 1) throw new Error('Annual fee must be between 0% and 100%.');
  return 1 - Math.pow(1 - annualFee, 1 / 12);
}

export function validateAssumptions(a: ProjectionAssumptions): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(a.horizonMonths) || a.horizonMonths < 1 || a.horizonMonths > 1200) {
    errors.push('Horizon must be between 1 and 1200 months.');
  }
  if (!(a.annualReturn > -1) || a.annualReturn > 1) errors.push('Annual return must be between −100% and 100%.');
  if (!(a.annualFee >= 0) || a.annualFee >= 0.2) errors.push('Annual fee must be between 0% and 20%.');
  if (!(a.taxRateOnReturns >= 0) || a.taxRateOnReturns > 0.6) errors.push('Tax rate must be between 0% and 60%.');
  if (!(a.annualInflation > -0.5) || a.annualInflation > 0.5) errors.push('Inflation must be between −50% and 50%.');
  if (!Number.isFinite(a.initialBalance) || !Number.isFinite(a.monthlyContribution)) errors.push('Amounts must be numbers.');
  if (!/^\d{4}-\d{2}$/.test(a.startMonth)) errors.push('Start month must be YYYY-MM.');
  return errors;
}

function flowsForMonth(t: number, variant: Pick<ScenarioVariant, 'oneOffs' | 'recurring'>, inflM: number): number {
  let total = 0;
  for (const o of variant.oneOffs) if (o.month === t) total += o.amount;
  for (const r of variant.recurring) {
    if (t < r.startMonth) continue;
    if (r.endMonth !== undefined && t > r.endMonth) continue;
    total += r.inflationIndexed ? r.monthlyAmount * Math.pow(1 + inflM, t - r.startMonth) : r.monthlyAmount;
  }
  return total;
}

export const EMPTY_VARIANT: Pick<ScenarioVariant, 'oneOffs' | 'recurring' | 'contributionDelta'> = {
  oneOffs: [],
  recurring: [],
  contributionDelta: 0,
};

/** Net cash flow (contribution + recurring + one-offs) for each month of the horizon. */
export function flowSchedule(
  a: ProjectionAssumptions,
  variant: Pick<ScenarioVariant, 'oneOffs' | 'recurring' | 'contributionDelta'> = EMPTY_VARIANT,
): Float64Array {
  const inflM = monthlyRate(a.annualInflation);
  const contribution = a.monthlyContribution + variant.contributionDelta;
  const out = new Float64Array(a.horizonMonths);
  for (let t = 0; t < a.horizonMonths; t++) out[t] = contribution + flowsForMonth(t, variant, inflM);
  return out;
}

export interface MonthStep {
  balance: number;
  gain: number;
  tax: number;
  fee: number;
}

/**
 * One month of the balance model, shared by the deterministic and Monte Carlo engines so
 * both apply identical timing, tax and fee conventions. `rate` is this month's return.
 */
export function stepMonth(balance: number, monthFlows: number, rate: number, feeM: number, taxRate: number, timing: 'start' | 'end'): MonthStep {
  let b = timing === 'start' ? balance + monthFlows : balance;
  const investable = Math.max(b, 0);
  const gain = investable * rate;
  // Symmetric: a negative monthly return produces a tax credit, as PIE fund losses do.
  // (Taxing only gains would add an artificial drag whenever returns are volatile.)
  const tax = gain * taxRate;
  const fee = investable * feeM;
  b += gain - tax - fee;
  if (timing === 'end') b += monthFlows;
  return { balance: b, gain, tax, fee };
}

export function project(
  a: ProjectionAssumptions,
  variant: Pick<ScenarioVariant, 'oneOffs' | 'recurring' | 'contributionDelta'> = EMPTY_VARIANT,
): ProjectionResult {
  const errors = validateAssumptions(a);
  if (errors.length) throw new Error(errors.join(' '));
  const rM = monthlyRate(a.annualReturn);
  const feeM = monthlyFeeRate(a.annualFee);
  const inflM = monthlyRate(a.annualInflation);
  const schedule = flowSchedule(a, variant);

  let balance = a.initialBalance;
  let flows = 0;
  let growth = 0;
  let fees = 0;
  let tax = 0;
  let targetReachedAt: number | null = null;
  const shortfallMonths: number[] = [];
  let minimumBalance = Infinity;
  const points: ProjectionPoint[] = [];

  for (let t = 0; t < a.horizonMonths; t++) {
    const monthFlows = schedule[t]!;
    const step = stepMonth(balance, monthFlows, rM, feeM, a.taxRateOnReturns, a.timing);
    balance = step.balance;
    flows += monthFlows;
    growth += step.gain;
    tax += step.tax;
    fees += step.fee;
    const deflator = Math.pow(1 + inflM, t + 1);
    if (balance < 0) shortfallMonths.push(t);
    minimumBalance = Math.min(minimumBalance, balance);
    if (targetReachedAt === null && a.targetAmount !== undefined && balance >= a.targetAmount) targetReachedAt = t;
    points.push({
      t,
      month: addMonths(a.startMonth, t),
      nominal: Math.round(balance),
      real: Math.round(balance / deflator),
      cumulativeFlows: Math.round(flows),
      cumulativeGrowth: Math.round(growth),
      cumulativeFees: Math.round(fees),
      cumulativeTax: Math.round(tax),
    });
  }
  const last = points[points.length - 1]!;
  return {
    points,
    finalNominal: last.nominal,
    finalReal: last.real,
    totalFlows: last.cumulativeFlows,
    totalGrowth: last.cumulativeGrowth,
    totalFees: last.cumulativeFees,
    totalTax: last.cumulativeTax,
    targetReachedAt,
    shortfallMonths,
    minimumBalance: Math.round(minimumBalance),
  };
}

/** Closed-form future value for testing: FV of P at monthly rate r with payment C over n months. */
export function futureValue(principal: number, r: number, payment: number, n: number, timing: 'start' | 'end'): number {
  if (r === 0) return principal + payment * n;
  const growth = Math.pow(1 + r, n);
  const annuity = payment * ((growth - 1) / r) * (timing === 'start' ? 1 + r : 1);
  return principal * growth + annuity;
}

// ───────────────────────── Decision option → scenario variant ─────────────────────────

export interface CostedOption {
  id: string;
  name: string;
  upfrontCost: Cents;
  costMonth: number;
  monthlyCost: Cents;
  monthlyCostMonths?: number;
  extraFlows?: { oneOffs: OneOffFlow[]; recurring: RecurringFlow[]; contributionDelta: Cents };
}

/** Convert a decision option's costs into scenario cash flows (costs reduce the modelled balance). */
export function optionToVariant(option: CostedOption): ScenarioVariant {
  const oneOffs: OneOffFlow[] = option.upfrontCost
    ? [{ id: `${option.id}-upfront`, label: `${option.name}: upfront cost`, month: Math.max(0, option.costMonth), amount: -option.upfrontCost }]
    : [];
  const recurring: RecurringFlow[] = option.monthlyCost
    ? [
        {
          id: `${option.id}-monthly`,
          label: `${option.name}: monthly cost`,
          startMonth: Math.max(0, option.costMonth),
          endMonth: option.monthlyCostMonths ? Math.max(0, option.costMonth) + option.monthlyCostMonths - 1 : undefined,
          monthlyAmount: -option.monthlyCost,
          inflationIndexed: false,
        },
      ]
    : [];
  const extra = option.extraFlows;
  return {
    id: option.id,
    name: option.name,
    oneOffs: extra ? [...oneOffs, ...extra.oneOffs] : oneOffs,
    recurring: extra ? [...recurring, ...extra.recurring] : recurring,
    contributionDelta: extra?.contributionDelta ?? 0,
  };
}

/**
 * Convert a Scenario Lab variant into a decision option. A variant with a single negative
 * one-off and/or a single negative, non-indexed recurring flow starting in the same month
 * maps onto the simple upfront/monthly fields; anything richer is kept as extra flows, so
 * the projection is identical either way.
 */
export function variantToOption(v: ScenarioVariant): CostedOption & { expectedBenefits?: string } {
  const base = { id: v.id, name: v.name, upfrontCost: 0, costMonth: 0, monthlyCost: 0 };
  const one = v.oneOffs[0];
  const rec = v.recurring[0];
  const simple =
    v.contributionDelta === 0 &&
    v.oneOffs.length <= 1 &&
    v.recurring.length <= 1 &&
    (!one || one.amount < 0) &&
    (!rec || (rec.monthlyAmount < 0 && !rec.inflationIndexed && (!one || rec.startMonth === one.month)));
  if (simple) {
    const costMonth = one?.month ?? rec?.startMonth ?? 0;
    return {
      ...base,
      costMonth,
      upfrontCost: one ? -one.amount : 0,
      monthlyCost: rec ? -rec.monthlyAmount : 0,
      monthlyCostMonths: rec && rec.endMonth !== undefined ? rec.endMonth - rec.startMonth + 1 : undefined,
    };
  }
  return { ...base, extraFlows: { oneOffs: v.oneOffs, recurring: v.recurring, contributionDelta: v.contributionDelta } };
}

/**
 * Total nominal (undiscounted) cost of an option within the horizon: the sum of its cash
 * flows with the sign flipped (money out is cost; money in, e.g. resale, reduces it).
 * Contribution changes are saving decisions, not costs, and are excluded.
 * Inflation-indexed recurring flows grow at `annualInflation`.
 */
export function totalOptionCost(option: CostedOption, horizonMonths: number, annualInflation = 0): Cents {
  const v = optionToVariant(option);
  const inflM = monthlyRate(annualInflation);
  let total = 0;
  for (let t = 0; t < horizonMonths; t++) total += flowsForMonth(t, v, inflM);
  return roundCents(-total);
}

/** Month offset (from startMonth) of a calendar date, or null if before the start. */
export function monthOffset(startMonth: string, date: string): number | null {
  const [sy, sm] = startMonth.split('-').map(Number) as [number, number];
  const [y, m] = date.split('-').map(Number) as [number, number];
  const offset = (y - sy) * 12 + (m - sm);
  return offset < 0 ? null : offset;
}

/**
 * Whether the projection reaches its target by a date (end of that date's month).
 * Returns null when there is no target or the date is outside the horizon.
 */
export function reachedByDate(result: ProjectionResult, a: ProjectionAssumptions, date: string): boolean | null {
  if (a.targetAmount === undefined) return null;
  const offset = monthOffset(a.startMonth, date);
  if (offset === null) return false;
  if (offset >= a.horizonMonths) return result.targetReachedAt !== null ? true : null;
  return result.targetReachedAt !== null && result.targetReachedAt <= offset;
}

export interface VariantComparison {
  variantId: string;
  name: string;
  result: ProjectionResult;
  /** Difference in final nominal balance relative to the best variant (≤ 0). */
  vsBestNominal: Cents;
  vsBestReal: Cents;
}

export function compareVariants(a: ProjectionAssumptions, variants: ScenarioVariant[]): VariantComparison[] {
  const results = variants.map((v) => ({ variantId: v.id, name: v.name, result: project(a, v) }));
  const bestNominal = Math.max(...results.map((r) => r.result.finalNominal));
  const bestReal = Math.max(...results.map((r) => r.result.finalReal));
  return results.map((r) => ({
    ...r,
    vsBestNominal: r.result.finalNominal - bestNominal,
    vsBestReal: r.result.finalReal - bestReal,
  }));
}
