/**
 * Decision calibration: compare predictions recorded in decision snapshots with reviewed
 * outcomes. Results always carry their sample size; with small samples the UI presents them
 * as observations, not conclusions.
 */
import type { Decision } from '@/domain/types';
import { mean, median } from './stats';

export const MIN_SAMPLE_FOR_PATTERN = 5;

export interface CalibrationSummary {
  reviewed: number;
  costSample: number;
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
    medianCostError: costPairs.length ? median(costPairs.map((p) => p.err)) : null,
    underestimatedShare: costPairs.length ? costPairs.filter((p) => p.err > 0.05).length / costPairs.length : null,
    satisfactionSample: satPairs.length,
    meanSatisfactionGap: satPairs.length ? mean(satPairs) : null,
    wouldRepeatShare: reviewed.length ? reviewed.filter((d) => d.review!.wouldRepeat === 'yes').length / reviewed.length : null,
    byCategory,
    confidenceCalibration,
  };
}
