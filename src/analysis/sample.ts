// Sample datasets for PREVIEW mode (no Tableau host). They stand in for the
// active sheet's summary data so the whole analyze → propose → (simulated) apply
// flow is demoable in a plain browser. Two "sheets" are offered so preview can
// exercise both categorical insights (peak/low/outlier) and time-series ones
// (trend/mover) — switching them also simulates an active-sheet change.

import { type RawDataTable, type RawDataValue } from './normalize';

export interface SampleSheet {
  id: string;
  name: string;
  table: RawDataTable;
}

function usd(n: number): string {
  const sign = n < 0 ? '−' : '';
  return `${sign}$${new Intl.NumberFormat('en-US').format(Math.abs(Math.round(n)))}`;
}

function dim(value: string, formatted = value) {
  return { value, formattedValue: formatted };
}
function measure(n: number, formatted?: string) {
  return { value: n, nativeValue: n, formattedValue: formatted ?? usd(n) };
}

// Classic Superstore sub-category sales & profit. Profit has real losses
// (Tables, Bookcases) → a low-outlier story; Sales is broadly spread.
const SUBCATEGORY: [string, number, number][] = [
  ['Phones', 330007, 44516],
  ['Chairs', 328449, 26591],
  ['Storage', 223844, 21279],
  ['Tables', 206966, -17725],
  ['Binders', 203413, 30222],
  ['Machines', 189238, 3385],
  ['Accessories', 167380, 41937],
  ['Copiers', 149528, 55618],
  ['Bookcases', 114880, -3473],
  ['Appliances', 107532, 18138],
  ['Furnishings', 91705, 13059],
  ['Paper', 78479, 34054],
  ['Supplies', 46674, -1189],
  ['Art', 27119, 6528],
  ['Envelopes', 16476, 6964],
  ['Labels', 12486, 5546],
  ['Fasteners', 3024, 950],
];

// A Measure Names / Measure Values layout: three measures (Sales, Profit, Orders)
// folded into rows per Region — the shape pivotMeasureNames unfolds so each
// measure is analyzed on its own scale instead of one mushed "Measure Values".
const OVERVIEW: [string, number, number, number][] = [
  ['West', 725458, 108418, 3203],
  ['East', 678781, 91523, 2848],
  ['Central', 501240, 39706, 2323],
  ['South', 391722, 46749, 1620],
];

const count = (n: number): string => new Intl.NumberFormat('en-US').format(Math.round(n));

/** Build a raw Measure Names/Values table: each measure of each row is its own row. */
function measureNamesTable(
  dimName: string,
  measures: string[],
  rows: [string, ...number[]][],
): RawDataTable {
  const fmt = (name: string, n: number) => (name === 'Orders' ? count(n) : usd(n));
  const data: RawDataValue[][] = [];
  for (const [dimVal, ...vals] of rows) {
    measures.forEach((m, k) => data.push([dim(dimVal), dim(m), measure(vals[k], fmt(m, vals[k]))]));
  }
  return {
    columns: [
      { fieldName: dimName, dataType: 'string' },
      { fieldName: 'Measure Names', dataType: 'string' },
      { fieldName: 'Measure Values', dataType: 'float' },
    ],
    data,
  };
}

// Monthly sales — a rising series with one outsized jump (Nov holiday spike).
const MONTHLY: [string, string, number][] = [
  ['2023-01-01', 'Jan 2023', 94_000],
  ['2023-02-01', 'Feb 2023', 88_500],
  ['2023-03-01', 'Mar 2023', 121_400],
  ['2023-04-01', 'Apr 2023', 116_900],
  ['2023-05-01', 'May 2023', 134_200],
  ['2023-06-01', 'Jun 2023', 142_800],
  ['2023-07-01', 'Jul 2023', 138_100],
  ['2023-08-01', 'Aug 2023', 159_600],
  ['2023-09-01', 'Sep 2023', 171_300],
  ['2023-10-01', 'Oct 2023', 168_700],
  ['2023-11-01', 'Nov 2023', 264_500],
  ['2023-12-01', 'Dec 2023', 238_900],
];

export const SAMPLE_SHEETS: SampleSheet[] = [
  {
    id: 'sample-subcategory',
    name: 'Sales & Profit by Sub-Category',
    table: {
      columns: [
        { fieldName: 'Sub-Category', dataType: 'string' },
        { fieldName: 'Sales', dataType: 'float' },
        { fieldName: 'Profit', dataType: 'float' },
      ],
      data: SUBCATEGORY.map(([sub, sales, profit]) => [dim(sub), measure(sales), measure(profit)]),
    },
  },
  {
    id: 'sample-monthly',
    name: 'Monthly Sales 2023',
    table: {
      columns: [
        { fieldName: 'Month of Order Date', dataType: 'date-time' },
        { fieldName: 'Sales', dataType: 'float' },
      ],
      data: MONTHLY.map(([iso, month, sales]) => [dim(iso, month), measure(sales)]),
    },
  },
  {
    id: 'sample-overview',
    name: 'Regional Overview (Measure Names)',
    table: measureNamesTable('Region', ['Sales', 'Profit', 'Orders'], OVERVIEW),
  },
];
