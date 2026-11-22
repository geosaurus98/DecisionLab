/** Small, dependency-free statistics helpers used across the engines. */

export function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Sample standard deviation (n − 1). Returns 0 for fewer than two values. */
export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Percentile using linear interpolation between closest ranks (Hyndman & Fan type 7,
 * the default in NumPy and Excel PERCENTILE.INC). `p` is in [0, 1].
 * `sorted` must be sorted ascending.
 */
export function percentileSorted(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (p <= 0) return sorted[0]!;
  if (p >= 1) return sorted[n - 1]!;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (h - lo) * (b - a);
}

export function percentile(values: number[], p: number): number {
  return percentileSorted([...values].sort((a, b) => a - b), p);
}

export function median(values: number[]): number {
  return percentile(values, 0.5);
}

/** Median absolute deviation (unscaled). */
export function mad(values: number[]): number {
  if (values.length === 0) return NaN;
  const m = median(values);
  return median(values.map((v) => Math.abs(v - m)));
}

/** Ranks (1-based) with ties given their average rank. */
export function ranks(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k]![1]] = avg;
    i = j + 1;
  }
  return out;
}

/** Pearson correlation; null if either variable is constant or n < 3. */
export function pearson(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n < 3 || y.length !== n) return null;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sxx += (x[i]! - mx) ** 2;
    syy += (y[i]! - my) ** 2;
  }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
}

/** Spearman rank correlation (Pearson on tie-averaged ranks). */
export function spearman(x: number[], y: number[]): number | null {
  return pearson(ranks(x), ranks(y));
}
