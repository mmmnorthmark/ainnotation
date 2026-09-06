// Pivot a Measure Names / Measure Values worksheet back to wide form.
//
// A viz built on the generated "Measure Names" (a dimension whose values are the
// measure names) + "Measure Values" (one column holding the value for whichever
// measure the row represents) folds N measures into N rows per dimension member.
// To the engine that looks like ONE measure ("Measure Values") plus an extra
// dimension — which mixes every measure's scale into a single distribution and
// mislabels marks ("West · Sales"). This transform detects that shape and pivots
// it to one measure column per distinct Measure Names value, keyed by the
// remaining dimensions, so each measure is analyzed on its own footing again.
//
// Runs in the ANALYZE path only (App.runAnalyze). The live-selection reader keeps
// the raw per-mark shape so tupleIds still align 1:1 with the host's marksInfo;
// describe.ts is Measure-Names-aware and matches a clicked cell to the pivoted
// full-sheet row.

import { type RawColumn, type RawDataTable, type RawDataValue } from './normalize';

const MEASURE_NAMES = 'measure names';
const MEASURE_VALUES = 'measure values';

const norm = (s: string): string => s.trim().toLowerCase();

/** True when a table carries the generated Measure Names + Measure Values pair. */
export function isMeasureNamesShape(raw: RawDataTable): boolean {
  return (
    raw.columns.some((c) => norm(c.fieldName) === MEASURE_NAMES) &&
    raw.columns.some((c) => norm(c.fieldName) === MEASURE_VALUES)
  );
}

/**
 * Pivot a Measure Names/Values table to wide form (one measure column per
 * distinct measure name). Returns the table unchanged when the pair is absent.
 */
export function pivotMeasureNames(raw: RawDataTable): RawDataTable {
  const mnPos = raw.columns.findIndex((c) => norm(c.fieldName) === MEASURE_NAMES);
  const mvPos = raw.columns.findIndex((c) => norm(c.fieldName) === MEASURE_VALUES);
  if (mnPos < 0 || mvPos < 0) return raw;

  // Columns may carry an explicit data index (real host) or be positional (test
  // fixtures / samples); mirror normalize's `c.index ?? position` convention.
  const dataIndex = (pos: number): number => raw.columns[pos].index ?? pos;
  const mnIdx = dataIndex(mnPos);
  const mvIdx = dataIndex(mvPos);
  const others = raw.columns
    .map((c, pos) => ({ c, idx: dataIndex(pos) }))
    .filter((_, pos) => pos !== mnPos && pos !== mvPos);

  // Distinct measure names, in first-appearance order, become the new columns.
  const measureNames: string[] = [];
  for (const row of raw.data) {
    const name = nameStr(row[mnIdx]);
    if (name && !measureNames.includes(name)) measureNames.push(name);
  }
  if (measureNames.length === 0) return raw;

  // Group rows by the remaining dimensions' underlying values, preserving the
  // order groups first appear so the pivoted table reads like the original.
  interface Group {
    key: RawDataValue[];
    byMeasure: Map<string, RawDataValue>;
  }
  const groups = new Map<string, Group>();
  const order: string[] = [];
  for (const row of raw.data) {
    const gk = others.map(({ idx }) => keyStr(row[idx])).join('||');
    let g = groups.get(gk);
    if (!g) {
      g = { key: others.map(({ idx }) => row[idx]), byMeasure: new Map() };
      groups.set(gk, g);
      order.push(gk);
    }
    g.byMeasure.set(nameStr(row[mnIdx]), row[mvIdx]);
  }

  const mvType = raw.columns[mvPos].dataType;
  const columns: RawColumn[] = [
    ...others.map(({ c }, i) => ({ fieldName: c.fieldName, dataType: c.dataType, index: i })),
    ...measureNames.map((name, k) => ({
      fieldName: name,
      dataType: mvType,
      index: others.length + k,
    })),
  ];
  // A group missing a measure: leave value/native undefined so normalize reads it
  // as absent (null) rather than coercing null → 0 and poisoning the distribution.
  const empty: RawDataValue = { formattedValue: '' };
  const data: RawDataValue[][] = order.map((gk) => {
    const g = groups.get(gk)!;
    return [...g.key, ...measureNames.map((name) => g.byMeasure.get(name) ?? empty)];
  });
  return { columns, data };
}

/** Measure-name string (display preferred) used for both new column names and grouping. */
function nameStr(dv?: RawDataValue): string {
  if (!dv) return '';
  const v = dv.formattedValue ?? dv.value;
  return v === null || v === undefined ? '' : String(v);
}

/** Underlying value used to group the non-Measure-Names dimensions. */
function keyStr(dv?: RawDataValue): string {
  if (!dv) return '';
  const v = dv.value ?? dv.formattedValue;
  return v === null || v === undefined ? '' : String(v);
}
