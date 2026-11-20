import type { ProjectionAssumptions, ScenarioSet, ScenarioVariant } from '@/domain/types';
import { newId, nowTimestamp } from '@/domain/ids';

function variant(name: string, patch: Partial<ScenarioVariant> = {}): ScenarioVariant {
  return { id: newId('var'), name, oneOffs: [], recurring: [], contributionDelta: 0, ...patch };
}

export const TEMPLATES: { key: string; label: string; description: string; build: (base: ProjectionAssumptions) => Omit<ScenarioSet, 'id' | 'createdAt' | 'updatedAt'> }[] = [
  {
    key: 'spend-vs-invest',
    label: 'Spend now vs invest',
    description: 'A one-off expense (e.g. a $3,000 trip) compared with keeping the money invested.',
    build: (base) => ({
      name: 'Trip vs invest',
      base: { ...base, initialBalance: Math.max(base.initialBalance, 500_000) },
      variants: [
        variant('Take the trip', { oneOffs: [{ id: newId('flow'), label: 'Trip', month: 0, amount: -300_000 }] }),
        variant('Invest instead'),
      ],
    }),
  },
  {
    key: 'buy-now-later',
    label: 'Buy now vs later',
    description: 'Buy immediately, or wait a year and buy (price may rise with inflation).',
    build: (base) => ({
      name: 'Buy now vs in 12 months',
      base,
      variants: [
        variant('Buy now', { oneOffs: [{ id: newId('flow'), label: 'Purchase', month: 0, amount: -200_000 }] }),
        variant('Buy in 12 months', { oneOffs: [{ id: newId('flow'), label: 'Purchase (+3% price)', month: 12, amount: -206_000 }] }),
      ],
    }),
  },
  {
    key: 'savings-rate',
    label: 'Change savings contributions',
    description: 'Compare your current monthly contribution with saving more or less.',
    build: (base) => ({
      name: 'Savings rate options',
      base: { ...base, monthlyContribution: Math.max(base.monthlyContribution, 50_000), horizonMonths: 120 },
      variants: [variant('Current'), variant('+$200/month', { contributionDelta: 20_000 }), variant('−$200/month', { contributionDelta: -20_000 })],
    }),
  },
  {
    key: 'recurring',
    label: 'Change a recurring expense',
    description: 'E.g. a new $60/month subscription or gym membership, indexed to inflation.',
    build: (base) => ({
      name: 'New recurring expense',
      base: { ...base, horizonMonths: 60 },
      variants: [
        variant('Without'),
        variant('With $60/month', { recurring: [{ id: newId('flow'), label: 'Subscription', startMonth: 0, monthlyAmount: -6_000, inflationIndexed: true }] }),
      ],
    }),
  },
  {
    key: 'hours',
    label: 'Work fewer hours',
    description: 'Reduced income for a period, which reduces what you can save.',
    build: (base) => ({
      name: 'Four-day week for a year',
      base: { ...base, monthlyContribution: Math.max(base.monthlyContribution, 80_000), horizonMonths: 60 },
      variants: [
        variant('Full time'),
        variant('Four-day week (12 months)', {
          recurring: [{ id: newId('flow'), label: 'Lower take-home pay', startMonth: 0, endMonth: 11, monthlyAmount: -70_000, inflationIndexed: false }],
        }),
      ],
    }),
  },
];

export function newScenarioSet(templateKey: string, base: ProjectionAssumptions): ScenarioSet {
  const t = TEMPLATES.find((x) => x.key === templateKey) ?? TEMPLATES[0]!;
  const now = nowTimestamp();
  return { id: newId('scn'), createdAt: now, updatedAt: now, ...t.build(base) };
}
