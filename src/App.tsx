import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import './App.css';
import { AnnotationCard } from './components/AnnotationCard';
import { ToastHost, useToasts } from './components/Toast';
import { normalizeDataTable, type RawDataTable } from './analysis/normalize';
import { pivotMeasureNames } from './analysis/pivot';
import { analyze } from './analysis/insights';
import { narrateCandidates } from './analysis/narrate';
import { describeSelection } from './analysis/describe';
import { type AnnotationCandidate, type NormalizedTable } from './analysis/types';
import { SAMPLE_SHEETS } from './analysis/sample';
import { type TableauMode } from './tableau/extensions';
import {
  getActiveWorkbookInfo,
  getAnnotationSupport,
  listAnalyzableWorksheets,
  NoActiveWorksheetError,
  readWorksheet,
  resolveWorksheetByName,
  type ActiveWorkbookInfo,
  type AnalyzableWorksheet,
  type AnnotationSupport,
} from './tableau/worksheet';
import { subscribeMarkSelection } from './tableau/selection';
import { applyCandidates, clearAllAnnotations, countAnnotations } from './tableau/annotate';
import { TypingLoader, getRandomTypingLoader, type TypingLoaderSelection } from './components/TypingLoader';

/** How many top-ranked candidates start out checked. */
const DEFAULT_SELECT = 5;

const runAnalyze = (table: RawDataTable): { norm: NormalizedTable; candidates: AnnotationCandidate[] } => {
  // Pivot Measure Names/Values vizzes to wide form first, so each measure is
  // analyzed as its own distribution instead of one mushed "Measure Values".
  const norm = normalizeDataTable(pivotMeasureNames(table));
  return { norm, candidates: analyze(norm) };
};

export function App({ mode }: { mode: TableauMode }) {
  const desktop = mode === 'desktop';
  const [wbInfo, setWbInfo] = useState<ActiveWorkbookInfo | null>(null);
  const [sampleId, setSampleId] = useState(SAMPLE_SHEETS[0].id);
  // Desktop: worksheets available on the active sheet (1 for a worksheet, N for a
  // dashboard) and which one the user has targeted.
  const [worksheets, setWorksheets] = useState<AnalyzableWorksheet[]>([]);
  const [selectedWs, setSelectedWs] = useState<string | null>(null);
  const [sheetName, setSheetName] = useState<string | null>(null);
  // Two candidate lists, shown together: analysis proposals, and the marks the
  // user selected in the viz (rendered as a "Selected" section above proposed).
  const [candidates, setCandidates] = useState<AnnotationCandidate[]>([]);
  const [propSel, setPropSel] = useState<Set<string>>(new Set());
  const [marks, setMarks] = useState<AnnotationCandidate[]>([]);
  const [markSel, setMarkSel] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [existing, setExisting] = useState(0);
  // Whether the targeted viz type accepts mark annotations (text tables don't).
  const [vizSupport, setVizSupport] = useState<AnnotationSupport>({ supported: true, markType: null });
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  // A chart-glyph loader shown while analyzing; re-rolled on each analyze run so
  // the indicator varies but stays stable for the duration of one run.
  const [loadingGlyph, setLoadingGlyph] = useState<TypingLoaderSelection>(getRandomTypingLoader);
  const { toasts, push, update, dismiss } = useToasts();

  // Last analyzed full-sheet table, kept so a live selection can be described in
  // the context of the whole distribution (rank, vs-average, σ).
  const analyzedTableRef = useRef<NormalizedTable | null>(null);
  // Suppress the selection handler while we apply proposed candidates (the
  // select → annotate → clear loop churns MarkSelectionChanged).
  const applyingRef = useRef(false);

  const setResults = useCallback(
    (name: string | null, cs: AnnotationCandidate[], norm: NormalizedTable | null) => {
      setSheetName(name);
      setCandidates(cs);
      setEdits({});
      setPropSel(new Set(cs.slice(0, DEFAULT_SELECT).map((c) => c.id)));
      analyzedTableRef.current = norm;
    },
    [],
  );

  // Current worksheet target, mirrored to a ref so doAnalyze can read it without
  // taking selectedWs as a dependency (which would churn its identity).
  const selectedWsRef = useRef<string | null>(null);
  selectedWsRef.current = selectedWs;

  const doAnalyze = useCallback(
    async (targetName?: string) => {
      setAnalyzing(true);
      setLoadingGlyph(getRandomTypingLoader());
      try {
        if (desktop) {
          const sheets = listAnalyzableWorksheets(); // throws NoActiveWorksheetError w/ guidance
          setWorksheets(sheets);
          // Prefer, in order: an explicit target, the current target, then the
          // first worksheet. (Desktop doesn't surface which zone the user has
          // selected in a dashboard, so there's no zone to seed from — the user
          // lands on a sheet by clicking a mark in it or via the Worksheet picker.)
          const want = targetName ?? selectedWsRef.current;
          const target = sheets.find((s) => s.name === want) ?? sheets[0];
          selectedWsRef.current = target.name;
          setSelectedWs(target.name);
          const { sheetName: name, table } = await readWorksheet(target.surface);
          const { norm, candidates: raw } = runAnalyze(table);
          const cs = await narrateCandidates(raw);
          setResults(name, cs, norm);
          setExisting(await countAnnotations(target.surface).catch(() => 0));
          setVizSupport(await getAnnotationSupport(target.surface));
          if (cs.length === 0) push('info', `No standout marks found on “${name}”.`);
        } else {
          const sheet = SAMPLE_SHEETS.find((s) => s.id === sampleId) ?? SAMPLE_SHEETS[0];
          const { norm, candidates: raw } = runAnalyze(sheet.table);
          setResults(sheet.name, await narrateCandidates(raw), norm);
          setMarks([]);
          setVizSupport({ supported: true, markType: null });
        }
      } catch (e) {
        const msg =
          e instanceof NoActiveWorksheetError ? e.message : `Analyze failed: ${(e as Error).message}`;
        push('error', msg);
        setWorksheets([]);
        setResults(null, [], null);
        setVizSupport({ supported: true, markType: null });
      } finally {
        setAnalyzing(false);
      }
    },
    [desktop, sampleId, push, setResults],
  );

  // Switch the targeted worksheet (dashboard case) and re-analyze immediately.
  const pickWorksheet = useCallback(
    (name: string) => {
      void doAnalyze(name);
    },
    [doAnalyze],
  );

  // React to the user selecting marks in the viz: auto-target that worksheet and
  // describe each selected mark in context (shown in the "Selected" section).
  const onSelection = useCallback(
    async (wsName: string, read: { table: NormalizedTable; picks: { rowIndex: number; tupleId: number }[] }) => {
      if (applyingRef.current) return; // our own apply loop churned the selection
      if (read.picks.length === 0) {
        // A deselect. Only clear if it's for the sheet we're currently targeting —
        // otherwise a stale deselect on the previously-focused dashboard sheet
        // would wipe the marks the user just selected on a different sheet.
        if (wsName === selectedWsRef.current) {
          setMarks([]);
          setMarkSel(new Set());
        }
        return;
      }
      // Auto-target the worksheet the user is interacting with (refreshing its
      // full-sheet table for context) if it isn't the current target. On a
      // dashboard this makes the worksheet picker follow the sheet you click in.
      if (selectedWsRef.current !== wsName || !analyzedTableRef.current) {
        await doAnalyze(wsName);
      }
      const full = analyzedTableRef.current;
      if (!full) return;
      const described = await narrateCandidates(describeSelection(full, read.table, read.picks));
      setMarks(described);
      setMarkSel(new Set(described.map((m) => m.id)));
    },
    [doAnalyze],
  );
  const selectRef = useRef(onSelection);
  selectRef.current = onSelection;

  // Re-run when the analyzer identity changes (preview sample switch, mount).
  useEffect(() => {
    void doAnalyze();
  }, [doAnalyze]);

  // Desktop: track the active workbook + re-analyze when the sheet changes.
  const analyzeRef = useRef(doAnalyze);
  analyzeRef.current = doAnalyze;
  useEffect(() => {
    if (!desktop) return;
    setWbInfo(getActiveWorkbookInfo());
    const wc = window.tableau?.extensions?.workspaceContent as
      | { addEventListener?: (ev: string, cb: () => void) => (() => void) | undefined }
      | undefined;
    const T = window.tableau?.TableauEventType;
    const events = [T?.WorkbookChanged ?? 'workbook-changed', T?.ActiveSheetChanged ?? 'active-sheet-changed'];
    const onChange = () => {
      setWbInfo(getActiveWorkbookInfo());
      void analyzeRef.current();
    };
    const unsub: Array<() => void> = [];
    try {
      for (const ev of events) {
        const u = wc?.addEventListener?.(ev, onChange);
        if (typeof u === 'function') unsub.push(u);
      }
    } catch {
      /* events are best-effort; manual "Analyze" always works */
    }
    return () => unsub.forEach((u) => u());
  }, [desktop]);

  // Desktop: subscribe to MarkSelectionChanged on every annotatable worksheet.
  // Warn once if the host accepts no listener — then live sheet-follow is off and
  // the user must switch sheets with the Worksheet picker / Re-analyze.
  const warnedNoSelectionRef = useRef(false);
  useEffect(() => {
    if (!desktop || worksheets.length === 0) return;
    return subscribeMarkSelection(
      worksheets,
      (name, read) => {
        void selectRef.current(name, read);
      },
      (summary) => {
        // eslint-disable-next-line no-console
        console.info(
          `[AInnotation] mark-selection listeners: ${summary.attached}/${summary.total}` +
            (summary.event ? ` via "${summary.event}"` : ' (no accepted event name)'),
        );
        if (summary.attached === 0 && !warnedNoSelectionRef.current) {
          warnedNoSelectionRef.current = true;
          push(
            'info',
            'Live mark selection isn’t available on this host — use the Worksheet picker or Re-analyze to switch sheets.',
          );
        }
      },
    );
  }, [desktop, worksheets, push]);

  // Preview: no host selection events, so simulate picking the first few marks so
  // the Selected flow is exercisable without Tableau.
  const simulateSelection = useCallback(async () => {
    const full = analyzedTableRef.current;
    if (!full || full.rows.length === 0) {
      push('info', 'Nothing to select in this sample.');
      return;
    }
    const picks = full.rows
      .slice(0, Math.min(3, full.rows.length))
      .map((_, i) => ({ rowIndex: i, tupleId: i }));
    const described = await narrateCandidates(describeSelection(full, full, picks));
    setMarks(described);
    setMarkSel(new Set(described.map((m) => m.id)));
  }, [push]);

  // The checked annotations across BOTH sections, selected marks first (they're
  // user-chosen and apply on top), each with its live edited text.
  const chosen = useMemo(() => {
    const pick = (arr: AnnotationCandidate[], set: Set<string>) =>
      arr.filter((c) => set.has(c.id)).map((c) => ({ ...c, text: edits[c.id] ?? c.text }));
    return [...pick(marks, markSel), ...pick(candidates, propSel)];
  }, [marks, markSel, candidates, propSel, edits]);

  const apply = useCallback(async () => {
    if (!vizSupport.supported) {
      push('info', 'This viz type doesn’t support mark annotations.');
      return;
    }
    if (chosen.length === 0) {
      push('info', 'Select at least one annotation to apply.');
      return;
    }
    setApplying(true);
    applyingRef.current = true;
    const id = push('progress', `Annotating 0/${chosen.length}…`, 0);
    try {
      if (desktop) {
        const ws = resolveWorksheetByName(selectedWs ?? '');
        const res = await applyCandidates(ws, chosen, (done, total) =>
          update(id, 'progress', `Annotating ${done}/${total}…`),
        );
        const fail = res.failures.length;
        update(
          id,
          fail ? 'error' : 'success',
          fail
            ? `Added ${res.applied}; ${fail} couldn’t be placed. ${res.failures[0].reason}`
            : `Added ${res.applied} annotation${res.applied === 1 ? '' : 's'} to “${sheetName}”.`,
        );
        setExisting(await countAnnotations(ws).catch(() => existing + res.applied));
      } else {
        for (let i = 0; i < chosen.length; i++) {
          await delay(280);
          update(id, 'progress', `Annotating ${i + 1}/${chosen.length}…`);
        }
        update(
          id,
          'success',
          `(preview) Would add ${chosen.length} annotation${chosen.length === 1 ? '' : 's'} to “${sheetName}”.`,
        );
      }
    } catch (e) {
      update(id, 'error', `Apply failed: ${(e as Error).message}`);
    } finally {
      setApplying(false);
      // Keep the selection guard up briefly: the select→clear loop emits
      // MarkSelectionChanged asynchronously, and a trailing event must not flip
      // us into the Selected view after apply finishes.
      setTimeout(() => {
        applyingRef.current = false;
      }, 500);
      setTimeout(() => dismiss(id), 5000);
    }
  }, [chosen, desktop, selectedWs, sheetName, existing, vizSupport.supported, push, update, dismiss]);

  const clearAll = useCallback(async () => {
    if (!desktop) {
      push('info', '(preview) Clear removes every annotation on the active worksheet.');
      return;
    }
    try {
      const ws = resolveWorksheetByName(selectedWs ?? '');
      const n = await clearAllAnnotations(ws);
      push('success', n ? `Removed ${n} annotation${n === 1 ? '' : 's'}.` : 'No annotations to remove.');
      setExisting(0);
    } catch (e) {
      push('error', `Clear failed: ${(e as Error).message}`);
    }
  }, [desktop, selectedWs, push]);

  const toggleIn = (setSel: typeof setPropSel, cid: string) =>
    setSel((s) => {
      const next = new Set(s);
      next.has(cid) ? next.delete(cid) : next.add(cid);
      return next;
    });
  const selectAll = () => {
    setMarkSel(new Set(marks.map((m) => m.id)));
    setPropSel(new Set(candidates.map((c) => c.id)));
  };
  const selectNone = () => {
    setMarkSel(new Set());
    setPropSel(new Set());
  };
  const total = marks.length + candidates.length;

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ✦
          </span>
          <span className="brand-name">AInnotation</span>
          <span className={`mode-badge mode-badge--${mode}`}>
            {desktop ? 'Connected' : 'Preview'}
          </span>
        </div>
        <p className="tagline">Analyze the active viz and annotate its most interesting marks.</p>
      </header>

      <div className="toolbar">
        <div className="target">
          {desktop ? (
            <>
              {worksheets.length > 1 ? (
                <label
                  className="sample-pick"
                  title={`Dashboard “${wbInfo?.activeSheet ?? ''}” — pick a sheet to analyze, or click a mark in one`}
                >
                  Worksheet
                  <select
                    value={selectedWs ?? ''}
                    onChange={(e) => pickWorksheet(e.target.value)}
                    disabled={analyzing}
                  >
                    {worksheets.map((w) => (
                      <option key={w.name} value={w.name}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <span className="target-sheet" title={wbInfo?.name ?? ''}>
                  {sheetName ?? selectedWs ?? wbInfo?.activeSheet ?? 'No worksheet'}
                </span>
              )}
              {existing > 0 && <span className="target-count">{existing} on sheet</span>}
            </>
          ) : (
            <label className="sample-pick">
              Sample sheet
              <select value={sampleId} onChange={(e) => setSampleId(e.target.value)}>
                {SAMPLE_SHEETS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="actions">
          <button className="btn btn-ghost" onClick={() => void doAnalyze()} disabled={analyzing}>
            {analyzing ? 'Analyzing…' : 'Re-analyze'}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void apply()}
            disabled={applying || chosen.length === 0 || !vizSupport.supported}
            title={vizSupport.supported ? undefined : 'This viz type doesn’t support mark annotations.'}
          >
            Apply selected ({chosen.length})
          </button>
          <button className="btn btn-ghost" onClick={() => void clearAll()} disabled={applying}>
            Clear all
          </button>
        </div>
      </div>

      <main className="app-main">
        {!vizSupport.supported && (
          <div className="viz-note" role="status">
            <span className="viz-note-icon" aria-hidden>
              ✦
            </span>
            <p className="viz-note-text">
              This is a {friendlyVizName(vizSupport.markType)}, and Tableau can’t pin annotations to
              its cells. Open a chart view — a bar, line, map, or scatter — and AInnotation can
              annotate its marks. You can still see what stands out below.
            </p>
          </div>
        )}

        {total > 0 && (
          <div className="list-head">
            <span>
              <strong>{total}</strong> annotation{total === 1 ? '' : 's'} ·{' '}
              <strong>{chosen.length}</strong> checked
            </span>
            <span className="list-head-actions">
              <button className="link-btn" onClick={selectAll}>
                Select all
              </button>
              <button className="link-btn" onClick={selectNone}>
                None
              </button>
            </span>
          </div>
        )}

        {/* Hint that selecting marks in the viz adds them here — shown while
            nothing is selected. In preview there are no host events, so offer a
            way to simulate a selection. */}
        {marks.length === 0 && total > 0 && vizSupport.supported && (
          <p className="selection-hint">
            {desktop ? (
              worksheets.length > 1
                ? 'Tip: click a mark in any sheet to analyze and annotate it — or pick a sheet above.'
                : 'Tip: select marks in the viz to annotate them directly.'
            ) : (
              <>
                Selection is live in Tableau — in preview,{' '}
                <button className="link-btn" onClick={() => void simulateSelection()}>
                  simulate selecting a few marks
                </button>
                .
              </>
            )}
          </p>
        )}

        {marks.length > 0 && (
          <section className="ann-section">
            <div className="section-head">
              <span className="section-title">Selected marks</span>
              <span className="section-count">{marks.length}</span>
            </div>
            <div className="ann-list">
              {marks.map((c) => (
                <AnnotationCard
                  key={c.id}
                  candidate={c}
                  selected={markSel.has(c.id)}
                  text={edits[c.id] ?? c.text}
                  onToggle={() => toggleIn(setMarkSel, c.id)}
                  onEdit={(text) => setEdits((e) => ({ ...e, [c.id]: text }))}
                />
              ))}
            </div>
          </section>
        )}

        <section className="ann-section">
          {marks.length > 0 && (
            <div className="section-head">
              <span className="section-title">Proposed</span>
              <span className="section-count">{candidates.length}</span>
            </div>
          )}
          {analyzing && candidates.length === 0 ? (
            <div className="empty empty--analyzing">
              <TypingLoader
                type={loadingGlyph.type}
                variant={loadingGlyph.variant}
                scalePercent={300}
              />
              <p className="analyzing-label">Analyzing the active sheet…</p>
            </div>
          ) : candidates.length > 0 ? (
            <div className="ann-list">
              {candidates.map((c) => (
                <AnnotationCard
                  key={c.id}
                  candidate={c}
                  selected={propSel.has(c.id)}
                  text={edits[c.id] ?? c.text}
                  onToggle={() => toggleIn(setPropSel, c.id)}
                  onEdit={(text) => setEdits((e) => ({ ...e, [c.id]: text }))}
                />
              ))}
            </div>
          ) : (
            <div className={marks.length > 0 ? 'empty empty--sub' : 'empty'}>
              {proposedEmpty(desktop, marks.length > 0, simulateSelection)}
            </div>
          )}
        </section>
      </main>

      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

/** Empty state for the Proposed section. `hasSelected` = a Selected section is
 *  already shown above, so this is the secondary "no others" case. */
function proposedEmpty(desktop: boolean, hasSelected: boolean, simulate: () => void): ReactNode {
  if (hasSelected) {
    return desktop ? 'No other standout marks found.' : 'No other candidates for this sample.';
  }
  if (desktop) {
    return 'No standout marks found. Select marks in the viz to annotate them directly, or press Re-analyze.';
  }
  return (
    <>
      No candidates for this sample. Selection is live in Tableau — in preview,{' '}
      <button className="link-btn" onClick={() => void simulate()}>
        simulate selecting a few marks
      </button>
      .
    </>
  );
}

/** Human-friendly name for a mark type we can't annotate (for the UI note). */
function friendlyVizName(markType: string | null): string {
  return markType === 'text' ? 'text table' : 'view';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
