import { describe, expect, it } from 'vitest';
import { normalizeDataTable, type RawDataTable } from './normalize';
import { isMeasureNamesShape, pivotMeasureNames } from './pivot';

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

// Region × {Sales, Profit} folded into a Measure Names / Measure Values shape.
const FOLDED = table(
  [
    { fieldName: 'Region', dataType: 'string' },
    { fieldName: 'Measure Names', dataType: 'string' },
    { fieldName: 'Measure Values', dataType: 'float' },
  ],
  [
    ['West', 'Sales', 500],
    ['West', 'Profit', 10],
    ['East', 'Sales', 100],
    ['East', 'Profit', 90],
  ],
);

describe('pivotMeasureNames', () => {
  it('detects the Measure Names / Measure Values shape', () => {
    expect(isMeasureNamesShape(FOLDED)).toBe(true);
    expect(
      isMeasureNamesShape(
        table([{ fieldName: 'Region', dataType: 'string' }, { fieldName: 'Sales', dataType: 'float' }], [['West', 1]]),
      ),
    ).toBe(false);
  });

  it('pivots folded measures into one wide column each, keyed by the other dims', () => {
    const wide = pivotMeasureNames(FOLDED);
    expect(wide.columns.map((c) => c.fieldName)).toEqual(['Region', 'Sales', 'Profit']);

    const norm = normalizeDataTable(wide);
    expect(norm.dimensions.map((d) => d.fieldName)).toEqual(['Region']);
    expect(norm.measures.map((m) => m.fieldName)).toEqual(['Sales', 'Profit']);
    expect(norm.rows).toHaveLength(2); // West, East — not 4

    const west = norm.rows[0];
    expect(west.cells[0].value).toBe('West');
    expect(west.cells[1].native).toBe(500); // Sales
    expect(west.cells[2].native).toBe(10); // Profit
    const east = norm.rows[1];
    expect(east.cells[1].native).toBe(100);
    expect(east.cells[2].native).toBe(90);
  });

  it('leaves a normal wide table untouched (same reference)', () => {
    const wide = table(
      [
        { fieldName: 'Region', dataType: 'string' },
        { fieldName: 'Sales', dataType: 'float' },
      ],
      [['West', 500]],
    );
    expect(pivotMeasureNames(wide)).toBe(wide);
  });

  it('fills an empty cell when a group is missing a measure', () => {
    const sparse = table(
      [
        { fieldName: 'Region', dataType: 'string' },
        { fieldName: 'Measure Names', dataType: 'string' },
        { fieldName: 'Measure Values', dataType: 'float' },
      ],
      [
        ['West', 'Sales', 500],
        ['West', 'Profit', 10],
        ['East', 'Sales', 100], // East has no Profit row
      ],
    );
    const norm = normalizeDataTable(pivotMeasureNames(sparse));
    const east = norm.rows[1];
    expect(east.cells[1].native).toBe(100); // Sales present
    expect(east.cells[2].native).toBeNull(); // Profit absent → empty
  });
});
