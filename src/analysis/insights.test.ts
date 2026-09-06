import { describe, expect, it } from 'vitest';
import { normalizeDataTable, type RawDataTable } from './normalize';
import { analyze } from './insights';
import { type AnnotationCandidate } from './types';

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

function run(t: RawDataTable, opts = {}): AnnotationCandidate[] {
  return analyze(normalizeDataTable(t), opts);
}
const kind = (cs: AnnotationCandidate[], k: string) => cs.find((c) => c.kind === k);

describe('normalizeDataTable', () => {
  it('splits dimensions from measures and flags ordered axes', () => {
    const norm = normalizeDataTable(
      table(
        [
          { fieldName: 'Month', dataType: 'date-time' },
          { fieldName: 'Region', dataType: 'string' },
          { fieldName: 'Sales', dataType: 'float' },
        ],
        [['2023-01-01', 'West', 10]],
      ),
    );
    expect(norm.measures.map((m) => m.fieldName)).toEqual(['Sales']);
    expect(norm.dimensions.map((d) => d.fieldName)).toEqual(['Month', 'Region']);
    expect(norm.dimensions[0].ordered).toBe(true); // date-time
    expect(norm.dimensions[1].ordered).toBe(false); // string
  });
});

describe('analyze — categorical', () => {
  const cs = run(
    table(
      [
        { fieldName: 'Category', dataType: 'string' },
        { fieldName: 'Sales', dataType: 'float' },
      ],
      [
        ['A', 100],
        ['B', 500],
        ['C', 300],
        ['D', 50],
      ],
    ),
  );

  it('flags the peak on the right row with rich context', () => {
    const max = kind(cs, 'max')!;
    expect(max).toBeTruthy();
    expect(max.rowIndex).toBe(1);
    expect(max.label).toBe('B');
    expect(max.measure).toBe('Sales');
    expect(max.text).toContain('PEAK');
    expect(max.text).toContain('#1 of 4');
    expect(max.text).toContain('▲');
  });

  it('flags the low point', () => {
    const min = kind(cs, 'min')!;
    expect(min.rowIndex).toBe(3);
    expect(min.label).toBe('D');
    expect(min.text).toContain('#4 of 4');
  });

  it('reports the top contributor share of a non-negative total', () => {
    const share = kind(cs, 'share')!;
    expect(share.rowIndex).toBe(1);
    // 500 / 950 ≈ 53%
    expect(share.text).toMatch(/5[23]%/);
  });

  it('returns candidates sorted by descending score', () => {
    const scores = cs.map((c) => c.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });
});

describe('analyze — outliers', () => {
  it('flags a non-peak mark beyond the z threshold', () => {
    const cs = run(
      table(
        [
          { fieldName: 'Store', dataType: 'string' },
          { fieldName: 'Units', dataType: 'float' },
        ],
        [
          ['s0', 0],
          ['s1', 0],
          ['s2', 0],
          ['s3', 0],
          ['s4', 0],
          ['s5', 0],
          ['s6', 0],
          ['s7', 0],
          ['s8', 80], // second-highest → the outlier we expect
          ['s9', 100], // peak (excluded from outlier scan)
        ],
      ),
      { outlierZ: 1.5 },
    );
    const hi = kind(cs, 'outlier-high')!;
    expect(hi).toBeTruthy();
    expect(hi.rowIndex).toBe(8);
    expect(hi.text).toContain('σ');
    expect(hi.text).toContain('OUTLIER');
  });
});

describe('analyze — time series', () => {
  const cs = run(
    table(
      [
        { fieldName: 'Month', dataType: 'date-time' },
        { fieldName: 'Sales', dataType: 'float' },
      ],
      [
        ['2023-01-01', 100],
        ['2023-02-01', 120],
        ['2023-03-01', 200],
        ['2023-04-01', 150],
      ],
    ),
  );

  it('detects the overall trend and attaches it to the last point', () => {
    const trend = kind(cs, 'trend')!;
    expect(trend).toBeTruthy();
    expect(trend.rowIndex).toBe(3);
    expect(trend.text).toContain('+50%');
    expect(trend.text).toMatch(/rose|↗/);
  });

  it('detects the biggest single-step move', () => {
    const mover = kind(cs, 'mover')!;
    expect(mover.rowIndex).toBe(2); // the jump from 120 → 200 lands on row 2
    expect(mover.text).toContain('+80');
  });
});

describe('analyze — degenerate input', () => {
  it('returns nothing when there is no measure', () => {
    const cs = run(
      table(
        [
          { fieldName: 'A', dataType: 'string' },
          { fieldName: 'B', dataType: 'string' },
        ],
        [['x', 'y']],
      ),
    );
    expect(cs).toEqual([]);
  });

  it('respects the candidate limit', () => {
    const cs = run(
      table(
        [
          { fieldName: 'Category', dataType: 'string' },
          { fieldName: 'Sales', dataType: 'float' },
        ],
        [
          ['A', 100],
          ['B', 500],
          ['C', 300],
        ],
      ),
      { limit: 1 },
    );
    expect(cs.length).toBe(1);
  });
});

describe('analyze — breakaway gap', () => {
  it('flags a clear cliff between the leaders and the pack', () => {
    const cs = run(
      table(
        [
          { fieldName: 'Rep', dataType: 'string' },
          { fieldName: 'Deals', dataType: 'float' },
        ],
        [
          ['A', 1000],
          ['B', 950],
          ['C', 900],
          ['D', 100],
          ['E', 80],
          ['F', 50],
        ],
      ),
    );
    const gap = kind(cs, 'gap')!;
    expect(gap).toBeTruthy();
    expect(gap.rowIndex).toBe(2); // C — last of the leading cluster (above the cliff)
    expect(gap.text).toContain('BREAKAWAY GAP');
    expect(gap.text).toContain('top 3 break away');
  });

  it('does not fire on an evenly spaced distribution', () => {
    const cs = run(
      table(
        [
          { fieldName: 'Rep', dataType: 'string' },
          { fieldName: 'Deals', dataType: 'float' },
        ],
        [
          ['A', 100],
          ['B', 90],
          ['C', 80],
          ['D', 70],
          ['E', 60],
          ['F', 50],
        ],
      ),
    );
    expect(kind(cs, 'gap')).toBeUndefined();
  });
});

describe('analyze — level shift', () => {
  it('detects a regime change in a longer time series', () => {
    const cs = run(
      table(
        [
          { fieldName: 'Month', dataType: 'date-time' },
          { fieldName: 'Sales', dataType: 'float' },
        ],
        [
          ['2023-01-01', 100],
          ['2023-02-01', 110],
          ['2023-03-01', 105],
          ['2023-04-01', 300],
          ['2023-05-01', 310],
          ['2023-06-01', 305],
        ],
      ),
    );
    const cp = kind(cs, 'changepoint')!;
    expect(cp).toBeTruthy();
    expect(cp.rowIndex).toBe(3); // first month of the higher regime
    expect(cp.text).toContain('LEVEL SHIFT');
  });
});

describe('analyze — off-trend residual', () => {
  it('flags the mark that breaks a strong measure-pair relationship', () => {
    const cs = run(
      table(
        [
          { fieldName: 'Account', dataType: 'string' },
          { fieldName: 'Spend', dataType: 'float' },
          { fieldName: 'Revenue', dataType: 'float' },
        ],
        [
          ['A', 10, 20],
          ['B', 20, 40],
          ['C', 30, 60],
          ['D', 40, 80],
          ['E', 50, 100],
          ['F', 25, 10], // predicted ~50, actual 10 — far below the line
        ],
      ),
    );
    const off = kind(cs, 'off-trend')!;
    expect(off).toBeTruthy();
    expect(off.rowIndex).toBe(5);
    expect(off.label).toBe('F');
    expect(off.measure).toBe('Revenue');
    expect(off.text).toContain('OFF-TREND');
    expect(off.text).toMatch(/below the line/);
  });

  it('stays silent when there is only one measure', () => {
    const cs = run(
      table(
        [
          { fieldName: 'Cat', dataType: 'string' },
          { fieldName: 'Val', dataType: 'float' },
        ],
        [
          ['A', 1],
          ['B', 2],
          ['C', 3],
          ['D', 4],
          ['E', 5],
        ],
      ),
    );
    expect(kind(cs, 'off-trend')).toBeUndefined();
  });
});
