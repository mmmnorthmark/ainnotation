import { describe, expect, it } from 'vitest';
import { normalizeDataTable, type RawDataTable } from './normalize';
import { describeSelection } from './describe';

function table(columns: RawDataTable['columns'], rows: unknown[][]): RawDataTable {
  return {
    columns,
    data: rows.map((r) =>
      r.map((v) =>
        typeof v === 'number'
          ? { value: v, nativeValue: v, formattedValue: String(v) }
          : { value: v, formattedValue: String(v) },
      ),
    ),
  };
}

const REGION_SALES = table(
  [
    { fieldName: 'Region', dataType: 'string' },
    { fieldName: 'Sales', dataType: 'float' },
  ],
  [
    ['West', 500],
    ['East', 100],
    ['North', 300],
    ['South', 50],
  ],
);

describe('describeSelection — matched mark (full-sheet context)', () => {
  const full = normalizeDataTable(REGION_SALES);
  // A selection returns its own DataTable subset; here just the "East" mark.
  const selected = normalizeDataTable(
    table(
      [
        { fieldName: 'Region', dataType: 'string' },
        { fieldName: 'Sales', dataType: 'float' },
      ],
      [['East', 100]],
    ),
  );
  const out = describeSelection(full, selected, [{ rowIndex: 0, tupleId: 42 }]);

  it('emits one mark candidate carrying the live tupleId', () => {
    expect(out).toHaveLength(1);
    const c = out[0];
    expect(c.kind).toBe('mark');
    expect(c.tupleId).toBe(42);
    expect(c.id).toBe('mark:Sales:42');
    expect(c.measure).toBe('Sales');
    expect(c.label).toBe('East');
    expect(c.score).toBe(100);
  });

  it('ranks the mark against the whole sheet, not just the selection', () => {
    const f = out[0].facts!;
    expect(f.value).toBe('100');
    expect(f.rank).toBe(3); // desc: 500, 300, 100, 50
    expect(f.count).toBe(4);
    expect(f.vsAvgPct?.startsWith('−')).toBe(true); // U+2212; 100 is below the 237.5 average
    expect(f.avg).toBeTruthy();
  });
});

describe('describeSelection — unmatched mark (no distribution)', () => {
  const full = normalizeDataTable(REGION_SALES);
  const selected = normalizeDataTable(
    table(
      [
        { fieldName: 'Region', dataType: 'string' },
        { fieldName: 'Sales', dataType: 'float' },
      ],
      [['Mars', 999]], // not present in the analyzed sheet
    ),
  );
  const out = describeSelection(full, selected, [{ rowIndex: 0, tupleId: 7 }]);

  it('still describes the mark from its own value, without rank/vs-avg', () => {
    expect(out).toHaveLength(1);
    const c = out[0];
    expect(c.kind).toBe('mark');
    expect(c.label).toBe('Mars');
    expect(c.tupleId).toBe(7);
    expect(c.facts!.value).toBe('999');
    expect(c.facts!.rank).toBeUndefined();
    expect(c.facts!.count).toBeUndefined();
    expect(c.facts!.vsAvgPct).toBeUndefined();
  });
});

describe('describeSelection — standout measure', () => {
  const raw = table(
    [
      { fieldName: 'Region', dataType: 'string' },
      { fieldName: 'Sales', dataType: 'float' },
      { fieldName: 'Profit', dataType: 'float' },
    ],
    [
      ['West', 100, 10],
      ['East', 105, 11],
      ['North', 98, 9],
      ['South', 102, 200], // South is an extreme Profit outlier, ordinary Sales
    ],
  );
  const full = normalizeDataTable(raw);
  const selected = normalizeDataTable(
    table(
      [
        { fieldName: 'Region', dataType: 'string' },
        { fieldName: 'Sales', dataType: 'float' },
        { fieldName: 'Profit', dataType: 'float' },
      ],
      [['South', 102, 200]],
    ),
  );

  it('describes the measure the mark is most extreme on', () => {
    const out = describeSelection(full, selected, [{ rowIndex: 0, tupleId: 1 }]);
    expect(out[0].measure).toBe('Profit');
  });

  it('describes every selected mark', () => {
    const twoSel = normalizeDataTable(
      table(
        [
          { fieldName: 'Region', dataType: 'string' },
          { fieldName: 'Sales', dataType: 'float' },
          { fieldName: 'Profit', dataType: 'float' },
        ],
        [
          ['West', 100, 10],
          ['South', 102, 200],
        ],
      ),
    );
    const out = describeSelection(full, twoSel, [
      { rowIndex: 0, tupleId: 11 },
      { rowIndex: 1, tupleId: 22 },
    ]);
    expect(out.map((c) => c.tupleId)).toEqual([11, 22]);
  });
});

describe('describeSelection — Measure Names / Measure Values cell', () => {
  // The analyzed full sheet is already pivoted wide (App runs pivotMeasureNames).
  const full = normalizeDataTable(
    table(
      [
        { fieldName: 'Region', dataType: 'string' },
        { fieldName: 'Sales', dataType: 'float' },
        { fieldName: 'Profit', dataType: 'float' },
      ],
      [
        ['West', 500, 10],
        ['East', 100, 90],
        ['North', 300, 50],
        ['South', 50, 40],
      ],
    ),
  );
  // The live selection is still in Measure Names shape (selection.ts doesn't pivot).
  const folded = (region: string, meas: string, value: number) =>
    normalizeDataTable(
      table(
        [
          { fieldName: 'Region', dataType: 'string' },
          { fieldName: 'Measure Names', dataType: 'string' },
          { fieldName: 'Measure Values', dataType: 'float' },
        ],
        [[region, meas, value]],
      ),
    );

  it('describes the clicked measure against the full-sheet distribution', () => {
    const out = describeSelection(full, folded('East', 'Profit', 90), [{ rowIndex: 0, tupleId: 55 }]);
    expect(out).toHaveLength(1);
    const c = out[0];
    expect(c.measure).toBe('Profit');
    expect(c.label).toBe('East'); // not "East · Profit"
    expect(c.tupleId).toBe(55);
    expect(c.id).toBe('mark:Profit:55');
    const f = c.facts!;
    expect(f.value).toBe('90');
    expect(f.rank).toBe(1); // Profit desc: 90, 50, 40, 10
    expect(f.count).toBe(4);
    expect(f.vsAvgPct?.startsWith('+')).toBe(true); // 90 is above the 47.5 avg
  });

  it('honors the clicked measure over the row-standout measure', () => {
    // West.Sales is the Sales peak; West.Profit is the Profit min (more extreme z).
    const out = describeSelection(full, folded('West', 'Sales', 500), [{ rowIndex: 0, tupleId: 7 }]);
    expect(out[0].measure).toBe('Sales');
    expect(out[0].facts!.rank).toBe(1);
  });

  it('describes an unmatched Measure Names cell from its own value', () => {
    const out = describeSelection(full, folded('Mars', 'Sales', 999), [{ rowIndex: 0, tupleId: 9 }]);
    const c = out[0];
    expect(c.measure).toBe('Sales');
    expect(c.label).toBe('Mars');
    expect(c.facts!.value).toBe('999');
    expect(c.facts!.rank).toBeUndefined();
  });
});
