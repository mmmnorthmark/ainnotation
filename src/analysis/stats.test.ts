import { describe, expect, it } from 'vitest';
import {
  biggestGap,
  fit,
  gini,
  modifiedZ,
  residual,
  summarize,
  topCountForShare,
} from './stats';

describe('summarize', () => {
  it('reports robust and classic spread together', () => {
    const s = summarize([1, 2, 3, 4, 5]);
    expect(s.n).toBe(5);
    expect(s.sum).toBe(15);
    expect(s.mean).toBe(3);
    expect(s.median).toBe(3);
    expect(s.min).toBe(1);
    expect(s.max).toBe(5);
    expect(s.iqr).toBeGreaterThan(0);
  });

  it('is safe on an empty array', () => {
    expect(summarize([]).n).toBe(0);
  });
});

describe('modifiedZ', () => {
  it('uses median/MAD and resists masking by outliers', () => {
    const s = summarize([10, 11, 12, 13, 100]);
    // The 100 should read as a strong robust outlier.
    expect(modifiedZ(100, s)).toBeGreaterThan(3.5);
    // A central point stays near zero.
    expect(Math.abs(modifiedZ(12, s))).toBeLessThan(1);
  });

  it('falls back to the classic z-score when MAD is 0', () => {
    const s = summarize([0, 0, 0, 0, 50]);
    expect(s.mad).toBe(0);
    expect(modifiedZ(50, s)).toBeGreaterThan(0);
  });
});

describe('gini + Pareto', () => {
  it('is ~0 for a flat distribution and high for a concentrated one', () => {
    expect(gini([10, 10, 10, 10])).toBeCloseTo(0, 5);
    expect(gini([0, 0, 0, 100])).toBeGreaterThan(0.6);
  });

  it('counts how many top items make up a share', () => {
    expect(topCountForShare([90, 5, 3, 2], 0.8)).toBe(1);
    expect(topCountForShare([25, 25, 25, 25], 0.8)).toBe(4);
  });
});

describe('fit + residual', () => {
  it('recovers a clean linear relationship with R² ≈ 1', () => {
    const xs = [1, 2, 3, 4, 5];
    const ys = [3, 5, 7, 9, 11]; // y = 2x + 1
    const f = fit(xs, ys);
    expect(f.slope).toBeCloseTo(2, 6);
    expect(f.intercept).toBeCloseTo(1, 6);
    expect(f.r2).toBeCloseTo(1, 6);
    expect(residual(f, 3, 7)).toBeCloseTo(0, 6);
  });
});

describe('biggestGap', () => {
  it('finds the widest cliff in a descending list', () => {
    const g = biggestGap([100, 95, 90, 20, 10])!;
    expect(g.index).toBe(2); // between 90 and 20
    expect(g.gap).toBe(70);
  });

  it('returns null for fewer than two values', () => {
    expect(biggestGap([5])).toBeNull();
  });
});
