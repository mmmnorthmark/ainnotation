// Reactive selection: subscribe to MarkSelectionChanged on the annotatable
// worksheets and read back the marks the user selected, WITH their live tupleIds.
//
// getSelectedMarksAsync returns a MarksCollection { data: DataTable[] }. Each
// DataTable carries `columns`, `data` (rows of DataValue), and `marksInfo` —
// parallel to the rows, one MarkInfo { type, color, tupleId } per mark. We
// normalize the first table into the engine's NormalizedTable and align the
// tupleIds to it, so describe.ts can annotate each selected mark directly.

import { normalizeDataTable, type RawDataTable } from '../analysis/normalize';
import { type Pick } from '../analysis/describe';
import { type NormalizedTable } from '../analysis/types';
import { type AnalyzableWorksheet, type WorksheetSurface } from './worksheet';

/** The live selection on one worksheet, ready for describe.ts. */
export interface SelectionRead {
  /** Normalized table of just the selected marks. */
  table: NormalizedTable;
  /** One pick per selected mark that carries a tupleId (rowIndex → `table`). */
  picks: Pick[];
}

/**
 * Candidate event-name strings for MarkSelectionChanged, most-likely first.
 *
 * The vendored bundle ships TWO `TableauEventType` enums — a dash-style
 * (`"mark-selection-changed"`) and a workspace/no-dash style
 * (`"markselectionchanged"`) — and a worksheet's `addEventListener` throws
 * `UnsupportedEventName` unless the key EXACTLY matches the manager it
 * registered (it does no translation). We can't know statically which enum a
 * given live host's worksheet managers use, so we try the runtime enum value
 * first, then both known literals, and attach to whichever the worksheet
 * accepts. (Passing the wrong one used to throw and get swallowed, leaving zero
 * listeners — selection then silently never switched the sheet.)
 */
function markSelectionEventNames(): string[] {
  const runtime = window.tableau?.TableauEventType?.MarkSelectionChanged as string | undefined;
  const candidates = [runtime, 'mark-selection-changed', 'markselectionchanged'].filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  );
  return [...new Set(candidates)];
}

/** Outcome of wiring up selection listeners, for a one-time UI diagnostic. */
export interface SelectionSubscription {
  /** How many worksheets we successfully attached a listener to. */
  attached: number;
  /** How many worksheets we tried. */
  total: number;
  /** The event-name string that the host accepted (null if none did). */
  event: string | null;
}

/** Read the current selection on a worksheet (empty picks when nothing is selected). */
export async function readSelectedMarks(ws: WorksheetSurface): Promise<SelectionRead> {
  const marks = await ws.getSelectedMarksAsync();
  const dt = marks.data?.[0];
  if (!dt || !Array.isArray(dt.data) || dt.data.length === 0) {
    return { table: emptyTable(), picks: [] };
  }
  const raw: RawDataTable = {
    columns: dt.columns.map((c, i) => ({
      fieldName: c.fieldName,
      dataType: c.dataType,
      index: c.index ?? i,
    })),
    data: dt.data,
  };
  const table = normalizeDataTable(raw);
  const picks: Pick[] = [];
  dt.data.forEach((_, rowIndex) => {
    const tupleId = dt.marksInfo?.[rowIndex]?.tupleId;
    if (typeof tupleId === 'number') picks.push({ rowIndex, tupleId });
  });
  return { table, picks };
}

/**
 * Subscribe to MarkSelectionChanged on every annotatable worksheet. When the user
 * selects marks on one, `onSelect` fires with that worksheet's name and the read
 * selection. Returns an unsubscribe that detaches every listener.
 *
 * Best-effort: worksheets whose surface lacks addEventListener are skipped, and a
 * throwing listener never breaks the others (manual analyze still works).
 */
export function subscribeMarkSelection(
  sheets: AnalyzableWorksheet[],
  onSelect: (worksheetName: string, read: SelectionRead) => void,
  onSubscribed?: (summary: SelectionSubscription) => void,
): () => void {
  const names = markSelectionEventNames();
  const unsubs: Array<() => void> = [];
  let attached = 0;
  let usedEvent: string | null = null;
  for (const { name, surface } of sheets) {
    if (typeof surface.addEventListener !== 'function') continue;
    const handler = () => {
      readSelectedMarks(surface)
        .then((read) => onSelect(name, read))
        .catch(() => {
          /* a failed read is non-fatal; the user can still Re-analyze */
        });
    };
    // Attach on the first event-name string this worksheet's manager accepts;
    // a mismatch throws synchronously, so we just try the next candidate.
    for (const ev of names) {
      try {
        const off = surface.addEventListener(ev, handler);
        if (typeof off === 'function') unsubs.push(off);
        attached += 1;
        usedEvent = ev;
        break;
      } catch {
        /* wrong event name for this host's manager — try the next candidate */
      }
    }
  }
  onSubscribed?.({ attached, total: sheets.length, event: usedEvent });
  return () => {
    for (const off of unsubs) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
  };
}

// NOTE: There is deliberately no "follow the dashboard's active zone" subscription
// here. Selecting a worksheet ZONE in a dashboard (a single click that doesn't
// touch a mark) is NOT surfaced to a workspace extension by the shipped host:
// there's no event to observe and no property that reports the active zone.
// `WorkspaceActiveSheetChanged` only reflects top-level tab switches, and the
// active-sheet payload carries no active-zone id. So zone-selection follow can't
// be done client-side with today's shipped APIs — the user switches sheets by
// clicking a mark (subscribeMarkSelection, above) or via the Worksheet picker.
// Enabling true zone-follow would require a host-side API change.

function emptyTable(): NormalizedTable {
  return { columns: [], rows: [], dimensions: [], measures: [] };
}
