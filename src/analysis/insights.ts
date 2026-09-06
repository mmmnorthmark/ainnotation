// Insight generators: turn a NormalizedTable into ranked, rich AnnotationCandidates.
//
// Each generator is pure (table in → candidates out), so the whole engine is
// unit-tested without a live Tableau host. The Tableau glue (src/tableau) only
// has to (a) hand us a normalized table and (b) write back the candidate text.
//
// Richness lives in the TEXT: every annotation names what it is, shows the mark's
// own formatted value, and adds context the chart doesn't show on its own — rank,
// robust deviation, concentration (Gini/Pareto), regression trend + R², level
// shifts, breakaway gaps, and off-trend residuals across a measure pair.

import {
  formatNumber,
  formatPct,
  formatSignedNumber,
  formatSignedPct,
  rankOf,
} from './format';
import {
  biggestGap,
  fit,
  gini,
  modifiedZ,
  residual,
  summarize,
  topCountForShare,
  type Summary,
} from './stats';
import {
  type AnnotationCandidate,
  type InsightKind,
  type NarrationFacts,
  type NormalizedTable,
  type NormColumn,
} from './types';
import { label, markValue, target, valueAt } from './marks';

export interface AnalyzeOptions {
  /** Absolute (robust) z-score at/above which a mark is flagged an outlier (default 2). */
  outlierZ?: number;
  /** Maximum number of candidates returned, highest score first (default 16). */
  limit?: number;
  /** Minimum |correlation| for an off-trend (residual) insight to be offered (default 0.5). */
  corrMin?: number;
}

interface MeasureStats {
  /** Finite native values, and the original row index each came from. */
  values: number[];
  rowIdx: number[];
  n: number;
  sum: number;
  mean: number;
  /** Population standard deviation. */
  std: number;
  /** Robust summary (median, MAD, quartiles, IQR) over the same values. */
  summary: Summary;
  allNonNegative: boolean;
  maxRow: number;
  minRow: number;
  maxVal: number;
  minVal: number;
  /** rank[rowIndex] = 0-based position in the descending value order. */
  rank: Map<number, number>;
  /** Rows sorted by descending value: [{ row, v }]. */
  descOrder: { row: number; v: number }[];
}

/** Analyze a normalized table and return ranked annotation candidates. */
export function analyze(table: NormalizedTable, opts: AnalyzeOptions = {}): AnnotationCandidate[] {
  const outlierZ = opts.outlierZ ?? 2;
  const limit = opts.limit ?? 16;
  const corrMin = opts.corrMin ?? 0.5;

  const out: AnnotationCandidate[] = [];
  for (const measure of table.measures) {
    const stats = computeStats(table, measure);
    if (stats.n === 0) continue;

    out.push(...peakAndLow(table, measure, stats));
    out.push(...outliers(table, measure, stats, outlierZ));
    out.push(...share(table, measure, stats));
    out.push(...gap(table, measure, stats));
    out.push(...trendAndMover(table, measure, stats));
    out.push(...changepoint(table, measure, stats));
  }
  // Cross-measure: off-trend residuals for the most-correlated measure pair.
  out.push(...offTrend(table, corrMin));

  // Stable de-dup by id, then rank by interest.
  const byId = new Map<string, AnnotationCandidate>();
  for (const c of out) if (!byId.has(c.id)) byId.set(c.id, c);
  return [...byId.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

// ---- generators ---------------------------------------------------------

function peakAndLow(
  table: NormalizedTable,
  measure: NormColumn,
  s: MeasureStats,
): AnnotationCandidate[] {
  const res: AnnotationCandidate[] = [];
  const zMax = z(s.maxVal, s);
  res.push(
    make(table, measure, 'max', s.maxRow, {
      title: `Peak — ${label(table, s.maxRow)}`,
      text: join(
        `▲ PEAK · ${measure.fieldName}`,
        `${label(table, s.maxRow)}: ${markValue(table, measure, s.maxRow)}`,
        `${rankOf(0)} of ${s.n}${vsAvg(s.maxVal, s)}${sigma(zMax)}`,
      ),
      score: 75 + clamp(Math.abs(zMax), 0, 6) * 3,
      facts: {
        measure: measure.fieldName,
        label: label(table, s.maxRow),
        value: markValue(table, measure, s.maxRow),
        rank: 1,
        count: s.n,
        ...avgFacts(s.maxVal, s),
      },
    }),
  );
  // A single-row table has no distinct low point.
  if (s.n >= 2 && s.minRow !== s.maxRow) {
    const zMin = z(s.minVal, s);
    res.push(
      make(table, measure, 'min', s.minRow, {
        title: `Low point — ${label(table, s.minRow)}`,
        text: join(
          `▼ LOW · ${measure.fieldName}`,
          `${label(table, s.minRow)}: ${markValue(table, measure, s.minRow)}`,
          `${rankOf(s.n - 1)} of ${s.n}${vsAvg(s.minVal, s)}`,
        ),
        score: 55 + clamp(Math.abs(zMin), 0, 6) * 3,
        facts: {
          measure: measure.fieldName,
          label: label(table, s.minRow),
          value: markValue(table, measure, s.minRow),
          rank: s.n,
          count: s.n,
          ...avgFacts(s.minVal, s),
        },
      }),
    );
  }
  return res;
}

/**
 * Marks (beyond the peak/low) that sit ≥ outlierZ from the center. Detection uses
 * the robust modified z-score (median/MAD), which resists being masked by the very
 * outliers it looks for; the text still reports the familiar σ-from-mean and the
 * Tukey IQR fence so the number is interpretable.
 */
function outliers(
  table: NormalizedTable,
  measure: NormColumn,
  s: MeasureStats,
  outlierZ: number,
): AnnotationCandidate[] {
  if (s.n < 4 || (s.summary.mad === 0 && s.std === 0)) return [];
  const fenceHi = s.summary.q3 + 1.5 * s.summary.iqr;
  const fenceLo = s.summary.q1 - 1.5 * s.summary.iqr;
  let hi: { row: number; rz: number; v: number } | null = null;
  let lo: { row: number; rz: number; v: number } | null = null;
  for (let i = 0; i < s.values.length; i++) {
    const row = s.rowIdx[i];
    if (row === s.maxRow || row === s.minRow) continue; // peak/low already told
    const v = s.values[i];
    const rz = modifiedZ(v, s.summary);
    if (rz >= outlierZ && (!hi || rz > hi.rz)) hi = { row, rz, v };
    if (rz <= -outlierZ && (!lo || rz < lo.rz)) lo = { row, rz, v };
  }
  const res: AnnotationCandidate[] = [];
  if (hi) {
    res.push(
      make(table, measure, 'outlier-high', hi.row, {
        title: `High outlier — ${label(table, hi.row)}`,
        text: join(
          `◆ OUTLIER · ${measure.fieldName}`,
          `${label(table, hi.row)}: ${markValue(table, measure, hi.row)}`,
          `${z(hi.v, s).toFixed(1)}σ above the ${formatNumber(s.mean)} average`,
          `beyond the ${formatNumber(fenceHi)} upper fence (Q3+1.5·IQR)`,
        ),
        score: 90 + clamp(hi.rz, 0, 6) * 5,
        facts: {
          measure: measure.fieldName,
          label: label(table, hi.row),
          value: markValue(table, measure, hi.row),
          sigma: Math.abs(z(hi.v, s)),
          avg: formatNumber(s.mean),
          fence: formatNumber(fenceHi),
          direction: 'above',
        },
      }),
    );
  }
  if (lo) {
    res.push(
      make(table, measure, 'outlier-low', lo.row, {
        title: `Low outlier — ${label(table, lo.row)}`,
        text: join(
          `◇ OUTLIER · ${measure.fieldName}`,
          `${label(table, lo.row)}: ${markValue(table, measure, lo.row)}`,
          `${Math.abs(z(lo.v, s)).toFixed(1)}σ below the ${formatNumber(s.mean)} average`,
          `below the ${formatNumber(fenceLo)} lower fence (Q1−1.5·IQR)`,
        ),
        score: 90 + clamp(Math.abs(lo.rz), 0, 6) * 5,
        facts: {
          measure: measure.fieldName,
          label: label(table, lo.row),
          value: markValue(table, measure, lo.row),
          sigma: Math.abs(z(lo.v, s)),
          avg: formatNumber(s.mean),
          fence: formatNumber(fenceLo),
          direction: 'below',
        },
      }),
    );
  }
  return res;
}

/**
 * Concentration: the top contributor's share of the total, plus how skewed the
 * whole distribution is (Gini) and how many items make up 80% (Pareto).
 */
function share(
  table: NormalizedTable,
  measure: NormColumn,
  s: MeasureStats,
): AnnotationCandidate[] {
  if (s.n < 3 || !s.allNonNegative || s.sum <= 0) return [];
  const frac = s.maxVal / s.sum;
  if (frac < 0.15) return []; // evenly spread — not a story
  const g = gini(s.values);
  const descValues = s.descOrder.map((o) => o.v);
  const paretoN = topCountForShare(descValues, 0.8);
  return [
    make(table, measure, 'share', s.maxRow, {
      title: `${formatPct(frac)} of total — ${label(table, s.maxRow)}`,
      text: join(
        `◕ TOP CONTRIBUTOR · ${measure.fieldName}`,
        `${label(table, s.maxRow)}: ${markValue(table, measure, s.maxRow)}`,
        `${formatPct(frac)} of the total across ${s.n} categories`,
        `top ${paretoN} make up 80% · Gini ${g.toFixed(2)}`,
      ),
      score: 60 + frac * 40,
      facts: {
        measure: measure.fieldName,
        label: label(table, s.maxRow),
        value: markValue(table, measure, s.maxRow),
        sharePct: formatPct(frac),
        count: s.n,
        paretoN,
        gini: g.toFixed(2),
      },
    }),
  ];
}

/**
 * Breakaway gap: a single dominant cliff in the ranked (categorical) distribution
 * — a leader or a leading cluster separated from the pack. Skipped for time series
 * (that's what trend/mover/changepoint are for).
 */
function gap(table: NormalizedTable, measure: NormColumn, s: MeasureStats): AnnotationCandidate[] {
  if (isSingleOrderedAxis(table)) return []; // time series → not a "gap" story
  if (table.dimensions.length === 0 || s.n < 6) return [];
  const descValues = s.descOrder.map((o) => o.v);
  const g = biggestGap(descValues);
  if (!g) return [];
  const range = s.maxVal - s.minVal;
  if (range <= 0) return [];
  // Notable only if it's a clear single cliff: a big fraction of the range AND
  // much larger than the typical gap between neighbors.
  const otherGaps: number[] = [];
  for (let i = 0; i < descValues.length - 1; i++) {
    if (i === g.index) continue;
    otherGaps.push(descValues[i] - descValues[i + 1]);
  }
  const meanOther = otherGaps.length ? otherGaps.reduce((a, b) => a + b, 0) / otherGaps.length : 0;
  if (g.gap < 0.2 * range || g.gap < 2 * meanOther) return [];

  const aboveRow = s.descOrder[g.index].row; // last of the leading group
  const belowRow = s.descOrder[g.index + 1].row; // first of the pack
  const leaders = g.index + 1;
  return [
    make(table, measure, 'gap', aboveRow, {
      title: `Breakaway — ${formatSignedNumber(g.gap)} gap`,
      text: join(
        `⋮ BREAKAWAY GAP · ${measure.fieldName}`,
        `${label(table, aboveRow)}: ${markValue(table, measure, aboveRow)}`,
        leaders === 1
          ? `${formatNumber(g.gap)} clear of #2 ${label(table, belowRow)}`
          : `top ${leaders} break away — ${formatNumber(g.gap)} down to the pack`,
      ),
      score: 62 + clamp(g.gap / range, 0, 1) * 20,
      facts: {
        measure: measure.fieldName,
        label: label(table, aboveRow),
        value: markValue(table, measure, aboveRow),
        gapValue: formatNumber(g.gap),
        leaders,
        nextLabel: label(table, belowRow),
      },
    }),
  ];
}

/** Trend (net change + linear fit R²) and biggest single-step move along an ordered axis. */
function trendAndMover(
  table: NormalizedTable,
  measure: NormColumn,
  s: MeasureStats,
): AnnotationCandidate[] {
  if (!isSingleOrderedAxis(table)) return [];
  if (s.n < 3) return [];
  const axis = table.dimensions[0];
  const seq = orderedSeq(table, measure, axis, s);
  if (seq.length < 3) return [];

  const first = seq[0];
  const last = seq[seq.length - 1];
  const res: AnnotationCandidate[] = [];

  if (first.val !== 0) {
    const change = (last.val - first.val) / Math.abs(first.val);
    const rising = change >= 0;
    // Linear fit over the ordinal position, for a "how steady is the trend" R².
    const f = fit(
      seq.map((_, i) => i),
      seq.map((p) => p.val),
    );
    res.push(
      make(table, measure, 'trend', last.row, {
        title: `${measure.fieldName} ${rising ? 'up' : 'down'} ${formatSignedPct(change)}`,
        text: join(
          `${rising ? '↗' : '↘'} ${measure.fieldName} ${rising ? 'rose' : 'fell'} ${formatSignedPct(change)}`,
          `${label(table, first.row)} → ${label(table, last.row)}`,
          `${markValue(table, measure, first.row)} → ${markValue(table, measure, last.row)}`,
          `linear fit R² ${f.r2.toFixed(2)} over ${seq.length} points`,
        ),
        score: 80 + clamp(Math.abs(change), 0, 3) * 10,
        facts: {
          measure: measure.fieldName,
          label: label(table, last.row),
          rising,
          pct: formatSignedPct(change),
          fromLabel: label(table, first.row),
          toLabel: label(table, last.row),
          fromVal: markValue(table, measure, first.row),
          toVal: markValue(table, measure, last.row),
          r2: f.r2.toFixed(2),
          points: seq.length,
        },
      }),
    );
  }

  // Largest consecutive step.
  let best = { i: 1, delta: 0 };
  for (let i = 1; i < seq.length; i++) {
    const d = seq[i].val - seq[i - 1].val;
    if (Math.abs(d) > Math.abs(best.delta)) best = { i, delta: d };
  }
  if (best.delta !== 0) {
    const from = seq[best.i - 1];
    const to = seq[best.i];
    const pct = from.val !== 0 ? best.delta / Math.abs(from.val) : NaN;
    res.push(
      make(table, measure, 'mover', to.row, {
        title: `Biggest move — ${formatSignedNumber(best.delta)}`,
        text: join(
          `⇅ BIGGEST MOVE · ${measure.fieldName}`,
          `${label(table, from.row)} → ${label(table, to.row)}`,
          `${formatSignedNumber(best.delta)}${Number.isFinite(pct) ? ` (${formatSignedPct(pct)})` : ''}`,
        ),
        score: 70 + clamp(Math.abs(Number.isFinite(pct) ? pct : 0), 0, 3) * 8,
        facts: {
          measure: measure.fieldName,
          label: label(table, to.row),
          fromLabel: label(table, from.row),
          toLabel: label(table, to.row),
          delta: formatSignedNumber(best.delta),
          pct: Number.isFinite(pct) ? formatSignedPct(pct) : undefined,
        },
      }),
    );
  }
  return res;
}

/**
 * Level shift (changepoint): the ordinal split that best separates the series into
 * a low-mean and high-mean regime. A CUSUM-style scan weighted toward balanced,
 * strong shifts; only fired when the shift clears ~1.5·MAD of noise.
 */
function changepoint(
  table: NormalizedTable,
  measure: NormColumn,
  s: MeasureStats,
): AnnotationCandidate[] {
  if (!isSingleOrderedAxis(table) || s.n < 6) return [];
  const axis = table.dimensions[0];
  const seq = orderedSeq(table, measure, axis, s);
  const n = seq.length;
  if (n < 6) return [];
  const vals = seq.map((p) => p.val);

  let best = { i: -1, score: -Infinity, before: 0, after: 0 };
  let prefix = 0;
  const total = vals.reduce((a, b) => a + b, 0);
  for (let i = 1; i < n; i++) {
    prefix += vals[i - 1];
    if (i < 2 || i > n - 2) continue; // need ≥2 points each side
    const before = prefix / i;
    const after = (total - prefix) / (n - i);
    const w = Math.sqrt((i * (n - i)) / n);
    const sc = Math.abs(after - before) * w;
    if (sc > best.score) best = { i, score: sc, before, after };
  }
  if (best.i < 0) return [];
  const shift = best.after - best.before;
  const noise = s.summary.mad > 0 ? s.summary.mad : s.std;
  if (noise > 0 && Math.abs(shift) < 1.5 * noise) return [];
  if (noise === 0) return [];

  const at = seq[best.i]; // first point of the new regime
  const rising = shift >= 0;
  return [
    make(table, measure, 'changepoint', at.row, {
      title: `Level shift — ${label(table, at.row)}`,
      text: join(
        `Δ LEVEL SHIFT · ${measure.fieldName}`,
        `${rising ? 'stepped up' : 'stepped down'} at ${label(table, at.row)}`,
        `~${formatNumber(best.before)} → ~${formatNumber(best.after)} (${formatSignedNumber(shift)})`,
      ),
      score: 68 + clamp(Math.abs(shift) / (noise || 1), 0, 8) * 3,
      facts: {
        measure: measure.fieldName,
        label: label(table, at.row),
        rising,
        before: formatNumber(best.before),
        after: formatNumber(best.after),
        delta: formatSignedNumber(shift),
      },
    }),
  ];
}

/**
 * Off-trend residual: for the most strongly correlated measure pair, the mark that
 * sits furthest from the fitted line — the point that "breaks the relationship".
 * This is the scatterplot story summary data alone can't show.
 */
function offTrend(table: NormalizedTable, corrMin: number): AnnotationCandidate[] {
  if (table.measures.length < 2 || table.dimensions.length === 0) return [];

  // Pick the measure pair with the strongest |correlation| over rows where both
  // measures are finite.
  let bestPair: {
    x: NormColumn;
    y: NormColumn;
    rows: number[];
    xs: number[];
    ys: number[];
    absR: number;
  } | null = null;
  for (let a = 0; a < table.measures.length; a++) {
    for (let b = a + 1; b < table.measures.length; b++) {
      const mx = table.measures[a];
      const my = table.measures[b];
      const rows: number[] = [];
      const xs: number[] = [];
      const ys: number[] = [];
      table.rows.forEach((r, i) => {
        const xv = r.cells[mx.index]?.native;
        const yv = r.cells[my.index]?.native;
        if (xv != null && yv != null && Number.isFinite(xv) && Number.isFinite(yv)) {
          rows.push(i);
          xs.push(xv);
          ys.push(yv);
        }
      });
      if (rows.length < 5) continue;
      const f = fit(xs, ys);
      if (!bestPair || Math.abs(f.r) > bestPair.absR) {
        bestPair = { x: mx, y: my, rows, xs, ys, absR: Math.abs(f.r) };
      }
    }
  }
  if (!bestPair || bestPair.absR < corrMin) return [];

  const f = fit(bestPair.xs, bestPair.ys);
  const resids = bestPair.rows.map((_, k) => residual(f, bestPair!.xs[k], bestPair!.ys[k]));
  const rs = summarize(resids);
  let worst = { k: -1, rz: 0, resid: 0 };
  for (let k = 0; k < resids.length; k++) {
    const rz = modifiedZ(resids[k], rs);
    if (Math.abs(rz) > Math.abs(worst.rz)) worst = { k, rz, resid: resids[k] };
  }
  if (worst.k < 0 || Math.abs(worst.rz) < 2) return [];

  const row = bestPair.rows[worst.k];
  const predicted = f.slope * bestPair.xs[worst.k] + f.intercept;
  const above = worst.resid >= 0;
  return [
    makeFor(table, bestPair.y.fieldName, 'off-trend', row, {
      title: `Off-trend — ${label(table, row)}`,
      text: join(
        `⊘ OFF-TREND · ${bestPair.y.fieldName} vs ${bestPair.x.fieldName}`,
        `${label(table, row)}: ${markValue(table, bestPair.y, row)}`,
        `${above ? 'above' : 'below'} the line by ${formatNumber(Math.abs(worst.resid))} (predicted ${formatNumber(predicted)})`,
        `pair r ${f.r.toFixed(2)} · R² ${f.r2.toFixed(2)}`,
      ),
      score: 78 + clamp(Math.abs(worst.rz), 0, 6) * 4,
      facts: {
        measure: bestPair.y.fieldName,
        label: label(table, row),
        value: markValue(table, bestPair.y, row),
        otherMeasure: bestPair.x.fieldName,
        above,
        residual: formatNumber(Math.abs(worst.resid)),
        predicted: formatNumber(predicted),
        r: f.r.toFixed(2),
      },
    }),
  ];
}

// ---- helpers ------------------------------------------------------------

function computeStats(table: NormalizedTable, measure: NormColumn): MeasureStats {
  const values: number[] = [];
  const rowIdx: number[] = [];
  table.rows.forEach((r, i) => {
    const v = r.cells[measure.index]?.native;
    if (v !== null && v !== undefined && Number.isFinite(v)) {
      values.push(v);
      rowIdx.push(i);
    }
  });
  const n = values.length;
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = n ? sum / n : 0;
  const variance = n ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / n : 0;
  const std = Math.sqrt(variance);

  let maxRow = -1;
  let minRow = -1;
  let maxVal = -Infinity;
  let minVal = Infinity;
  for (let i = 0; i < n; i++) {
    if (values[i] > maxVal) ((maxVal = values[i]), (maxRow = rowIdx[i]));
    if (values[i] < minVal) ((minVal = values[i]), (minRow = rowIdx[i]));
  }

  // Descending value order (rows), and the per-row rank derived from it.
  const descOrder = rowIdx.map((row, i) => ({ row, v: values[i] })).sort((a, b) => b.v - a.v);
  const rank = new Map<number, number>();
  descOrder.forEach((o, i) => rank.set(o.row, i));

  return {
    values,
    rowIdx,
    n,
    sum,
    mean,
    std,
    summary: summarize(values),
    allNonNegative: values.every((v) => v >= 0),
    maxRow,
    minRow,
    maxVal,
    minVal,
    rank,
    descOrder,
  };
}

/** True when the table has exactly one dimension and it is an ordered (date) axis. */
function isSingleOrderedAxis(table: NormalizedTable): boolean {
  return table.dimensions.length === 1 && table.dimensions[0].ordered;
}

/** Rows ordered along the axis (date-parsed, text fallback), with finite values only. */
function orderedSeq(
  table: NormalizedTable,
  measure: NormColumn,
  axis: NormColumn,
  s: MeasureStats,
): { row: number; key: number | string; val: number }[] {
  return s.rowIdx
    .map((row) => ({ row, key: sortKey(table, axis, row), val: valueAt(table, measure, row) }))
    .filter((p): p is { row: number; key: number | string; val: number } => p.val !== null)
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

interface Parts {
  title: string;
  text: string;
  score: number;
  facts?: NarrationFacts;
}

function make(
  table: NormalizedTable,
  measure: NormColumn,
  kind: InsightKind,
  rowIndex: number,
  parts: Parts,
): AnnotationCandidate {
  return makeFor(table, measure.fieldName, kind, rowIndex, parts);
}

function makeFor(
  table: NormalizedTable,
  measureName: string,
  kind: InsightKind,
  rowIndex: number,
  parts: Parts,
): AnnotationCandidate {
  return {
    id: `${kind}:${measureName}:${rowIndex}`,
    kind,
    measure: measureName,
    rowIndex,
    target: target(table, rowIndex),
    label: label(table, rowIndex),
    title: parts.title,
    text: parts.text,
    score: Math.round(parts.score * 10) / 10,
    facts: parts.facts,
  };
}

function sortKey(table: NormalizedTable, axis: NormColumn, rowIndex: number): number | string {
  const raw = table.rows[rowIndex].cells[axis.index].value;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? raw : t;
}

function z(v: number, s: MeasureStats): number {
  return s.std > 0 ? (v - s.mean) / s.std : 0;
}

/** " · +41% vs avg", or "" when the mean is zero (ratio undefined). */
function vsAvg(v: number, s: MeasureStats): string {
  if (s.mean === 0) return '';
  return ` · ${formatSignedPct((v - s.mean) / Math.abs(s.mean))} vs avg`;
}

/** Narration facts for "vs the average", omitted when the mean is 0 (ratio undefined). */
function avgFacts(v: number, s: MeasureStats): { vsAvgPct?: string; avg?: string } {
  if (s.mean === 0) return {};
  return { vsAvgPct: formatSignedPct((v - s.mean) / Math.abs(s.mean)), avg: formatNumber(s.mean) };
}

function sigma(zScore: number): string {
  return Math.abs(zScore) >= 2 ? ` · ${zScore.toFixed(1)}σ` : '';
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function join(...lines: string[]): string {
  return lines.join('\n');
}
