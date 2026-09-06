// Statistical primitives for the insight detectors, built on simple-statistics
// (MIT). Kept pure and array-only so detectors stay host-free and unit-testable.

import {
  linearRegression,
  mean as ssMean,
  median as ssMedian,
  medianAbsoluteDeviation as ssMad,
  quantile,
  sampleCorrelation,
  standardDeviation as ssStd,
  sum as ssSum,
} from 'simple-statistics';

export interface Summary {
  n: number;
  sum: number;
  mean: number;
  median: number;
  /** Population standard deviation. */
  std: number;
  /** Median absolute deviation (robust spread). */
  mad: number;
  min: number;
  max: number;
  q1: number;
  q3: number;
  iqr: number;
}

export function summarize(values: number[]): Summary {
  const n = values.length;
  if (n === 0) {
    return { n: 0, sum: 0, mean: 0, median: 0, std: 0, mad: 0, min: 0, max: 0, q1: 0, q3: 0, iqr: 0 };
  }
  const median = ssMedian(values);
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  return {
    n,
    sum: ssSum(values),
    mean: ssMean(values),
    median,
    std: ssStd(values),
    mad: ssMad(values),
    min: Math.min(...values),
    max: Math.max(...values),
    q1,
    q3,
    iqr: q3 - q1,
  };
}

/**
 * Modified (robust) z-score: 0.6745·(x−median)/MAD. Resistant to the very
 * outliers we're trying to find, unlike a mean/σ z-score. Falls back to the
 * classic z-score when MAD is 0 (e.g. many tied values).
 */
export function modifiedZ(x: number, s: Summary): number {
  if (s.mad > 0) return (0.6745 * (x - s.median)) / s.mad;
  if (s.std > 0) return (x - s.mean) / s.std;
  return 0;
}

/** Gini coefficient (0 = perfectly even, →1 = concentrated). Non-negative inputs. */
export function gini(values: number[]): number {
  const v = values.filter((x) => x >= 0).slice().sort((a, b) => a - b);
  const n = v.length;
  const total = v.reduce((a, b) => a + b, 0);
  if (n === 0 || total === 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (2 * (i + 1) - n - 1) * v[i];
  return cum / (n * total);
}

/** How many of the top-ranked items make up `frac` of the total (Pareto count). */
export function topCountForShare(descValues: number[], frac: number): number {
  const total = descValues.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) return descValues.length;
  let acc = 0;
  for (let i = 0; i < descValues.length; i++) {
    acc += Math.max(0, descValues[i]);
    if (acc / total >= frac) return i + 1;
  }
  return descValues.length;
}

export interface Fit {
  slope: number;
  intercept: number;
  /** Coefficient of determination R². */
  r2: number;
  /** Pearson correlation r (signed). */
  r: number;
}

/** Least-squares fit of ys on xs, with R² and signed correlation. */
export function fit(xs: number[], ys: number[]): Fit {
  const pairs = xs.map((x, i) => [x, ys[i]] as [number, number]);
  const { m, b } = linearRegression(pairs);
  const r = pairs.length >= 2 ? safeCorr(xs, ys) : 0;
  return { slope: m, intercept: b, r2: r * r, r };
}

function safeCorr(xs: number[], ys: number[]): number {
  const r = sampleCorrelation(xs, ys);
  return Number.isFinite(r) ? r : 0;
}

export function residual(f: Fit, x: number, y: number): number {
  return y - (f.slope * x + f.intercept);
}

/**
 * Largest gap between consecutive values in a descending list. Returns the index
 * of the value ABOVE the gap and the gap size, or null if fewer than 2 values.
 */
export function biggestGap(descValues: number[]): { index: number; gap: number } | null {
  if (descValues.length < 2) return null;
  let idx = 0;
  let best = -Infinity;
  for (let i = 0; i < descValues.length - 1; i++) {
    const g = descValues[i] - descValues[i + 1];
    if (g > best) {
      best = g;
      idx = i;
    }
  }
  return { index: idx, gap: best };
}
