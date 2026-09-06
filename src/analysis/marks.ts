// Row/mark helpers shared by the insight generators (insights.ts) and the
// reactive per-mark describer (describe.ts). A "mark" is one row of the
// NormalizedTable; these turn a row index into the label, target field/value
// pairs, and formatted/native measure values the rest of the engine needs.

import { formatNumber } from './format';
import { type FieldValue, type NormalizedTable, type NormColumn } from './types';

/** Dimension field/value pairs identifying the mark (raw underlying values). */
export function target(table: NormalizedTable, rowIndex: number): FieldValue[] {
  return table.dimensions.map((d) => ({
    fieldName: d.fieldName,
    value: table.rows[rowIndex].cells[d.index].value,
    dataType: d.dataType,
  }));
}

/** Human label of a mark: its dimension values joined, or "(all rows)". */
export function label(table: NormalizedTable, rowIndex: number): string {
  const parts = table.dimensions
    .map((d) => table.rows[rowIndex].cells[d.index].formatted)
    .filter(Boolean);
  return parts.length ? parts.join(' · ') : '(all rows)';
}

/** The mark's own value, formatted the way the viz shows it. */
export function markValue(table: NormalizedTable, measure: NormColumn, rowIndex: number): string {
  const c = table.rows[rowIndex].cells[measure.index];
  return c.formatted || formatNumber(c.native ?? NaN);
}

/** The mark's native numeric value for a measure, or null if non-numeric. */
export function valueAt(
  table: NormalizedTable,
  measure: NormColumn,
  rowIndex: number,
): number | null {
  return table.rows[rowIndex].cells[measure.index]?.native ?? null;
}

/**
 * Stable key for a row from its dimension raw values, used to match a live
 * selected mark back to a row of the analyzed table.
 */
export function markKey(table: NormalizedTable, rowIndex: number): string {
  return keyFromLookup(table, (f) => {
    const d = table.dimensions.find((c) => c.fieldName === f);
    return d ? table.rows[rowIndex].cells[d.index].value : undefined;
  });
}

/** Build the same key as `markKey` from an arbitrary field→value lookup. */
export function keyFromLookup(
  table: NormalizedTable,
  get: (fieldName: string) => string | undefined,
): string {
  return table.dimensions.map((d) => `${d.fieldName}=${get(d.fieldName) ?? ''}`).join('||');
}
