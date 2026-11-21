/**
 * Monte Carlo simulation of the projection model with uncertain investment returns.
 *
 * Return model (documented in docs/CALCULATIONS.md):
 * - The annual gross return 1 + R is log-normal with arithmetic mean E[R] = μ (the
 *   `annualReturn` assumption) and standard deviation σ (`annualVolatility`):
 *     s² = ln(1 + σ² / (1 + μ)²),   m = ln(1 + μ) − s²/2
 * - Monthly log returns are independent normals N(m/12, s²/12), so twelve months compound
 *   to the annual distribution above.
 * - With σ = 0 every path equals the deterministic projection exactly. With σ > 0 the
 *   *mean* outcome of a lump sum still matches the deterministic projection, but the
 *   *median* is lower (volatility drag) — that is a property of compounding, not a bug.
 * - Inflation, fees, tax and cash flows are deterministic and applied with exactly the same
 *   month step as the deterministic engine (`stepMonth`).
 * - All variants share the same simulated return paths (common random numbers), so the
 *   distribution of differences between alternatives isolates the effect of the decision.
 * - Results are reproducible: the same inputs and seed always give identical output.
 *
 * Limitations: returns are independent month to month (no momentum, mean reversion, fat
 * tails or regime changes); inflation is fixed. Thousands of runs make the percentiles
 * precise *for this model*, not reliable as forecasts.
 */
import type { Cents } from '@/domain/money';
import type { MonteCarloConfig, ProjectionAssumptions, ScenarioVariant } from '@/domain/types';
import { flowSchedule, monthlyFeeRate, monthlyRate, stepMonth, validateAssumptions } from './projection';
import { mulberry32, normalGenerator } from './random';
import { percentileSorted } from './stats';

export type MonteCarloSettings = Omit<MonteCarloConfig, 'enabled'>;

export const DEFAULT_MONTE_CARLO: MonteCarloSettings = { annualVolatility: 0.12, runs: 2000, seed: 20261121 };
export const MAX_RUNS = 20_000;
export const PERCENTILES = [0.1, 0.25, 0.5, 0.75, 0.9] as const;

export type PercentileSet = { p10: Cents; p25: Cents; p50: Cents; p75: Cents; p90: Cents; mean: Cents };

export interface FanPoint {
  t: number;
  real: PercentileSet;
  nominal: PercentileSet;
}

export interface VariantDistribution {
  variantId: string;
  name: string;
  /** Percentiles over time at sampled months (always includes the final month). */
  fan: FanPoint[];
  finalReal: PercentileSet;
  finalNominal: PercentileSet;
  /** Probability the final nominal balance is at or above the target (null without a target). */
  probTargetAtEnd: number | null;
  /** Probability the balance reaches the target at any month-end (null without a target). */
  probTargetAnyTime: number | null;
  /** Probability the balance ends at least one month below zero. */
  probShortfall: number;
  /** Probability the final nominal balance is below starting balance + total net cash flows. */
  probLoss: number;
  /** Sorted final real balances (for histograms). */
  finalRealSorted: Float64Array;
}

export interface PairwiseDifference {
  aId: string;
  bId: string;
  /** Percentiles of (A − B) final real balance across paths. */
  diff: PercentileSet;
  /** Share of paths in which A ends with more (real) than B. */
  probAAhead: number;
}

export interface MonteCarloResult {
  settings: MonteCarloSettings;
  runs: number;
  logParams: { monthlyMean: number; monthlySd: number };
  variants: VariantDistribution[];
  differences: PairwiseDifference[];
}

export function validateMonteCarlo(s: MonteCarloSettings): string[] {
  const errors: string[] = [];
  if (!(s.annualVolatility >= 0) || s.annualVolatility > 1) errors.push('Volatility must be between 0% and 100%.');
  if (!Number.isInteger(s.runs) || s.runs < 100 || s.runs > MAX_RUNS) errors.push(`Runs must be a whole number between 100 and ${MAX_RUNS.toLocaleString()}.`);
  if (!Number.isInteger(s.seed) || s.seed < 0 || s.seed > 0xffffffff) errors.push('Seed must be a whole number between 0 and 4294967295.');
  return errors;
}

/** Parameters of the monthly log-return normal distribution implied by μ and σ. */
export function logReturnParams(annualMean: number, annualVolatility: number): { monthlyMean: number; monthlySd: number } {
  if (annualMean <= -1) throw new Error('Annual return must be greater than −100%.');
  const s2 = Math.log(1 + (annualVolatility * annualVolatility) / ((1 + annualMean) * (1 + annualMean)));
  const m = Math.log(1 + annualMean) - s2 / 2;
  return { monthlyMean: m / 12, monthlySd: Math.sqrt(s2 / 12) };
}

function summarise(sorted: Float64Array, sum: number): PercentileSet {
  const [p10, p25, p50, p75, p90] = PERCENTILES.map((p) => Math.round(percentileSorted(sorted, p)));
  return { p10: p10!, p25: p25!, p50: p50!, p75: p75!, p90: p90!, mean: Math.round(sum / sorted.length) };
}

/** Month offsets at which the fan chart is sampled: ~60 points max, always including the last month. */
export function sampleMonths(horizon: number, maxPoints = 60): number[] {
  const stride = Math.max(1, Math.ceil(horizon / maxPoints));
  const out: number[] = [];
  for (let t = stride - 1; t < horizon; t += stride) out.push(t);
  if (out[out.length - 1] !== horizon - 1) out.push(horizon - 1);
  return out;
}

export function simulate(
  a: ProjectionAssumptions,
  variants: Pick<ScenarioVariant, 'id' | 'name' | 'oneOffs' | 'recurring' | 'contributionDelta'>[],
  settings: MonteCarloSettings,
): MonteCarloResult {
  const errors = [...validateAssumptions(a), ...validateMonteCarlo(settings)];
  if (errors.length) throw new Error(errors.join(' '));
  if (variants.length === 0) throw new Error('Add at least one variant.');

  const { runs } = settings;
  const H = a.horizonMonths;
  const feeM = monthlyFeeRate(a.annualFee);
  const inflM = monthlyRate(a.annualInflation);
  const params = logReturnParams(a.annualReturn, settings.annualVolatility);
  const schedules = variants.map((v) => flowSchedule(a, v));
  const totalFlows = schedules.map((s) => s.reduce((x, y) => x + y, 0));
  const samples = sampleMonths(H);
  const sampleIndex = new Int32Array(H).fill(-1);
  samples.forEach((t, i) => (sampleIndex[t] = i));
  const V = variants.length;
  const S = samples.length;

  // nominal[v][sample * runs + run]
  const nominal = variants.map(() => new Float64Array(S * runs));
  const reachedAnyTime = variants.map(() => new Uint8Array(runs));
  const shortfall = variants.map(() => new Uint8Array(runs));
  const deflators = new Float64Array(H);
  for (let t = 0; t < H; t++) deflators[t] = Math.pow(1 + inflM, t + 1);

  const normal = normalGenerator(mulberry32(settings.seed));
  const monthlyRates = new Float64Array(H);
  const balances = new Float64Array(V);

  for (let r = 0; r < runs; r++) {
    // Draw one return path, shared by every variant (common random numbers).
    for (let t = 0; t < H; t++) {
      monthlyRates[t] = settings.annualVolatility === 0 ? monthlyRate(a.annualReturn) : Math.exp(params.monthlyMean + params.monthlySd * normal()) - 1;
    }
    balances.fill(a.initialBalance);
    for (let t = 0; t < H; t++) {
      const si = sampleIndex[t]!;
      for (let v = 0; v < V; v++) {
        const b = stepMonth(balances[v]!, schedules[v]![t]!, monthlyRates[t]!, feeM, a.taxRateOnReturns, a.timing).balance;
        balances[v] = b;
        if (b < 0) shortfall[v]![r] = 1;
        if (a.targetAmount !== undefined && b >= a.targetAmount) reachedAnyTime[v]![r] = 1;
        if (si >= 0) nominal[v]![si * runs + r] = b;
      }
    }
  }

  const lastSample = S - 1;
  const finalsReal: Float64Array[] = [];
  const finalsNominalRaw: Float64Array[] = [];
  const out: VariantDistribution[] = variants.map((variant, v) => {
    const fan: FanPoint[] = samples.map((t, si) => {
      const nom = nominal[v]!.slice(si * runs, (si + 1) * runs);
      let sumN = 0;
      for (const x of nom) sumN += x;
      const real = nom.map((x) => x / deflators[t]!);
      const sumR = sumN / deflators[t]!;
      nom.sort();
      real.sort();
      return { t, nominal: summarise(nom, sumN), real: summarise(real, sumR) };
    });
    const finalNom = nominal[v]!.slice(lastSample * runs, (lastSample + 1) * runs);
    finalsNominalRaw.push(finalNom);
    const finalReal = finalNom.map((x) => x / deflators[H - 1]!);
    finalsReal.push(finalReal);
    const sortedReal = finalReal.slice().sort();
    let atTarget = 0;
    let losses = 0;
    let shortfalls = 0;
    let reached = 0;
    const invested = a.initialBalance + totalFlows[v]!;
    for (let r = 0; r < runs; r++) {
      if (a.targetAmount !== undefined && finalNom[r]! >= a.targetAmount) atTarget++;
      if (finalNom[r]! < invested) losses++;
      shortfalls += shortfall[v]![r]!;
      reached += reachedAnyTime[v]![r]!;
    }
    return {
      variantId: variant.id,
      name: variant.name,
      fan,
      finalReal: fan[lastSample]!.real,
      finalNominal: fan[lastSample]!.nominal,
      probTargetAtEnd: a.targetAmount === undefined ? null : atTarget / runs,
      probTargetAnyTime: a.targetAmount === undefined ? null : reached / runs,
      probShortfall: shortfalls / runs,
      probLoss: losses / runs,
      finalRealSorted: sortedReal,
    };
  });

  const differences: PairwiseDifference[] = [];
  for (let i = 0; i < V; i++) {
    for (let j = i + 1; j < V; j++) {
      const d = new Float64Array(runs);
      let sum = 0;
      let ahead = 0;
      for (let r = 0; r < runs; r++) {
        d[r] = finalsReal[i]![r]! - finalsReal[j]![r]!;
        sum += d[r]!;
        if (d[r]! > 0) ahead++;
      }
      d.sort();
      differences.push({ aId: variants[i]!.id, bId: variants[j]!.id, diff: summarise(d, sum), probAAhead: ahead / runs });
    }
  }
  return { settings, runs, logParams: params, variants: out, differences };
}

/** Histogram of sorted values into `bins` equal-width bins. */
export function histogram(sorted: Float64Array, bins = 30): { from: number; to: number; count: number }[] {
  if (sorted.length === 0) return [];
  // Trim the extreme 0.5% on each side so a few outliers do not flatten the chart.
  const lo = percentileSorted(sorted, 0.005);
  const hi = percentileSorted(sorted, 0.995);
  const width = hi > lo ? (hi - lo) / bins : 1;
  const out = Array.from({ length: bins }, (_, i) => ({ from: lo + i * width, to: lo + (i + 1) * width, count: 0 }));
  for (const x of sorted) {
    const i = Math.min(bins - 1, Math.max(0, Math.floor((x - lo) / width)));
    out[i]!.count++;
  }
  return out;
}
