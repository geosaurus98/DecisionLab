/**
 * Savings plans for goals. Uses the projection engine's own month step (timing, fees, tax),
 * so a plan and a Scenario Lab projection with the same inputs always agree.
 */
import type { Cents } from '@/domain/money';
import type { ProjectionAssumptions } from '@/domain/types';
import { monthOffset, project } from './projection';
import { simulate } from './montecarlo';

export const DEFAULT_GOAL_RETURN = 0.035; // indicative NZ savings-account rate; edit per goal
export const DEFAULT_GOAL_TAX = 0.175; // a common NZ RWT/PIR rate on interest; edit in assumptions

export interface GoalPlanInput {
  saved: Cents;
  target: Cents;
  /** Months until the target date (the balance is checked at the end of the last month). */
  months: number;
  annualReturn: number;
  annualFee?: number;
  taxRate?: number;
  timing?: 'start' | 'end';
}

function assumptions(i: GoalPlanInput, contribution: Cents, months: number, startMonth = '2000-01'): ProjectionAssumptions {
  return {
    startMonth,
    horizonMonths: Math.max(1, months),
    initialBalance: i.saved,
    monthlyContribution: contribution,
    timing: i.timing ?? 'end',
    annualReturn: i.annualReturn,
    annualFee: i.annualFee ?? 0,
    taxRateOnReturns: i.taxRate ?? DEFAULT_GOAL_TAX,
    annualInflation: 0,
  };
}

/**
 * Smallest whole-dollar monthly contribution that reaches the target by the end of the
 * horizon (nominal). 0 if already reachable without contributions. Found by bisection on the
 * projection, so it respects compounding, fees and tax exactly.
 */
export function requiredMonthlyContribution(i: GoalPlanInput): Cents {
  if (i.months < 1) return Math.max(0, i.target - i.saved);
  const finalWith = (c: number) => project(assumptions(i, c, i.months)).finalNominal;
  if (finalWith(0) >= i.target) return 0;
  let lo = 0;
  let hi = Math.max(100, Math.ceil((i.target - i.saved) / i.months));
  while (finalWith(hi) < i.target) hi *= 2;
  while (hi - lo > 100) {
    const mid = Math.floor((lo + hi) / 2);
    if (finalWith(mid) >= i.target) hi = mid;
    else lo = mid;
  }
  // Round up to whole dollars, then confirm.
  let c = Math.ceil(hi / 100) * 100;
  while (c > 100 && finalWith(c - 100) >= i.target) c -= 100;
  return c;
}

/** Months until the target is reached at a given contribution (null if not within maxMonths). */
export function monthsToReach(i: Omit<GoalPlanInput, 'months'>, contribution: Cents, maxMonths = 600): number | null {
  if (i.saved >= i.target) return 0;
  const r = project({ ...assumptions({ ...i, months: maxMonths }, contribution, maxMonths), targetAmount: i.target });
  return r.targetReachedAt === null ? null : r.targetReachedAt + 1;
}

/** Probability of reaching the target by the date at the given contribution, under uncertain returns. */
export function probabilityOfReaching(i: GoalPlanInput, contribution: Cents, annualVolatility: number, runs = 2000, seed = 20261123): number {
  const a = { ...assumptions(i, contribution, i.months), targetAmount: i.target };
  const res = simulate(a, [{ id: 'g', name: 'Goal', oneOffs: [], recurring: [], contributionDelta: 0 }], { annualVolatility, runs, seed });
  return res.variants[0]!.probTargetAtEnd ?? 0;
}

/** Whole months from `today` to the end of the target date's month (0 if past). */
export function monthsUntil(today: string, targetDate: string): number {
  const offset = monthOffset(today.slice(0, 7), targetDate);
  return offset === null ? 0 : offset + 1;
}
