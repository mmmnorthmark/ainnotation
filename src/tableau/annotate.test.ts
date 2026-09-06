import { describe, expect, it, vi } from 'vitest';
import {
  applyCandidate,
  NoMarkError,
  parseTableauDate,
  sanitizeAnnotationText,
  selectionAttempts,
  toSelectionValue,
} from './annotate';
import { type SelectedMarksTable, type WorksheetSurface } from './worksheet';
import { type AnnotationCandidate } from '../analysis/types';

const candidate = (over: Partial<AnnotationCandidate> = {}): AnnotationCandidate => ({
  id: 'max:Sales:1',
  kind: 'max',
  measure: 'Sales',
  rowIndex: 1,
  target: [{ fieldName: 'Category', value: 'B' }],
  label: 'B',
  title: 'Peak — B',
  text: 'PEAK\nB & <Co>',
  score: 79,
  ...over,
});

/**
 * A worksheet whose getSelectedMarksAsync returns a fixed table. `tables` may be a
 * single table (returned every attempt) or one table per select attempt (to model
 * criteria broadening — empty first, then a superset).
 */
function fakeWorksheet(
  tables: SelectedMarksTable | SelectedMarksTable[],
): WorksheetSurface & { calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = { select: [], annotate: [], clear: [] };
  const seq = Array.isArray(tables) ? tables : null;
  return {
    calls,
    name: 'Sheet 1',
    sheetType: 'worksheet',
    getSummaryDataAsync: vi.fn(),
    selectMarksByValueAsync: vi.fn(async (criteria: unknown, updateType: unknown) => {
      calls.select.push({ criteria, updateType });
    }),
    getSelectedMarksAsync: vi.fn(async () => {
      const i = calls.select.length - 1;
      const table = seq ? seq[Math.min(i, seq.length - 1)] : (tables as SelectedMarksTable);
      return { data: [table] };
    }),
    clearSelectedMarksAsync: vi.fn(async () => {
      calls.clear.push(true);
    }),
    annotateMarkAsync: vi.fn(async (mark: unknown, text: unknown) => {
      calls.annotate.push({ mark, text });
    }),
    getAnnotationsAsync: vi.fn(async () => []),
    removeAnnotationAsync: vi.fn(async () => {}),
  } as unknown as WorksheetSurface & { calls: Record<string, unknown[]> };
}

/** Just the marksInfo (columns/data absent) — the common "select pins one mark" case. */
const marksOnly = (marksInfo: Array<{ tupleId: number }>): SelectedMarksTable =>
  ({ marksInfo }) as unknown as SelectedMarksTable;

describe('sanitizeAnnotationText', () => {
  it('escapes XML specials and normalizes newlines', () => {
    expect(sanitizeAnnotationText('a & b <c> "d"\r\ne')).toBe('a &amp; b &lt;c&gt; "d"\ne');
  });
});

describe('applyCandidate', () => {
  it('selects the mark, annotates it by tupleId with sanitized text, then clears', async () => {
    const ws = fakeWorksheet(marksOnly([{ tupleId: 7 }]));
    await applyCandidate(ws, candidate());

    expect(ws.calls.select).toHaveLength(1);
    expect((ws.calls.select[0] as { criteria: unknown }).criteria).toEqual([
      { fieldName: 'Category', value: 'B' },
    ]);
    const annotate = ws.calls.annotate[0] as { mark: { tupleId: number }; text: string };
    expect(annotate.mark).toEqual({ tupleId: 7 });
    expect(annotate.text).toBe('PEAK\nB &amp; &lt;Co&gt;');
    expect(ws.calls.clear).toHaveLength(1);
  });

  it('throws NoMarkError when no mark resolves, but still clears the selection', async () => {
    const ws = fakeWorksheet(marksOnly([]));
    await expect(applyCandidate(ws, candidate())).rejects.toBeInstanceOf(NoMarkError);
    expect(ws.calls.annotate).toHaveLength(0);
    expect(ws.calls.clear).toHaveLength(1);
  });

  it('refuses a target with no dimensions and never selects', async () => {
    const ws = fakeWorksheet(marksOnly([{ tupleId: 7 }]));
    await expect(applyCandidate(ws, candidate({ target: [] }))).rejects.toBeInstanceOf(NoMarkError);
    expect(ws.calls.select).toHaveLength(0);
  });

  it('sends a Date (not a string) for date-typed target fields', async () => {
    const ws = fakeWorksheet(marksOnly([{ tupleId: 7 }]));
    await applyCandidate(
      ws,
      candidate({
        target: [
          { fieldName: 'Segment', value: 'Consumer', dataType: 'string' },
          { fieldName: 'MONTH(Order Date)', value: '2027-09-01 00:00:00', dataType: 'date-time' },
        ],
      }),
    );
    const criteria = (ws.calls.select[0] as { criteria: { fieldName: string; value: unknown }[] })
      .criteria;
    expect(criteria[0].value).toBe('Consumer'); // string stays a string
    const dv = criteria[1].value as Date;
    expect(dv).toBeInstanceOf(Date);
    // UTC components must equal the literal fields so the API round-trips them.
    expect([dv.getUTCFullYear(), dv.getUTCMonth() + 1, dv.getUTCDate()]).toEqual([2027, 9, 1]);
    expect([dv.getUTCHours(), dv.getUTCMinutes(), dv.getUTCSeconds()]).toEqual([0, 0, 0]);
  });
});

// A Sales-Forecast-style selected-marks table: two Consumer / Sep 2027 marks that
// differ only by Forecast indicator, each with its own tupleId.
function forecastTable(sepDate: unknown): SelectedMarksTable {
  return {
    columns: [
      { fieldName: 'Segment', dataType: 'string' },
      { fieldName: 'MONTH(Order Date)', dataType: 'date-time' },
      { fieldName: 'Forecast indicator', dataType: 'string' },
    ],
    data: [
      [{ value: 'Consumer' }, { value: sepDate }, { value: 'Estimate' }],
      [{ value: 'Consumer' }, { value: sepDate }, { value: 'Actual' }],
    ],
    marksInfo: [{ tupleId: 101 }, { tupleId: 102 }],
  } as unknown as SelectedMarksTable;
}

const forecastTarget = (indicator: 'Estimate' | 'Actual') =>
  candidate({
    label: `Consumer · September 2027 · ${indicator}`,
    target: [
      { fieldName: 'Segment', value: 'Consumer', dataType: 'string' },
      { fieldName: 'MONTH(Order Date)', value: '2027-09-01 00:00:00', dataType: 'date-time' },
      { fieldName: 'Forecast indicator', value: indicator, dataType: 'string' },
    ],
  });

describe('resolveMark superset matching', () => {
  it('picks the exact mark by matching every field in JS, not marksInfo[0]', async () => {
    const ws = fakeWorksheet(forecastTable('2027-09-01 00:00:00'));
    await applyCandidate(ws, forecastTarget('Actual')); // second row
    expect((ws.calls.annotate[0] as { mark: { tupleId: number } }).mark).toEqual({ tupleId: 102 });
  });

  it('matches a date field by instant even when the returned value is a Date object', async () => {
    const ws = fakeWorksheet(forecastTable(new Date(Date.UTC(2027, 8, 1))));
    await applyCandidate(ws, forecastTarget('Estimate')); // first row
    expect((ws.calls.annotate[0] as { mark: { tupleId: number } }).mark).toEqual({ tupleId: 101 });
  });

  it('broadens the criteria when the full criteria select nothing, then matches', async () => {
    const ws = fakeWorksheet([
      { marksInfo: [] } as unknown as SelectedMarksTable, // full criteria: zero marks
      forecastTable('2027-09-01 00:00:00'), // broader superset on the next attempt
    ]);
    await applyCandidate(ws, forecastTarget('Estimate'));
    expect(ws.calls.select.length).toBeGreaterThanOrEqual(2); // it had to broaden
    expect((ws.calls.annotate[0] as { mark: { tupleId: number } }).mark).toEqual({ tupleId: 101 });
  });

  it('reports how far it got when nothing ever matches', async () => {
    const ws = fakeWorksheet(forecastTable('1999-01-01 00:00:00')); // wrong month everywhere
    await expect(applyCandidate(ws, forecastTarget('Estimate'))).rejects.toThrow(/selected \d+ mark/);
    expect(ws.calls.annotate).toHaveLength(0);
    expect(ws.calls.clear).toHaveLength(1);
  });
});

describe('selectionAttempts', () => {
  it('orders full → drop-dates → first-plain-dimension and drops empty/duplicate tiers', () => {
    const attempts = selectionAttempts([
      { fieldName: 'Segment', value: 'Consumer', dataType: 'string' },
      { fieldName: 'MONTH(Order Date)', value: '2027-09-01 00:00:00', dataType: 'date-time' },
      { fieldName: 'Forecast indicator', value: 'Estimate', dataType: 'string' },
    ]);
    expect(attempts.map((a) => a.map((c) => c.fieldName))).toEqual([
      ['Segment', 'MONTH(Order Date)', 'Forecast indicator'],
      ['Segment', 'Forecast indicator'],
      ['Segment'],
    ]);
    // A single non-date dimension collapses to just one attempt (no duplicates).
    expect(selectionAttempts([{ fieldName: 'Category', value: 'B' }])).toHaveLength(1);
  });
});

describe('parseTableauDate / toSelectionValue', () => {
  it('parses datetime and date-only strings with UTC-preserved components', () => {
    const dt = parseTableauDate('2024-02-01 13:05:09')!;
    expect(dt.getUTCFullYear()).toBe(2024);
    expect(dt.getUTCMonth() + 1).toBe(2);
    expect(dt.getUTCDate()).toBe(1);
    expect(dt.getUTCHours()).toBe(13);
    expect(dt.getUTCSeconds()).toBe(9);

    const dOnly = parseTableauDate('2023-09-01')!;
    expect(dOnly.getUTCHours()).toBe(0);
    expect([dOnly.getUTCFullYear(), dOnly.getUTCMonth() + 1, dOnly.getUTCDate()]).toEqual([
      2023, 9, 1,
    ]);
  });

  it('returns null for an unparseable date and keeps non-date values as strings', () => {
    expect(parseTableauDate('not a date')).toBeNull();
    expect(toSelectionValue({ fieldName: 'X', value: 'not a date', dataType: 'date' })).toBe(
      'not a date',
    ); // unparseable date → fall back to the raw string
    expect(toSelectionValue({ fieldName: 'Region', value: 'West', dataType: 'string' })).toBe(
      'West',
    );
    expect(toSelectionValue({ fieldName: 'Region', value: 'West' })).toBe('West'); // no dataType
  });
});
