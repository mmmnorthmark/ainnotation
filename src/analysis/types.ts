// Shared types for the analysis engine.
//
// The engine works over a NORMALIZED table (below), not the raw Extensions-API
// DataTable, so the insight generators are pure and unit-testable without a live
// Tableau host. src/tableau/worksheet.ts adapts a real DataTable into this shape.

export type FieldRole = 'dimension' | 'measure';

/** Tableau Extensions API column data types (open string for forward-compat). */
export type TableauDataType =
  | 'float'
  | 'integer'
  | 'string'
  | 'bool'
  | 'date'
  | 'date-time'
  | 'spatial'
  | (string & {});

export interface NormColumn {
  fieldName: string;
  dataType: TableauDataType;
  role: FieldRole;
  /** Column index within the source table row. */
  index: number;
  /** True for date/date-time dimensions — usable as an ordered (trend) axis. */
  ordered: boolean;
}

export interface NormCell {
  /** Raw underlying value, stringified. */
  value: string;
  /** Formatted display value — what the mark shows in the viz. */
  formatted: string;
  /** Numeric native value for measure cells; null for non-numeric. */
  native: number | null;
}

export interface NormRow {
  /** Cells aligned 1:1 with `NormalizedTable.columns`. */
  cells: NormCell[];
}

export interface NormalizedTable {
  columns: NormColumn[];
  rows: NormRow[];
  /** Convenience views (subsets of `columns`). */
  dimensions: NormColumn[];
  measures: NormColumn[];
}

/** A dimension field + value pair used to select the target mark. */
export interface FieldValue {
  fieldName: string;
  value: string;
  /**
   * The dimension's Tableau data type. Carried so the select-by-value apply path
   * can send a real `Date` for date/date-time fields — the Extensions API only
   * matches date marks when given a `Date` instance, not a stringified date.
   */
  dataType?: TableauDataType;
}

export type InsightKind =
  | 'max'
  | 'min'
  | 'outlier-high'
  | 'outlier-low'
  | 'share'
  | 'gap'
  | 'trend'
  | 'mover'
  | 'changepoint'
  | 'off-trend'
  // Reactive selection: a mark the user picked in the viz, described in context.
  | 'mark';

/**
 * Structured, already-formatted facts behind a candidate, consumed by the RosaeNLG
 * narrator (src/analysis/narrate.ts) to compose flowing prose. Every numeric field
 * is a pre-formatted STRING (via format.ts) so the narrator never re-touches a
 * number — RosaeNLG only supplies grammar, synonym variety, and typography.
 */
export interface NarrationFacts {
  measure: string;
  label: string;
  /** The mark's own formatted value. */
  value?: string;
  // Ranking / distribution
  rank?: number;
  count?: number;
  /** Signed % vs the average, e.g. "+41%" (omitted when the mean is 0). */
  vsAvgPct?: string;
  avg?: string;
  /** Absolute classic z-score, for "N.Nσ" phrasing. */
  sigma?: number;
  fence?: string;
  direction?: 'above' | 'below';
  sharePct?: string;
  paretoN?: number;
  gini?: string;
  // Breakaway gap
  gapValue?: string;
  leaders?: number;
  nextLabel?: string;
  // Ordered series
  rising?: boolean;
  pct?: string;
  fromLabel?: string;
  toLabel?: string;
  fromVal?: string;
  toVal?: string;
  r2?: string;
  points?: number;
  delta?: string;
  before?: string;
  after?: string;
  // Cross-measure correlation
  otherMeasure?: string;
  /** True when the mark sits above the fitted line (else below). */
  above?: boolean;
  residual?: string;
  predicted?: string;
  r?: string;
}

export interface AnnotationCandidate {
  /** Stable id (kind + measure + rowIndex) so UI selection survives re-render. */
  id: string;
  kind: InsightKind;
  /** Measure this insight is about. */
  measure: string;
  /** Row in the normalized table the annotation attaches to. */
  rowIndex: number;
  /** Dimension field/value pairs identifying the mark to annotate. */
  target: FieldValue[];
  /** Short human label of the target mark, e.g. "Technology · West". */
  label: string;
  /** Headline line of the annotation. */
  title: string;
  /** Full annotation body written to the mark (may contain newlines). */
  text: string;
  /** Interest ranking; higher sorts first and is default-selected. */
  score: number;
  /** Structured facts for narration; the deterministic `text` above is the fallback. */
  facts?: NarrationFacts;
  /**
   * Reactive-selection marks carry the live mark's `tupleId`, so apply annotates
   * it directly via `annotateMarkAsync` — no select-by-value round trip. Absent on
   * proposed (analyzed) candidates, which resolve their mark by dimension values.
   */
  tupleId?: number;
}

/** Human-readable descriptors for each insight kind (UI grouping / icons). */
export const KIND_META: Record<InsightKind, { label: string; glyph: string }> = {
  max: { label: 'Peak', glyph: '▲' },
  min: { label: 'Low point', glyph: '▼' },
  'outlier-high': { label: 'High outlier', glyph: '◆' },
  'outlier-low': { label: 'Low outlier', glyph: '◇' },
  share: { label: 'Top contributor', glyph: '◕' },
  gap: { label: 'Breakaway', glyph: '⋮' },
  trend: { label: 'Trend', glyph: '↗' },
  mover: { label: 'Biggest move', glyph: '⇅' },
  changepoint: { label: 'Level shift', glyph: 'Δ' },
  'off-trend': { label: 'Off-trend', glyph: '⊘' },
  mark: { label: 'Selected mark', glyph: '⌖' },
};
