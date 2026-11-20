/**
 * Transparent multi-criteria decision analysis (weighted sum model).
 *
 * 1. Weights are normalised to sum to 1 (w_i = raw_i / Σ raw).
 * 2. Each score is normalised to [0, 1] with direction applied:
 *    - rating criteria (0–10 scale):  n = x/10 (higher better) or (10 − x)/10 (lower better)
 *    - measure criteria (raw values): min–max across options:
 *        n = (x − min)/(max − min) (higher better) or (max − x)/(max − min) (lower better);
 *        if all options are equal, n = 1 for all (the criterion does not discriminate).
 * 3. Option score = Σ w_i · n_i, reported on a 0–100 scale. Missing scores contribute 0
 *    and the option is flagged incomplete.
 *
 * Money is deliberately NOT a scoring criterion by default: financial consequences are shown
 * separately (see projection.ts) so preferences and dollars are not silently merged.
 */
import type { Criterion, DecisionOption, ScoreMatrix } from '@/domain/types';

export const RATING_MIN = 0;
export const RATING_MAX = 10;
/** A ranking is "fragile" if shifting one criterion's weight share by this much changes the leader… */
export const FRAGILE_WEIGHT_SHIFT = 0.15;
/** …or if the top two options are within this many points (0–100 scale). */
export const FRAGILE_MARGIN = 5;

export interface CriterionContribution {
  criterionId: string;
  raw: number | null;
  normalised: number;
  weight: number;
  contribution: number;
}

export interface OptionResult {
  optionId: string;
  /** 0–100 */
  score: number;
  rank: number;
  incomplete: boolean;
  contributions: CriterionContribution[];
}

export interface ScoringResult {
  results: OptionResult[];
  normalisedWeights: Record<string, number>;
  warnings: string[];
}

export function normaliseWeights(criteria: Criterion[]): Record<string, number> {
  const total = criteria.reduce((a, c) => a + Math.max(0, c.weight), 0);
  const out: Record<string, number> = {};
  for (const c of criteria) out[c.id] = total > 0 ? Math.max(0, c.weight) / total : criteria.length ? 1 / criteria.length : 0;
  return out;
}

export function normaliseCriterion(
  criterion: Criterion,
  options: DecisionOption[],
  scores: ScoreMatrix,
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  const raw = options.map((o) => scores[o.id]?.[criterion.id] ?? null);
  if (criterion.type === 'rating') {
    options.forEach((o, i) => {
      const x = raw[i];
      if (x === null || x === undefined || !Number.isFinite(x)) {
        out[o.id] = null;
        return;
      }
      const clamped = Math.min(RATING_MAX, Math.max(RATING_MIN, x));
      const n = (clamped - RATING_MIN) / (RATING_MAX - RATING_MIN);
      out[o.id] = criterion.direction === 'higher' ? n : 1 - n;
    });
    return out;
  }
  const present = raw.filter((x): x is number => x !== null && x !== undefined && Number.isFinite(x));
  const min = Math.min(...present);
  const max = Math.max(...present);
  options.forEach((o, i) => {
    const x = raw[i];
    if (x === null || x === undefined || !Number.isFinite(x)) {
      out[o.id] = null;
      return;
    }
    if (max === min) {
      out[o.id] = 1;
      return;
    }
    out[o.id] = criterion.direction === 'higher' ? (x - min) / (max - min) : (max - x) / (max - min);
  });
  return out;
}

export function scoreOptions(
  options: DecisionOption[],
  criteria: Criterion[],
  scores: ScoreMatrix,
  weightOverride?: Record<string, number>,
): ScoringResult {
  const warnings: string[] = [];
  const weights = weightOverride ?? normaliseWeights(criteria);
  const normalised = new Map(criteria.map((c) => [c.id, normaliseCriterion(c, options, scores)]));
  const partial = options.map((o) => {
    let total = 0;
    let incomplete = false;
    const contributions = criteria.map((c) => {
      const n = normalised.get(c.id)![o.id];
      const w = weights[c.id] ?? 0;
      if (n === null || n === undefined) incomplete = true;
      const contribution = (n ?? 0) * w;
      total += contribution;
      return { criterionId: c.id, raw: scores[o.id]?.[c.id] ?? null, normalised: n ?? 0, weight: w, contribution };
    });
    return { optionId: o.id, score: total * 100, incomplete, contributions };
  });
  const sorted = [...partial].sort((a, b) => b.score - a.score);
  const results: OptionResult[] = partial.map((p) => ({
    ...p,
    // Ties share the same (best) rank.
    rank: 1 + sorted.filter((s) => s.score > p.score + 1e-9).length,
  }));

  if (criteria.length === 0) warnings.push('Add at least one criterion to compare options.');
  if (options.length < 2) warnings.push('Add at least two alternatives to compare.');
  if (results.some((r) => r.incomplete)) warnings.push('Some scores are missing; missing values count as 0.');
  const measures = criteria.filter((c) => c.type === 'measure');
  if (measures.length > 0 && options.length === 2) {
    warnings.push(
      'With two options, min–max normalisation turns any difference in a measured criterion into a full 0 vs 1 gap. Small differences may be exaggerated.',
    );
  }
  return { results, normalisedWeights: weights, warnings };
}

export interface WeightSensitivity {
  criterionId: string;
  currentWeight: number;
  /** Range of this criterion's weight share (0–1) over which the current leader stays first. */
  stableRange: [number, number];
  /** Smallest absolute change in weight share that changes the leader, or null if none in [0,1]. */
  flipDistance: number | null;
  /** Option that takes the lead at the nearest flip point. */
  flipTo: string | null;
}

/**
 * One-at-a-time weight sensitivity. For each criterion, its weight share w is varied over
 * [0, 1] while the remaining weights keep their relative proportions (scaled by 1 − w).
 * The engine records where the leading option changes.
 */
export function weightSensitivity(
  options: DecisionOption[],
  criteria: Criterion[],
  scores: ScoreMatrix,
  steps = 200,
): { leaderId: string | null; items: WeightSensitivity[]; fragile: boolean; margin: number; equalWeightsLeader: string | null } {
  const base = scoreOptions(options, criteria, scores);
  const ordered = [...base.results].sort((a, b) => b.score - a.score);
  const leader = ordered[0]?.optionId ?? null;
  const margin = ordered.length > 1 ? ordered[0]!.score - ordered[1]!.score : 100;
  const weights = base.normalisedWeights;
  const items: WeightSensitivity[] = [];
  if (!leader || options.length < 2) {
    return { leaderId: leader, items, fragile: false, margin, equalWeightsLeader: leader };
  }
  for (const c of criteria) {
    const current = weights[c.id] ?? 0;
    const others = criteria.filter((o) => o.id !== c.id);
    const othersTotal = others.reduce((a, o) => a + (weights[o.id] ?? 0), 0);
    const leaderAt = (w: number): string => {
      const override: Record<string, number> = { [c.id]: w };
      for (const o of others) {
        override[o.id] = othersTotal > 0 ? ((weights[o.id] ?? 0) / othersTotal) * (1 - w) : (1 - w) / Math.max(1, others.length);
      }
      const r = scoreOptions(options, criteria, scores, override).results;
      const best = [...r].sort((a, b) => b.score - a.score || (a.optionId === leader ? -1 : b.optionId === leader ? 1 : 0))[0]!;
      return best.optionId;
    };
    // Scan downwards and upwards from the current weight until the leader changes.
    const scan = (direction: -1 | 1): { edge: number; flipAt: number | null; flipTo: string | null } => {
      let edge = current;
      for (let i = 1; i <= steps; i++) {
        const w = current + (direction * i) / steps;
        if (w < -1e-12 || w > 1 + 1e-12) break;
        const clamped = Math.min(1, Math.max(0, w));
        const l = leaderAt(clamped);
        if (l !== leader) return { edge, flipAt: Math.abs(clamped - current), flipTo: l };
        edge = clamped;
      }
      return { edge: direction < 0 ? Math.min(edge, current) : Math.max(edge, current), flipAt: null, flipTo: null };
    };
    const down = scan(-1);
    const up = scan(1);
    const lo = down.flipAt === null ? 0 : down.edge;
    const hi = up.flipAt === null ? 1 : up.edge;
    let flipDistance: number | null = null;
    let flipTo: string | null = null;
    for (const r of [down, up]) {
      if (r.flipAt !== null && (flipDistance === null || r.flipAt < flipDistance)) {
        flipDistance = r.flipAt;
        flipTo = r.flipTo;
      }
    }
    items.push({ criterionId: c.id, currentWeight: current, stableRange: [lo, hi], flipDistance, flipTo });
  }
  const equal: Record<string, number> = {};
  for (const c of criteria) equal[c.id] = 1 / criteria.length;
  const eq = scoreOptions(options, criteria, scores, equal).results;
  const equalWeightsLeader = [...eq].sort((a, b) => b.score - a.score)[0]?.optionId ?? null;
  const fragile = margin < FRAGILE_MARGIN || items.some((i) => i.flipDistance !== null && i.flipDistance <= FRAGILE_WEIGHT_SHIFT);
  return { leaderId: leader, items, fragile, margin, equalWeightsLeader };
}

/** Options not dominated on (weighted score ↑, cost ↓). */
export function paretoEfficient(points: { optionId: string; score: number; cost: number }[]): Set<string> {
  const efficient = new Set<string>();
  for (const p of points) {
    const dominated = points.some(
      (q) => q.optionId !== p.optionId && q.score >= p.score && q.cost <= p.cost && (q.score > p.score || q.cost < p.cost),
    );
    if (!dominated) efficient.add(p.optionId);
  }
  return efficient;
}
