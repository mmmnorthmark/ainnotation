// Reactive-selection describer: given the marks the user selected in the viz,
// build one rich `AnnotationCandidate` per mark describing it IN CONTEXT of the
// whole sheet (rank, vs-average, σ). Pure over NormalizedTables so it unit-tests
// without a live host; the tableau glue (src/tableau/selection.ts) reads the live
// selection and hands us the analyzed full-sheet table + the selected subset.
//
// Each selected mark is matched back to a row of the full sheet by its dimension
// values, so the numbers compare against the FULL distribution. A mark that can't
// be matched (e.g. a different aggregation) is still described from its own value,
// just without the distribution context.

import { formatNumber, formatSignedPct } from './format';
import { keyFromLookup, label, markKey, markValue, target, valueAt } from './marks';
import { modifiedZ, summarize, type Summary } from './stats';
import {
  type AnnotationCandidate,
  type NarrationFacts,
  type NormalizedTable,
  type NormColumn,
} from './types';

/** A selected mark: which row of `selected` it is, and its live tupleId. */
export interface Pick {
  rowIndex: number;
  tupleId: number;
}

interface MeasureCtx {
  fieldName: string;
  summary: Summary;
  /** rowIndex -> 1-based rank in descending value order (finite values only). */
  rankByRow: Map<number, number>;
  count: number;
}

/**
 * Describe the selected marks. `full` is the analyzed whole-sheet table (for
 * distribution context); `selected` is the normalized subset the host returned,
 * with `picks[i].rowIndex` addressing `selected` and `picks[i].tupleId` the live
 * mark id to annotate.
 */
export function describeSelection(
  full: NormalizedTable,
  selected: NormalizedTable,
  picks: Pick[],
): AnnotationCandidate[] {
  const fullCtx = buildContexts(full);
  const selCtx = buildContexts(selected);
  const fullIndex = new Map<string, number>();
  full.rows.forEach((_, r) => fullIndex.set(markKey(full, r), r));
  // A Measure Names/Values selection carries the clicked measure in a row, not a
  // column — detect the pair once so each pick describes the measure the user
  // actually clicked (the full sheet was already pivoted wide by the analyzer).
  const mnmv = measureNamesPair(selected);

  const out: AnnotationCandidate[] = [];
  for (const pick of picks) {
    const c = describeOne(full, fullCtx, fullIndex, selected, selCtx, mnmv, pick);
    if (c) out.push(c);
  }
  return out;
}

function describeOne(
  full: NormalizedTable,
  fullCtx: MeasureCtx[],
  fullIndex: Map<string, number>,
  selected: NormalizedTable,
  selCtx: MeasureCtx[],
  mnmv: MeasureNamesPair,
  pick: Pick,
): AnnotationCandidate | null {
  const i = pick.rowIndex;
  // A Measure Names cell IS a specific measure; honor it instead of guessing.
  const forced = forcedMeasure(selected, mnmv, i);

  // Match this selected mark back to a full-sheet row by its dimension values.
  // (For a Measure Names selection, `full` is pivoted wide, so its dimensions are
  // just the non-Measure-Names ones — the lookup naturally excludes it.)
  const key = keyFromLookup(full, (f) => selValue(selected, i, f));
  const matchedRow = fullIndex.get(key);
  const matched = matchedRow !== undefined;

  const ctxTable = matched ? full : selected;
  const ctxs = matched ? fullCtx : selCtx;
  const ctxRow = matched ? (matchedRow as number) : i;

  // Which measure to describe: the clicked one, else the row's most notable.
  let ctx: MeasureCtx | undefined;
  let col: NormColumn | undefined;
  if (forced) {
    ctx = ctxs.find((c) => c.fieldName === forced.name);
    col = ctxTable.measures.find((m) => m.fieldName === forced.name);
  } else {
    const standout = pickStandout(ctxTable, ctxs, ctxRow, matched);
    ctx = standout?.ctx;
    col = standout?.col;
  }
  const measureName = forced?.name ?? ctx?.fieldName;
  if (!measureName) return null; // nothing numeric to describe

  const markLabel = forced
    ? matched
      ? label(full, matchedRow as number)
      : labelExcept(selected, i, mnmv.mn!.fieldName)
    : label(selected, i);
  // The clicked cell's own value for a forced measure; else the row's measure value.
  const value = forced ? forced.value : col ? markValue(ctxTable, col, ctxRow) : '';

  const facts: NarrationFacts = { measure: measureName, label: markLabel, value };
  // Rank/vs-average/σ need the full distribution AND a real column for the measure.
  const ranked = matched && !!ctx && !!col;
  if (ranked) {
    const v = valueAt(ctxTable, col!, ctxRow);
    if (v !== null) {
      facts.rank = ctx!.rankByRow.get(ctxRow);
      facts.count = ctx!.count;
      Object.assign(facts, avgFacts(v, ctx!.summary));
      const zc = ctx!.summary.std > 0 ? (v - ctx!.summary.mean) / ctx!.summary.std : 0;
      if (Math.abs(zc) >= 2) {
        facts.sigma = Math.abs(zc);
        facts.direction = zc >= 0 ? 'above' : 'below';
      }
    }
  }

  return {
    id: `mark:${measureName}:${pick.tupleId}`,
    kind: 'mark',
    measure: measureName,
    rowIndex: i,
    target: target(selected, i),
    label: markLabel,
    title: `Selected — ${markLabel}`,
    text: fallbackText(measureName, facts, facts.rank !== undefined),
    score: 100, // reactive picks are user-chosen; keep them selected + on top
    facts,
    tupleId: pick.tupleId,
  };
}

/** The most notable measure for a row: largest |modified z| when we have the full
 *  distribution, else just the first measure of the selection. */
function pickStandout(
  table: NormalizedTable,
  ctxs: MeasureCtx[],
  rowIndex: number,
  matched: boolean,
): { ctx: MeasureCtx; col: NormalizedTable['measures'][number] } | null {
  let best: { ctx: MeasureCtx; col: NormalizedTable['measures'][number]; score: number } | null =
    null;
  for (const ctx of ctxs) {
    const col = table.measures.find((m) => m.fieldName === ctx.fieldName);
    if (!col) continue;
    const v = valueAt(table, col, rowIndex);
    if (v === null) continue;
    const score = matched ? Math.abs(modifiedZ(v, ctx.summary)) : Number.MAX_SAFE_INTEGER;
    if (!best || score > best.score) best = { ctx, col, score };
    if (!matched) break; // first available measure is enough without a distribution
  }
  return best ? { ctx: best.ctx, col: best.col } : null;
}

/** Per-measure distribution context (summary + descending-rank map). */
function buildContexts(table: NormalizedTable): MeasureCtx[] {
  return table.measures.map((col) => {
    const rows: { row: number; v: number }[] = [];
    table.rows.forEach((_, r) => {
      const v = valueAt(table, col, r);
      if (v !== null) rows.push({ row: r, v });
    });
    const rankByRow = new Map<number, number>();
    [...rows]
      .sort((a, b) => b.v - a.v)
      .forEach((e, idx) => rankByRow.set(e.row, idx + 1));
    return {
      fieldName: col.fieldName,
      summary: summarize(rows.map((e) => e.v)),
      rankByRow,
      count: rows.length,
    };
  });
}

/** Value of a field on a selected row, by field name (dimension or measure). */
function selValue(selected: NormalizedTable, rowIndex: number, fieldName: string): string | undefined {
  const col = selected.columns.find((c) => c.fieldName === fieldName);
  return col ? selected.rows[rowIndex].cells[col.index].value : undefined;
}

interface MeasureNamesPair {
  mn?: NormColumn;
  mv?: NormColumn;
}

/** The generated Measure Names + Measure Values columns, if this table has them. */
function measureNamesPair(t: NormalizedTable): MeasureNamesPair {
  const is = (c: NormColumn, name: string) => c.fieldName.trim().toLowerCase() === name;
  return {
    mn: t.columns.find((c) => is(c, 'measure names')),
    mv: t.columns.find((c) => is(c, 'measure values')),
  };
}

/**
 * If this selected row is a Measure Names/Values cell, the measure it represents
 * and the cell's own formatted value; otherwise null (an ordinary wide mark).
 */
function forcedMeasure(
  selected: NormalizedTable,
  mnmv: MeasureNamesPair,
  rowIndex: number,
): { name: string; value: string } | null {
  if (!mnmv.mn || !mnmv.mv) return null;
  const nameCell = selected.rows[rowIndex].cells[mnmv.mn.index];
  const valCell = selected.rows[rowIndex].cells[mnmv.mv.index];
  const name = nameCell.formatted || nameCell.value;
  if (!name) return null;
  const value = valCell.formatted || (valCell.native !== null ? formatNumber(valCell.native) : '');
  return { name, value };
}

/** A mark's label from its dimensions, excluding one field (e.g. "Measure Names"). */
function labelExcept(t: NormalizedTable, rowIndex: number, exclude: string): string {
  const parts = t.dimensions
    .filter((d) => d.fieldName !== exclude)
    .map((d) => t.rows[rowIndex].cells[d.index].formatted)
    .filter(Boolean);
  return parts.length ? parts.join(' · ') : '(all rows)';
}

/** "vs the average" facts, omitted when the mean is 0 (ratio undefined). */
function avgFacts(v: number, s: Summary): { vsAvgPct?: string; avg?: string } {
  if (s.mean === 0) return {};
  return { vsAvgPct: formatSignedPct((v - s.mean) / Math.abs(s.mean)), avg: formatNumber(s.mean) };
}

/** Deterministic fallback body (used verbatim if RosaeNLG can't run). */
function fallbackText(measure: string, f: NarrationFacts, hasContext: boolean): string {
  const head = `⌖ SELECTED · ${measure}`;
  const line = `${f.label}: ${f.value}`;
  if (!hasContext) return `${head}\n${line}`;
  const bits: string[] = [];
  if (f.rank && f.count) bits.push(`rank ${f.rank} of ${f.count}`);
  if (f.vsAvgPct) bits.push(`${f.vsAvgPct} vs avg`);
  if (f.sigma) bits.push(`${f.sigma.toFixed(1)}σ ${f.direction === 'below' ? 'low' : 'high'}`);
  return bits.length ? `${head}\n${line}\n${bits.join(' · ')}` : `${head}\n${line}`;
}
