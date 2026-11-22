import { useMemo } from 'react';
import { Badge } from '@/ui/components';
import type { Goal } from '@/domain/types';
import { DEFAULT_GOAL_RETURN, monthsToReach, monthsUntil, probabilityOfReaching, requiredMonthlyContribution } from '@/engine/goals';
import { addMonths, formatMonth, todayIso } from '@/domain/dates';
import { formatMoney, formatPercent } from '@/domain/money';

export interface GoalPlanSummary {
  required: number | null;
  months: number | null;
  finishMonth: string | null;
  probability: number | null;
  onTrack: boolean | null;
}

/** Plan figures for a goal given the amount saved so far. Pure calculation lives in engine/goals. */
export function useGoalPlan(goal: Goal, saved: number): GoalPlanSummary {
  return useMemo(() => {
    const today = todayIso();
    const base = { saved, target: goal.targetAmount, annualReturn: goal.annualReturn ?? DEFAULT_GOAL_RETURN };
    const months = goal.targetDate ? monthsUntil(today, goal.targetDate) : null;
    const required = months !== null ? requiredMonthlyContribution({ ...base, months }) : null;
    const planned = goal.monthlyContribution;
    const toReach = planned !== undefined ? monthsToReach(base, planned) : null;
    const finishMonth = toReach !== null && toReach > 0 ? addMonths(today.slice(0, 7), toReach - 1) : null;
    const vol = goal.annualVolatility ?? 0;
    const probability = planned !== undefined && months !== null && months > 0 && vol > 0 && saved < goal.targetAmount ? probabilityOfReaching({ ...base, months }, planned, vol, 1000) : null;
    const onTrack = required !== null && planned !== undefined ? planned >= required : null;
    return { required, months, finishMonth, probability, onTrack };
  }, [goal, saved]);
}

export function GoalPlanLine({ goal, saved }: { goal: Goal; saved: number }) {
  const p = useGoalPlan(goal, saved);
  if (saved >= goal.targetAmount && goal.targetAmount > 0) return <p className="mt-1 text-xs text-good">Target reached.</p>;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
      {p.required !== null && (
        <span>
          Needs <strong className="tabular">{formatMoney(p.required, { whole: true })}/month</strong> for {p.months} month{p.months === 1 ? '' : 's'}
        </span>
      )}
      {goal.monthlyContribution !== undefined && (
        <span>
          Planned {formatMoney(goal.monthlyContribution, { whole: true })}/month →{' '}
          {p.finishMonth ? `reached ${formatMonth(p.finishMonth)}` : goal.monthlyContribution > 0 ? 'not within 50 years' : 'no contributions planned'}
        </span>
      )}
      {p.onTrack !== null && <Badge tone={p.onTrack ? 'good' : 'warn'}>{p.onTrack ? 'On track' : 'Behind plan'}</Badge>}
      {p.probability !== null && <span>{formatPercent(p.probability, 0)} chance by the date (simulated, illustrative)</span>}
      <span className="text-muted">at {formatPercent(goal.annualReturn ?? DEFAULT_GOAL_RETURN, 1)} a year before tax</span>
    </p>
  );
}
