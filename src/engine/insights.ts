/**
 * Decision calibration: compare predictions recorded in decision snapshots with reviewed
 * outcomes. Results always carry their sample size; with small samples the UI presents them
 * as observations, not conclusions.
 */
import type { Decision } from '@/domain/types';
import { mean, median, spearman } from './stats';
import { normaliseCriterion, normaliseWeights } from './scoring';

export const MIN_SAMPLE_FOR_PATTERN = 5;

export interface CalibrationSummary {
  reviewed: number;
  costSample: number;
  /** How many of the cost observations were measured from linked transactions (vs typed in). */
  linkedCostSample: number;
  /** Median relative cost error, (actual − predicted) / predicted. Positive = underestimated. */
  medianCostError: number | null;
  /** Share of decisions where actual cost exceeded prediction by more than 5%. */
  underestimatedShare: number | null;
  satisfactionSample: number;
  /** Mean (actual − predicted) satisfaction. Negative = over-optimistic. */
  meanSatisfactionGap: number | null;
  wouldRepeatShare: number | null;
  byCategory: { category: Decision['category']; n: number; medianCostError: number | null; meanSatisfaction: number }[];
  /** Confidence (1–5) vs share that would repeat, per confidence level. */
  confidenceCalibration: { confidence: number; n: number; wouldRepeatShare: number }[];
}

export function calibrate(decisions: Decision[]): CalibrationSummary {
  const reviewed = decisions.filter((d) => d.review && d.snapshot);
  const costPairs = reviewed
    .filter((d) => d.review!.actualCost !== null && d.snapshot!.predictedCost > 0)
    .map((d) => ({ d, err: (d.review!.actualCost! - d.snapshot!.predictedCost) / d.snapshot!.predictedCost }));
  const satPairs = reviewed.filter((d) => d.snapshot!.predictedSatisfaction !== null).map((d) => d.review!.satisfaction - d.snapshot!.predictedSatisfaction!);

  const categories = [...new Set(reviewed.map((d) => d.category))];
  const byCategory = categories.map((category) => {
    const items = reviewed.filter((d) => d.category === category);
    const errs = costPairs.filter((p) => p.d.category === category).map((p) => p.err);
    return { category, n: items.length, medianCostError: errs.length ? median(errs) : null, meanSatisfaction: mean(items.map((d) => d.review!.satisfaction)) };
  });

  const confidenceLevels = [...new Set(reviewed.map((d) => d.snapshot!.confidence).filter((c): c is number => c !== null))].sort();
  const confidenceCalibration = confidenceLevels.map((confidence) => {
    const items = reviewed.filter((d) => d.snapshot!.confidence === confidence);
    return { confidence, n: items.length, wouldRepeatShare: items.filter((d) => d.review!.wouldRepeat === 'yes').length / items.length };
  });

  return {
    reviewed: reviewed.length,
    costSample: costPairs.length,
    linkedCostSample: costPairs.filter((p) => p.d.review!.actualCostSource === 'linked').length,
    medianCostError: costPairs.length ? median(costPairs.map((p) => p.err)) : null,
    underestimatedShare: costPairs.length ? costPairs.filter((p) => p.err > 0.05).length / costPairs.length : null,
    satisfactionSample: satPairs.length,
    meanSatisfactionGap: satPairs.length ? mean(satPairs) : null,
    wouldRepeatShare: reviewed.length ? reviewed.filter((d) => d.review!.wouldRepeat === 'yes').length / reviewed.length : null,
    byCategory,
    confidenceCalibration,
  };
}

// ───────────────────────── Criterion-level insights ─────────────────────────

/** Minimum reviewed decisions sharing a criterion before its pattern is reported. */
export const MIN_CRITERION_SAMPLE = 10;

export interface CriterionInsight {
  /** Criterion name as you used it (most recent spelling). */
  name: string;
  n: number;
  /** Mean share of total weight you gave this criterion. */
  meanWeight: number;
  /**
   * Spearman rank correlation between the chosen option's normalised score on this criterion
   * and your actual satisfaction. null when not computable (constant values) or n too small.
   */
  rho: number | null;
  /** Plain-language reading, or null when evidence is insufficient. */
  reading: 'predictive' | 'notPredictive' | 'weightedButNotPredictive' | 'underweighted' | null;
}

/**
 * For criteria reused across reviewed decisions (matched by name, case-insensitive), measure
 * whether scoring the chosen option higher on that criterion went with higher actual
 * satisfaction. Correlation is not causation, and with tens of decisions estimates are noisy:
 * results below MIN_CRITERION_SAMPLE are listed without interpretation.
 */
export function criterionInsights(decisions: Decision[]): CriterionInsight[] {
  const obs = new Map<string, { name: string; score: number[]; satisfaction: number[]; weight: number[] }>();
  for (const d of decisions) {
    const s = d.snapshot;
    if (!s || !d.review || s.criteria.length === 0) continue;
    const weights = normaliseWeights(s.criteria);
    for (const c of s.criteria) {
      const n = normaliseCriterion(c, s.options, s.scores)[s.selectedOptionId];
      if (n === null || n === undefined) continue;
      const key = c.name.trim().toLowerCase();
      if (!key) continue;
      const o = obs.get(key) ?? { name: c.name.trim(), score: [], satisfaction: [], weight: [] };
      o.name = c.name.trim();
      o.score.push(n);
      o.satisfaction.push(d.review.satisfaction);
      o.weight.push(weights[c.id] ?? 0);
      obs.set(key, o);
    }
  }
  return [...obs.values()]
    .map((o) => {
      const n = o.score.length;
      const rho = n >= 3 ? spearman(o.score, o.satisfaction) : null;
      const meanWeight = mean(o.weight);
      let reading: CriterionInsight['reading'] = null;
      if (n >= MIN_CRITERION_SAMPLE && rho !== null) {
        if (rho >= 0.3) reading = meanWeight < 0.15 ? 'underweighted' : 'predictive';
        else reading = meanWeight >= 0.3 ? 'weightedButNotPredictive' : 'notPredictive';
      }
      return { name: o.name, n, meanWeight, rho: n >= MIN_CRITERION_SAMPLE ? rho : null, reading };
    })
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}
