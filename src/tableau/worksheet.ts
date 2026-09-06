// Read side of the Extensions API: locate the worksheet(s) we can annotate and
// pull their summary data.
//
// This is a WORKSPACE extension, so the live sheet object is
// `tableau.extensions.workspaceContent.workbook.activeSheet` (a Worksheet /
// Dashboard / Story wrapper).
//
//  - active sheet is a WORKSHEET  -> annotate it directly
//  - active sheet is a DASHBOARD  -> annotate any worksheet it CONTAINS. The
//    host's verifyActiveSheet() explicitly permits isInsideActiveDashboard(), so
//    selecting + annotating marks on a dashboard's worksheets is allowed (verified
//    against the vendored tableau.extensions.1.latest.js). Dashboard.worksheets
//    returns full Worksheet surfaces.
//  - active sheet is a STORY      -> nothing to annotate; reported to the UI.

import { type RawDataTable } from '../analysis/normalize';

/** The slice of the Extensions worksheet surface this extension calls. */
export interface WorksheetSurface {
  name: string;
  sheetType?: string;
  getSummaryDataAsync(options?: Record<string, unknown>): Promise<{
    columns: { fieldName: string; dataType: string; index?: number }[];
    data: { value?: unknown; nativeValue?: unknown; formattedValue?: unknown }[][];
    totalRowCount?: number;
  }>;
  selectMarksByValueAsync(
    // `value` is a Date for date/date-time fields (the API only matches those when
    // given a Date instance), else the underlying string.
    criteria: { fieldName: string; value: string | number | Date }[],
    updateType: string,
  ): Promise<void>;
  getSelectedMarksAsync(): Promise<{ data: SelectedMarksTable[] }>;
  clearSelectedMarksAsync(): Promise<void>;
  annotateMarkAsync(mark: { tupleId: number }, text: string): Promise<void>;
  getAnnotationsAsync(): Promise<unknown[]>;
  removeAnnotationAsync(annotation: unknown): Promise<void>;
  /**
   * The worksheet's visual spec — the mark type of each layer. Used to detect
   * viz types Tableau can't attach mark annotations to (text tables). Optional:
   * absent on older hosts / test fixtures — callers treat that as "annotatable".
   */
  getVisualSpecificationAsync?(): Promise<VisualSpecification>;
  /**
   * Subscribe to a worksheet event (e.g. MarkSelectionChanged). Returns an
   * unregister function. Optional: absent on hand-built test fixtures.
   */
  addEventListener?(eventType: string, handler: (event: unknown) => void): (() => void) | void;
}

/** Subset of the VisualSpecification returned by getVisualSpecificationAsync. */
export interface VisualSpecification {
  /** Index into `marksSpecifications` of the layer marks are drawn with. */
  activeMarksSpecificationIndex: number;
  marksSpecifications: { markType: string }[];
}

/** A DataTable as returned inside a MarksCollection from getSelectedMarksAsync. */
export interface SelectedMarksTable {
  columns: { fieldName: string; dataType: string; index?: number }[];
  data: { value?: unknown; nativeValue?: unknown; formattedValue?: unknown }[][];
  /** Parallel to `data` rows: each selected mark's id (and type/color). */
  marksInfo?: Array<{ tupleId: number }>;
}

export class NoActiveWorksheetError extends Error {}

export interface ActiveWorkbookInfo {
  name: string;
  activeSheet: string | null;
  activeSheetType: string | null;
  sheetCount: number;
}

/** Read-only active-workbook info from the Workspace Extensions API (or null). */
export function getActiveWorkbookInfo(): ActiveWorkbookInfo | null {
  const wc = window.tableau?.extensions?.workspaceContent as
    | {
        workbook?: {
          name?: string;
          activeSheet?: { name?: string; sheetType?: string };
          sheets?: unknown[];
        };
      }
    | undefined;
  const wb = wc?.workbook;
  if (!wb) return null;
  return {
    name: wb.name ?? '(untitled)',
    activeSheet: wb.activeSheet?.name ?? null,
    activeSheetType: wb.activeSheet?.sheetType ?? null,
    sheetCount: Array.isArray(wb.sheets) ? wb.sheets.length : 0,
  };
}

/** Shape of `workbook.activeSheet` — a Worksheet, or a Dashboard with `.worksheets`. */
type ActiveSheetLike = Partial<WorksheetSurface> & {
  name?: string;
  sheetType?: string;
  worksheets?: WorksheetSurface[];
};

// NOTE: This module deliberately exposes no "which zone is selected in the
// dashboard" helper. The shipped host does not surface zone selection to a
// workspace extension (see the long note in selection.ts), so there's nothing to
// read. We annotate whichever contained worksheet the user targets (mark click or
// the Worksheet picker), not the passively-selected zone.

/** A worksheet the user can analyze + annotate right now. */
export interface AnalyzableWorksheet {
  name: string;
  surface: WorksheetSurface;
}

/**
 * Every worksheet annotatable given the current active sheet:
 *  - worksheet active sheet -> just that one,
 *  - dashboard active sheet -> the worksheets it contains,
 *  - story / none           -> throws NoActiveWorksheetError with guidance.
 */
export function listAnalyzableWorksheets(): AnalyzableWorksheet[] {
  const wb = window.tableau?.extensions?.workspaceContent?.workbook as
    | { activeSheet?: ActiveSheetLike }
    | undefined;
  const sheet = wb?.activeSheet;
  if (!sheet) {
    throw new NoActiveWorksheetError(
      'No active sheet — open a workbook and select a worksheet or dashboard.',
    );
  }
  const type = (sheet.sheetType ?? '').toLowerCase();

  // Dashboard: annotate any contained worksheet (host allows via isInsideActiveDashboard).
  if (type === 'dashboard' || Array.isArray(sheet.worksheets)) {
    const sheets = (sheet.worksheets ?? []).filter(
      (w): w is WorksheetSurface => !!w && typeof w.getSummaryDataAsync === 'function',
    );
    if (sheets.length === 0) {
      throw new NoActiveWorksheetError(
        `The dashboard “${sheet.name ?? '?'}” has no worksheets to annotate.`,
      );
    }
    return sheets.map((w) => ({ name: w.name, surface: w }));
  }

  if (type === 'story') {
    throw new NoActiveWorksheetError(
      `The active sheet “${sheet.name ?? '?'}” is a story. Open a worksheet or dashboard to annotate its marks.`,
    );
  }

  // Plain worksheet active sheet.
  if (typeof sheet.getSummaryDataAsync !== 'function') {
    throw new NoActiveWorksheetError(
      `The active sheet “${sheet.name ?? '?'}” can’t be annotated. Open a worksheet or dashboard.`,
    );
  }
  return [{ name: sheet.name ?? '(worksheet)', surface: sheet as WorksheetSurface }];
}

/**
 * Re-resolve a worksheet by name against the live active sheet. Dashboard.worksheets
 * hands back fresh wrapper objects on each access, so we look the target up again at
 * apply time rather than trusting a stored surface (which could be stale after a
 * sheet change).
 */
export function resolveWorksheetByName(name: string): WorksheetSurface {
  const match = listAnalyzableWorksheets().find((w) => w.name === name);
  if (!match) {
    throw new NoActiveWorksheetError(
      `Worksheet “${name}” is no longer on the active sheet. Press Re-analyze.`,
    );
  }
  return match.surface;
}

export interface ActiveSheetData {
  sheetName: string;
  table: RawDataTable;
  totalRowCount: number;
}

/** Pull a worksheet's summary data as a raw table for the analyzer. */
export async function readWorksheet(
  ws: WorksheetSurface,
  maxRows = 5000,
): Promise<ActiveSheetData> {
  const dt = await ws.getSummaryDataAsync({
    maxRows,
    ignoreSelection: true, // analyze the whole sheet, not just what's selected
    ignoreAliases: false,
  });
  const table: RawDataTable = {
    columns: dt.columns.map((c, i) => ({
      fieldName: c.fieldName,
      dataType: c.dataType,
      index: c.index ?? i,
    })),
    data: dt.data,
  };
  return { sheetName: ws.name, table, totalRowCount: dt.totalRowCount ?? dt.data.length };
}

/**
 * Mark types Tableau can't attach a mark annotation to. A text table (crosstab)
 * draws grid cells rather than marks on a coordinate plane, so the native
 * "Annotate ▸ Mark" command — which annotateMarkAsync delegates to — is
 * unavailable, and the call fails on a live host. Tableau's public docs don't
 * enumerate this (they only say a mark must be selected), but it's established
 * product behaviour and the one type users actually hit. Kept as a set so it's
 * trivial to extend if another type proves unannotatable against a real host.
 */
export const UNANNOTATABLE_MARK_TYPES: ReadonlySet<string> = new Set(['text']);

export interface AnnotationSupport {
  supported: boolean;
  /** Active mark type ('bar', 'text', …), or null when the host didn't say. */
  markType: string | null;
}

/**
 * The active mark type of a worksheet via getVisualSpecificationAsync. Returns
 * null when the host doesn't expose the spec (older API / test fixtures) — the
 * caller then assumes the sheet is annotatable rather than blocking blindly.
 */
export async function getWorksheetMarkType(ws: WorksheetSurface): Promise<string | null> {
  const fn = ws.getVisualSpecificationAsync;
  if (typeof fn !== 'function') return null;
  try {
    const spec = await fn.call(ws);
    const marks = spec?.marksSpecifications;
    if (!Array.isArray(marks) || marks.length === 0) return null;
    const idx = spec.activeMarksSpecificationIndex ?? 0;
    return (marks[idx] ?? marks[0])?.markType ?? null;
  } catch {
    return null; // best-effort: never let spec probing fail an analysis
  }
}

/** Whether the extension can annotate this worksheet's marks (text tables can't). */
export async function getAnnotationSupport(ws: WorksheetSurface): Promise<AnnotationSupport> {
  const markType = await getWorksheetMarkType(ws);
  return { supported: !(markType && UNANNOTATABLE_MARK_TYPES.has(markType)), markType };
}
