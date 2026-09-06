// Write side of the Extensions API: apply, list, and clear mark annotations on
// the active worksheet.
//
// VERIFIED API REALITY (checked against the shipped tableau.extensions.1.latest.js,
// apiVersion 1.19.0): a workspace extension CAN annotate the active sheet. The
// surface is `worksheet.annotateMarkAsync(mark, text)` /
// `getAnnotationsAsync()` / `removeAnnotationAsync(annotation)`, backed by the
// allowlisted host commands CreateAnnotation / GetAnnotations / RemoveAnnotation
// (ExtensionPermission::None — permitted without full-data). Unlike workbook-XML
// injection (host-blocked), these are real, permitted verbs. See docs/annotation-api.md.
//
// The catch: annotateMarkAsync attaches to a MARK, and a mark is identified by a
// `tupleId` — which only comes back from getSelectedMarksAsync. Summary-data rows
// carry no tupleId. So to annotate an analyzed row we (1) select the mark(s) by
// dimension value, (2) read the selection back to get tupleIds, (3) annotate,
// (4) restore an empty selection.
//
// Selecting by value is FRAGILE: date/date-time criteria and Tableau-generated
// fields (e.g. a forecast's "Forecast indicator") often match zero marks even
// when the mark exists. So we don't insist the criteria pin down exactly one
// mark. Instead we select a SUPERSET with the reliably-selectable dimensions,
// read every selected mark back (each row carries its own tupleId AND its field
// values), then pick the exact target row in JS — date-aware. If the full
// criteria come up empty we broaden progressively: full → drop dates → first
// plain dimension. See resolveMark below.

import { type AnnotationCandidate, type FieldValue } from '../analysis/types';
import { type SelectedMarksTable, type WorksheetSurface } from './worksheet';

export class NoMarkError extends Error {}

const DATE_TYPES = new Set(['date', 'date-time', 'datetime']);

/**
 * The value to hand `selectMarksByValueAsync` for one target field. Date/date-time
 * fields MUST be a `Date` instance — the Extensions API serializes those via UTC
 * getters (`serializeDateForPlatform`); a stringified date is passed through
 * verbatim and never matches a mark (→ "mark not found"). Everything else is the
 * underlying string as-is.
 */
export function toSelectionValue(t: FieldValue): string | Date {
  if (t.dataType && DATE_TYPES.has(t.dataType)) {
    const d = parseTableauDate(t.value);
    if (d) return d;
  }
  return t.value;
}

/**
 * Parse a Tableau summary-data date string ("2027-09-01 00:00:00", or date-only)
 * into a Date whose UTC components equal those literal fields — so the API's
 * UTC-based serialization reproduces the same value. Returns null if unparseable
 * (caller then falls back to the raw string).
 */
export function parseTableauDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/.exec(s.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  const dt = new Date(Date.UTC(+y, +mo - 1, +d, +(h ?? 0), +(mi ?? 0), +(se ?? 0)));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** Escape XML specials so our text can't break the host's <run> wrapping. */
export function sanitizeAnnotationText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r\n?/g, '\n');
}

function selectionReplace(): string {
  // Extensions API SelectionUpdateType.Replace === "replace".
  return (window.tableau?.SelectionUpdateType?.Replace as string) ?? 'replace';
}

export interface ApplyOutcome {
  applied: number;
  failures: { candidate: AnnotationCandidate; reason: string }[];
}

/**
 * Apply one candidate: resolve its mark to a tupleId, annotate, clear.
 * Throws NoMarkError if the target dimensions don't resolve to a selectable mark.
 */
export async function applyCandidate(
  ws: WorksheetSurface,
  candidate: AnnotationCandidate,
): Promise<void> {
  // Reactive-selection candidates already hold the live mark's tupleId, so we can
  // annotate it directly — no select-by-value round trip (and no clobbering the
  // user's current selection).
  if (typeof candidate.tupleId === 'number') {
    await ws.annotateMarkAsync(
      { tupleId: candidate.tupleId },
      sanitizeAnnotationText(candidate.text),
    );
    return;
  }
  // Empty target (no dimensions) can't be selected by value; nothing to attach to.
  if (candidate.target.length === 0) {
    throw new NoMarkError('This sheet has no dimensions to target a mark.');
  }
  try {
    const found = await resolveMark(ws, candidate.target);
    if (found.tupleId === undefined) {
      throw new NoMarkError(`Couldn't locate the mark for “${candidate.label}” (${found.diag}).`);
    }
    await ws.annotateMarkAsync({ tupleId: found.tupleId }, sanitizeAnnotationText(candidate.text));
  } finally {
    // Always restore an empty selection so we don't leave the sheet filtered/selected.
    await ws.clearSelectedMarksAsync().catch(() => {});
  }
}

/**
 * Selection criteria attempts, most-specific first. selectMarksByValueAsync
 * matches ALL given criteria, so fewer criteria = broader (superset) selection.
 * We drop the fragile fields progressively so a stubborn date/generated field
 * can't zero out the whole selection — the exact mark is then picked in JS.
 */
export function selectionAttempts(target: FieldValue[]): { fieldName: string; value: string | Date }[][] {
  const isDate = (t: FieldValue) => !!t.dataType && DATE_TYPES.has(t.dataType);
  const toCriteria = (fs: FieldValue[]) => fs.map((t) => ({ fieldName: t.fieldName, value: toSelectionValue(t) }));
  const nonDate = target.filter((t) => !isDate(t));
  const buckets: FieldValue[][] = [
    target, // full criteria (dates sent as Date instances)
    nonDate, // drop date/date-time fields (match them in JS instead)
    nonDate.slice(0, 1), // first plain dimension only — broadest safe superset
  ];
  const seen = new Set<string>();
  const out: FieldValue[][] = [];
  for (const fs of buckets) {
    if (fs.length === 0) continue;
    const sig = fs.map((t) => t.fieldName).join('|');
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(fs);
  }
  return out.map(toCriteria);
}

/**
 * Resolve a target to a live mark's tupleId. Select a superset, read the marks
 * back (each carries its field values + tupleId), and match the exact row in JS.
 * Broadens the criteria until a selection comes back, then narrows precisely.
 */
async function resolveMark(
  ws: WorksheetSurface,
  target: FieldValue[],
): Promise<{ tupleId?: number; diag: string }> {
  const attempts = selectionAttempts(target);
  let lastCount = 0;
  for (const criteria of attempts) {
    await ws.selectMarksByValueAsync(criteria, selectionReplace());
    const table = (await ws.getSelectedMarksAsync()).data?.[0];
    const count = table?.marksInfo?.length ?? 0;
    lastCount = count;
    if (!table || count === 0) continue;
    const tupleId = matchMark(table, target);
    if (tupleId !== undefined) return { tupleId, diag: 'matched' };
    // Full criteria that already pins a single mark: trust it even if the
    // returned value strings differ from summary data (formatting drift).
    if (count === 1 && criteria.length === target.length) {
      return { tupleId: table.marksInfo![0].tupleId, diag: 'single' };
    }
  }
  return { diag: `${attempts.length} attempt(s), last selected ${lastCount} mark(s)` };
}

/** Find the selected-marks row whose fields all match the target; its tupleId. */
function matchMark(table: SelectedMarksTable, target: FieldValue[]): number | undefined {
  const cols = table.columns ?? [];
  const marks = table.marksInfo ?? [];
  const idxOf = (fieldName: string) => cols.findIndex((c) => c.fieldName === fieldName);
  for (let r = 0; r < marks.length; r++) {
    const ok = target.every((t) => {
      const ci = idxOf(t.fieldName);
      if (ci < 0) return true; // field absent from the returned table — can't disprove
      return valueMatches(t, table.data?.[r]?.[ci]);
    });
    if (ok) return marks[r].tupleId;
  }
  return undefined;
}

/** Does a selected-mark cell match a target field value? Date-aware, format-tolerant. */
function valueMatches(
  t: FieldValue,
  cell?: { value?: unknown; nativeValue?: unknown; formattedValue?: unknown },
): boolean {
  if (!cell) return false;
  const reps = [cell.value, cell.nativeValue, cell.formattedValue];
  if (reps.some((v) => v != null && String(v) === t.value)) return true;
  // Dates rarely round-trip as identical strings across API calls, so compare by
  // instant: parse the target string and each representation (which may itself be
  // a Date instance or a date string) and check for an equal timestamp.
  if (t.dataType && DATE_TYPES.has(t.dataType)) {
    const td = parseTableauDate(t.value);
    if (td) {
      for (const v of reps) {
        const cd = v instanceof Date ? v : typeof v === 'string' ? parseTableauDate(v) : null;
        if (cd && cd.getTime() === td.getTime()) return true;
      }
    }
  }
  return false;
}

/** Apply many candidates to a worksheet in order, collecting per-candidate failures. */
export async function applyCandidates(
  ws: WorksheetSurface,
  candidates: AnnotationCandidate[],
  onProgress?: (done: number, total: number, current: AnnotationCandidate) => void,
): Promise<ApplyOutcome> {
  const failures: ApplyOutcome['failures'] = [];
  let applied = 0;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    onProgress?.(i, candidates.length, c);
    try {
      await applyCandidate(ws, c);
      applied++;
    } catch (e) {
      failures.push({ candidate: c, reason: (e as Error).message });
    }
  }
  onProgress?.(candidates.length, candidates.length, candidates[candidates.length - 1]);
  return { applied, failures };
}

/** Count of annotations currently on a worksheet. */
export async function countAnnotations(ws: WorksheetSurface): Promise<number> {
  const list = await ws.getAnnotationsAsync();
  return Array.isArray(list) ? list.length : 0;
}

/** Remove every annotation on a worksheet; returns how many were removed. */
export async function clearAllAnnotations(ws: WorksheetSurface): Promise<number> {
  const list = await ws.getAnnotationsAsync();
  let removed = 0;
  for (const a of list) {
    try {
      await ws.removeAnnotationAsync(a);
      removed++;
    } catch {
      // Best effort — a stale annotation ref just gets skipped.
    }
  }
  return removed;
}
