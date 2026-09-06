// Adapt a raw Extensions-API summary DataTable into the engine's NormalizedTable.
//
// A DataTable (from worksheet.getSummaryDataAsync) exposes:
//   columns: { fieldName, dataType, index }[]
//   data:    DataValue[][]   where DataValue = { value, nativeValue, formattedValue, ... }
// We only depend on that slice, so this also accepts hand-built fixtures in tests.

import {
  type NormalizedTable,
  type NormColumn,
  type NormRow,
  type TableauDataType,
} from './types';

export interface RawColumn {
  fieldName: string;
  dataType: TableauDataType;
  index?: number;
}

export interface RawDataValue {
  value?: unknown;
  nativeValue?: unknown;
  formattedValue?: unknown;
}

export interface RawDataTable {
  columns: RawColumn[];
  data: RawDataValue[][];
}

// The Extensions API DataType enum uses "int" (not "integer") for whole-number
// aggregates — CNTD/COUNT/rank fields, etc. Missing it silently demotes those
// measures to dimensions, which then poison mark selection. Keep "integer" too
// for forward-compat. (Verified against the vendored tableau.extensions bundle.)
const MEASURE_TYPES = new Set<TableauDataType>(['float', 'int', 'integer']);
const ORDERED_TYPES = new Set<TableauDataType>(['date', 'date-time', 'datetime']);

/** Measures are numeric aggregates; everything else is a dimension. */
function roleOf(dataType: TableauDataType): 'dimension' | 'measure' {
  return MEASURE_TYPES.has(dataType) ? 'measure' : 'dimension';
}

function toNative(dv: RawDataValue): number | null {
  const n = typeof dv.nativeValue === 'number' ? dv.nativeValue : Number(dv.nativeValue ?? dv.value);
  return Number.isFinite(n) ? n : null;
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

export function normalizeDataTable(dt: RawDataTable): NormalizedTable {
  const columns: NormColumn[] = dt.columns.map((c, i) => {
    const role = roleOf(c.dataType);
    return {
      fieldName: c.fieldName,
      dataType: c.dataType,
      role,
      index: c.index ?? i,
      ordered: role === 'dimension' && ORDERED_TYPES.has(c.dataType),
    };
  });

  const rows: NormRow[] = dt.data.map((r) => ({
    cells: columns.map((col) => {
      const dv = r[col.index] ?? {};
      const formatted = toStr(dv.formattedValue ?? dv.value);
      return {
        value: toStr(dv.value ?? dv.formattedValue),
        formatted,
        native: col.role === 'measure' ? toNative(dv) : null,
      };
    }),
  }));

  return {
    columns,
    rows,
    dimensions: columns.filter((c) => c.role === 'dimension'),
    measures: columns.filter((c) => c.role === 'measure'),
  };
}
