import { describe, expect, it } from 'vitest';
import { BUILT_IN_TEMPLATES, criteriaFromHistory } from '../templates';
import type { Criterion } from '@/domain/types';

const c = (name: string, weight: number, over: Partial<Criterion> = {}): Criterion => ({ id: name, name, type: 'rating', direction: 'higher', weight, ...over });

describe('decision templates', () => {
  it('built-in templates have valid criteria and at least two options', () => {
    for (const t of BUILT_IN_TEMPLATES) {
      expect(t.options.length).toBeGreaterThanOrEqual(2);
      expect(t.criteria.length).toBeGreaterThan(0);
      expect(t.criteria.every((x) => x.weight > 0 && x.name.trim().length > 0)).toBe(true);
    }
  });

  it('learns reused criteria with their usual type, direction and relative weight', () => {
    const res = criteriaFromHistory([
      { updatedAt: '2026-01-01', criteria: [c('enjoyment', 3), c('Cost', 1, { type: 'measure', direction: 'lower', unit: '$' })] },
      { updatedAt: '2026-03-01', criteria: [c('Enjoyment', 1), c('Usefulness', 1), c('cost', 2, { type: 'measure', direction: 'lower', unit: '$' })] },
      { updatedAt: '2026-02-01', criteria: [c('Once only', 1)] },
    ]);
    // Ties on use count sort by name; the most recent spelling wins; single-use criteria are excluded.
    expect(res.map((r) => r.name)).toEqual(['cost', 'Enjoyment']);
    const e = res.find((r) => r.name === 'Enjoyment')!;
    expect(e.uses).toBe(2);
    expect(e.weight).toBe(5); // weight shares 3/4 and 1/4 → mean 0.5 → 5 on a 1–5 scale
    expect(res.find((r) => r.name === 'cost')).toMatchObject({ type: 'measure', direction: 'lower', unit: '$' });
  });
});
