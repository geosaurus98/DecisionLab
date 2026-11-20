/**
 * One-at-a-time sensitivity of projection outcomes. Each assumption is perturbed down and
 * up while all others stay fixed, and the projection is re-run with the changed assumption
 * (never by scaling outputs). Results feed a tornado chart.
 */
import type { Cents } from '@/domain/money';
import type { ProjectionAssumptions, ScenarioVariant } from '@/domain/types';
import { project } from './projection';

export interface SensitivityDriver {
  key: string;
  label: string;
  lowLabel: string;
  highLabel: string;
  low: Cents;
  high: Cents;
  base: Cents;
  /** |high − low|, used to sort the tornado. */
  swing: Cents;
}

interface Perturbation {
  key: string;
  label: string;
  apply: (a: ProjectionAssumptions, dir: -1 | 1) => ProjectionAssumptions;
  describe: (a: ProjectionAssumptions, dir: -1 | 1) => string;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export const DEFAULT_PERTURBATIONS: Perturbation[] = [
  {
    key: 'annualReturn',
    label: 'Annual return ±2 pp',
    apply: (a, d) => ({ ...a, annualReturn: Math.max(-0.99, a.annualReturn + d * 0.02) }),
    describe: (a, d) => pct(Math.max(-0.99, a.annualReturn + d * 0.02)),
  },
  {
    key: 'annualInflation',
    label: 'Inflation ±1 pp',
    apply: (a, d) => ({ ...a, annualInflation: a.annualInflation + d * 0.01 }),
    describe: (a, d) => pct(a.annualInflation + d * 0.01),
  },
  {
    key: 'annualFee',
    label: 'Fees ±0.5 pp',
    apply: (a, d) => ({ ...a, annualFee: Math.max(0, a.annualFee + d * 0.005) }),
    describe: (a, d) => pct(Math.max(0, a.annualFee + d * 0.005)),
  },
  {
    key: 'monthlyContribution',
    label: 'Monthly contribution ±20%',
    apply: (a, d) => ({ ...a, monthlyContribution: Math.round(a.monthlyContribution * (1 + d * 0.2)) }),
    describe: (a, d) => `$${Math.round((a.monthlyContribution * (1 + d * 0.2)) / 100).toLocaleString('en-NZ')}`,
  },
  {
    key: 'horizonMonths',
    label: 'Horizon ±25%',
    apply: (a, d) => ({ ...a, horizonMonths: Math.max(1, Math.round(a.horizonMonths * (1 + d * 0.25))) }),
    describe: (a, d) => `${Math.max(1, Math.round(a.horizonMonths * (1 + d * 0.25)))} months`,
  },
];

export type OutcomeMetric = (a: ProjectionAssumptions) => Cents;

/** Generic tornado over any metric computed from assumptions. */
export function tornado(
  base: ProjectionAssumptions,
  metric: OutcomeMetric,
  perturbations: Perturbation[] = DEFAULT_PERTURBATIONS,
): SensitivityDriver[] {
  const baseValue = metric(base);
  return perturbations
    .map((p) => {
      const low = metric(p.apply(base, -1));
      const high = metric(p.apply(base, 1));
      return {
        key: p.key,
        label: p.label,
        lowLabel: p.describe(base, -1),
        highLabel: p.describe(base, 1),
        low,
        high,
        base: baseValue,
        swing: Math.abs(high - low),
      };
    })
    .sort((x, y) => y.swing - x.swing);
}

/** Metric: real (inflation-adjusted) final-balance difference between two variants (A − B). */
export function realDifferenceMetric(a: ScenarioVariant, b: ScenarioVariant): OutcomeMetric {
  return (assumptions) => project(assumptions, a).finalReal - project(assumptions, b).finalReal;
}

export function finalRealMetric(v: ScenarioVariant): OutcomeMetric {
  return (assumptions) => project(assumptions, v).finalReal;
}
