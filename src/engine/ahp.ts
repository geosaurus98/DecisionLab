/**
 * Analytic Hierarchy Process (AHP) weights from pairwise comparisons.
 *
 * The user judges each pair of criteria on Saaty's 1–9 scale (1 = equally important,
 * 9 = extremely more important; reciprocals for the other direction). Weights are the
 * normalised geometric means of the rows of the reciprocal comparison matrix — a standard,
 * closed-form approximation of the principal eigenvector.
 *
 * Consistency: λmax = mean_i((A·w)_i / w_i), CI = (λmax − n)/(n − 1), CR = CI / RI(n),
 * with Saaty's random indices RI. CR ≤ 0.10 is conventionally acceptable; above that the
 * judgements contradict each other (e.g. A > B, B > C but C > A) and should be revisited.
 */
export const SAATY_RI = [0, 0, 0, 0.58, 0.9, 1.12, 1.24, 1.32, 1.41, 1.45, 1.49];
export const CR_THRESHOLD = 0.1;

export const pairKey = (a: string, b: string) => `${a}|${b}`;

/** Judgement of a relative to b from a stored map (either orientation); 1 when missing. */
export function judgement(pairwise: Record<string, number> | undefined, a: string, b: string): number {
  if (a === b) return 1;
  const direct = pairwise?.[pairKey(a, b)];
  if (direct !== undefined && direct > 0) return direct;
  const inverse = pairwise?.[pairKey(b, a)];
  if (inverse !== undefined && inverse > 0) return 1 / inverse;
  return 1;
}

export interface AhpResult {
  weights: Record<string, number>;
  lambdaMax: number;
  consistencyIndex: number;
  /** null when n ≤ 2 (always perfectly consistent). */
  consistencyRatio: number | null;
  consistent: boolean;
}

export function ahpWeights(ids: string[], pairwise: Record<string, number> | undefined): AhpResult {
  const n = ids.length;
  if (n === 0) return { weights: {}, lambdaMax: 0, consistencyIndex: 0, consistencyRatio: null, consistent: true };
  const A = ids.map((a) => ids.map((b) => judgement(pairwise, a, b)));
  const gm = A.map((row) => Math.pow(row.reduce((p, x) => p * x, 1), 1 / n));
  const total = gm.reduce((a, b) => a + b, 0);
  const w = gm.map((g) => g / total);
  const Aw = A.map((row) => row.reduce((acc, x, j) => acc + x * w[j]!, 0));
  const lambdaMax = Aw.reduce((acc, x, i) => acc + x / w[i]!, 0) / n;
  const ci = n > 1 ? (lambdaMax - n) / (n - 1) : 0;
  const ri = SAATY_RI[Math.min(n, SAATY_RI.length - 1)]!;
  const cr = n <= 2 || ri === 0 ? null : Math.max(0, ci) / ri;
  const weights: Record<string, number> = {};
  ids.forEach((id, i) => (weights[id] = w[i]!));
  return { weights, lambdaMax, consistencyIndex: ci, consistencyRatio: cr, consistent: cr === null || cr <= CR_THRESHOLD };
}

/** Slider position (−8 … 8) ↔ Saaty judgement (1/9 … 9). 0 = equal. Positive favours the first criterion. */
export function sliderToJudgement(v: number): number {
  const r = Math.round(Math.max(-8, Math.min(8, v)));
  return r >= 0 ? r + 1 : 1 / (1 - r);
}

export function judgementToSlider(j: number): number {
  return j >= 1 ? Math.round(j) - 1 : 1 - Math.round(1 / j);
}
