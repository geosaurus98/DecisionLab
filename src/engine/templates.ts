/**
 * Decision templates: starting criteria for common decisions, and criteria learned from your
 * own past decisions. Templates only pre-fill; every weight and criterion stays editable.
 */
import type { Criterion, Decision, DecisionCategory } from '@/domain/types';

export interface TemplateCriterion {
  name: string;
  type: Criterion['type'];
  direction: Criterion['direction'];
  weight: number;
  unit?: string;
}

export interface DecisionTemplate {
  id: string;
  label: string;
  category: DecisionCategory;
  hint: string;
  options: string[];
  criteria: TemplateCriterion[];
}

const r = (name: string, weight: number, direction: Criterion['direction'] = 'higher'): TemplateCriterion => ({ name, type: 'rating', direction, weight });

export const BUILT_IN_TEMPLATES: DecisionTemplate[] = [
  {
    id: 'purchase',
    label: 'Big purchase',
    category: 'purchase',
    hint: 'e.g. laptop, bike, appliance — compare models or buying nothing',
    options: ['Option A', 'Option B', 'Don’t buy'],
    criteria: [r('How often I’ll use it', 4), r('Quality / durability', 3), r('Enjoyment', 2), r('Hassle (setup, upkeep)', 1, 'lower')],
  },
  {
    id: 'trip',
    label: 'Trip or experience',
    category: 'travel',
    hint: 'e.g. overseas trip vs saving the money',
    options: ['Go', 'Don’t go'],
    criteria: [r('Enjoyment', 4), r('Memorable / once-off', 3), r('Time with people I care about', 2), r('Stress / hassle', 1, 'lower')],
  },
  {
    id: 'job',
    label: 'Job or career move',
    category: 'career',
    hint: 'e.g. accept an offer vs stay',
    options: ['Accept', 'Stay'],
    criteria: [r('Learning and growth', 4), r('Work I enjoy', 3), r('Team and manager', 3), r('Work–life balance', 2), r('Commute time', 1, 'lower')],
  },
  {
    id: 'subscription',
    label: 'Subscription or ongoing cost',
    category: 'lifestyle',
    hint: 'e.g. gym, streaming, software — keep, switch or cancel',
    options: ['Keep', 'Switch', 'Cancel'],
    criteria: [r('How often I use it', 4), r('Value compared with alternatives', 3), r('Enjoyment', 2)],
  },
  {
    id: 'savings',
    label: 'Savings or investing change',
    category: 'financial',
    hint: 'e.g. raise contributions, change fund, pay down debt',
    options: ['Change', 'Keep as is'],
    criteria: [r('Peace of mind', 3), r('Flexibility (access to money)', 2), r('Effort to maintain', 1, 'lower')],
  },
];

export interface HistoricalCriterion extends TemplateCriterion {
  /** Number of decisions that used it. */
  uses: number;
}

/**
 * Criteria you reuse: matched by name (case-insensitive) across decisions, most frequent first.
 * Type and direction are the most common choice; weight is the mean share of total weight,
 * scaled to a 1–5 starting weight.
 */
export function criteriaFromHistory(decisions: Pick<Decision, 'criteria' | 'updatedAt'>[], minUses = 2): HistoricalCriterion[] {
  const groups = new Map<string, { names: { name: string; at: string }[]; types: string[]; dirs: string[]; shares: number[]; units: string[] }>();
  for (const d of decisions) {
    const total = d.criteria.reduce((a, c) => a + Math.max(0, c.weight), 0);
    for (const c of d.criteria) {
      const key = c.name.trim().toLowerCase();
      if (!key) continue;
      const g = groups.get(key) ?? { names: [], types: [], dirs: [], shares: [], units: [] };
      g.names.push({ name: c.name.trim(), at: d.updatedAt });
      g.types.push(c.type);
      g.dirs.push(c.direction);
      g.shares.push(total > 0 ? c.weight / total : 0);
      if (c.unit) g.units.push(c.unit);
      groups.set(key, g);
    }
  }
  const mode = <T extends string>(xs: T[]): T => [...xs].sort((a, b) => xs.filter((x) => x === b).length - xs.filter((x) => x === a).length)[0]!;
  return [...groups.values()]
    .filter((g) => g.names.length >= minUses)
    .map((g) => {
      const meanShare = g.shares.reduce((a, b) => a + b, 0) / g.shares.length;
      return {
        name: [...g.names].sort((a, b) => b.at.localeCompare(a.at))[0]!.name,
        type: mode(g.types) as Criterion['type'],
        direction: mode(g.dirs) as Criterion['direction'],
        weight: Math.max(1, Math.min(5, Math.round(meanShare * 10))),
        unit: g.units.length ? mode(g.units) : undefined,
        uses: g.names.length,
      };
    })
    .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
}
