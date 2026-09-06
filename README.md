# AInnotation — Workspace Extension

A Tableau Desktop **Workspace Extension** that analyzes the active worksheet's
data and **auto-adds rich annotations** to its most interesting marks. It reads
the sheet's summary data, computes insights (peaks, outliers, top contributors,
trends, big movers), proposes an editable, selectable list of annotations, and
applies the ones you pick straight onto the marks.

Built with Vite + React 18 + TypeScript. Client-side only — it uses the
Workspace Extensions API's annotation surface, with no companion server.

**Workspace Extensions** are currently under development and are available for
testing in a pre-release build of Tableau Desktop. Reach out to [Kyle Massey](https://tableau-datafam.slack.com/team/U0ALR5UHXNX)
in the [Tableau Community Slack](https://tableau-datafam.slack.com/) to request access.

---

> ## ⚠️ Disclaimer — read before using
>
> **AInnotation is an unofficial, unsupported code sample published for
> educational and illustrative purposes only.**
>
> - It is **not** an official Tableau or Salesforce product, and is **not
>   affiliated with, endorsed by, sponsored by, or supported by** Tableau
>   Software, LLC or Salesforce, Inc. "Tableau" and related marks are the
>   property of their respective owners.
> - It is provided **"AS IS", without warranty of any kind**, express or
>   implied, and **is not intended for production use**. See the
>   [LICENSE](LICENSE) (Apache-2.0) for the full warranty disclaimer and
>   limitation of liability.
> - It is an **example for learning** how a Tableau Workspace Extension can
>   analyze worksheet data and apply annotations. It may rely on behavior that
>   is undocumented or subject to change, and it may stop working without notice.
> - **No support is offered.** There is no SLA, no maintenance commitment, and
>   no guarantee of correctness, security, or fitness for any purpose. Use it,
>   and any ideas drawn from it, entirely at your own risk.

---

## Quick start

```bash
npm install          # resolves entirely from the public npm registry
npm run dev          # dev server on http://localhost:8770 (strict port)
npm test             # vitest
npm run typecheck    # tsc --noEmit
npm run build        # tsc -b && vite build
```

> **Dependencies.** Everything resolves from the public npm registry — a clean
> `npm install` works with no special configuration. The Tableau look-and-feel
> (a small subset of design-token colors) and the handful of icons the UI uses
> are inlined in-repo (`src/styles/global.css`, `src/components/icons.tsx`)
> rather than pulled from a private package.

Run without a host: `npm run dev` and open http://localhost:8770 in a browser.
With no Tableau host it starts in **Preview** mode, driven by bundled sample
datasets (`src/analysis/sample.ts`) — analysis and the candidate UI are fully
exercised; Apply is simulated.

## Dev-loading into Tableau Desktop

Workspace Extensions are gated behind a feature flag and auto-scanned from the
Extensions folder:

```bash
cp extensions/ainnotation.trex \
   "$HOME/Documents/My Tableau Repository/Extensions/"

open -na "/Applications/Tableau Desktop (Apple silicon) main.app" \
  --args -DInDesktopWorkspaceExtensions=true "<some-workbook.twbx>"
```

Open the pane from the **Extensions** menu → the extension's **Show**. The
`.trex` points `source-location` at the dev server (`http://localhost:8770`).
Select a **worksheet** — or a **dashboard**, in which case a picker lets you
choose which contained worksheet to annotate — then press **Re-analyze** → check
the annotations you want → **Apply selected**. (Stories have no annotatable
marks.)

## How it works

1. **Read** — `getSummaryDataAsync` on the active worksheet
   (`src/tableau/worksheet.ts`).
2. **Analyze** — pure engine over a normalized table
   (`src/analysis/`) emits ranked `AnnotationCandidate`s:

   | Kind | Glyph | What it flags |
   |------|-------|---------------|
   | Peak / Low point | ▲ ▼ | Highest / lowest mark for a measure |
   | High / Low outlier | ◆ ◇ | Robust (median/MAD) outliers, cross-checked against the Tukey IQR fence |
   | Top contributor | ◕ | Largest share of a (non-negative) total, with Gini + Pareto context |
   | Breakaway | ⋮ | A dominant cliff in a ranked distribution (a leader/cluster clear of the pack) |
   | Trend | ↗ | Net change across an ordered (date) axis, with linear-fit R² |
   | Biggest move | ⇅ | Largest step change between adjacent points |
   | Level shift | Δ | CUSUM regime change in a longer time series |
   | Off-trend | ⊘ | The mark furthest off the fitted line of the strongest measure pair (scatter) |

   Detectors are built on [`simple-statistics`](https://simple-statistics.github.io/)
   (`src/analysis/stats.ts`): robust MAD z-scores, IQR fences, Gini concentration,
   least-squares fits with R², and correlation. Each candidate carries a rich
   multiline body (rank, vs-average, σ, share %, R², residuals) plus structured
   `facts` for narration. All of `src/analysis/` is host-free and unit-tested.

   Vizzes built on the generated **Measure Names / Measure Values** fields fold
   several measures into rows (`Region · Sales`, `Region · Profit`, …), which
   would otherwise read as one mushed "Measure Values" measure. `pivotMeasureNames`
   (`src/analysis/pivot.ts`) detects that shape and unfolds it to one measure
   column per name *before* analysis, so each measure is ranked on its own scale.
3. **Narrate** — `src/analysis/narrate.ts` turns each candidate's `facts` into a
   flowing English sentence with [RosaeNLG](https://rosaenlg.org/) (Apache-2.0).
   The ~1.5 MB runtime is vendored (`public/vendor/rosaenlg_tiny_en_US.js`) and
   **lazy-loaded on first analyze**, so it never touches initial paint or the
   60 KB main bundle. Two invariants keep it safe: (a) **numbers stay byte-exact**
   — RosaeNLG's typographic pass would split `$1.23M` into `$1. 23M`, so every
   number, label, and measure name goes in as a letter-only placeholder token and
   is spliced back verbatim *after* rendering (RosaeNLG only ever sees fixed prose
   + its synonym/grammar directives); (b) it **degrades gracefully** — if the
   runtime can't load or a render throws, the candidate keeps the deterministic
   Phase-A `text`. Synonym choice is seeded from the candidate id, so narration is
   deterministic per insight.
4. **Apply** — the select → read → annotate loop (`src/tableau/annotate.ts`):
   select the mark by value, read its `tupleId`, `annotateMarkAsync`, clear the
   selection. Text is XML-escaped so it can't break the host's `<run>` wrapping.

### One list: Proposed + a reactive Selected section

The pane shows a single list. **Proposed** is the analysis flow above — the
engine's ranked candidates. Above it, a **Selected marks** section appears
*reactively*: the pane subscribes to `MarkSelectionChanged` on every annotatable
worksheet (`src/tableau/selection.ts`), so when you click marks in the viz it
**auto-targets that worksheet** (on a dashboard, the worksheet picker follows the
sheet you click in), describes each selected mark **in the context of the whole
sheet** (rank, vs-average, σ — `src/analysis/describe.ts`), and lists them at the
top. Both sections check together, and **Apply selected** applies whatever is
checked across them. Because the live selection already carries each mark's
`tupleId`, selected marks apply **directly via `annotateMarkAsync(tupleId, …)`** —
no select-by-value round trip, and your current selection is left untouched. In
preview mode (no host events) a "simulate selecting a few marks" affordance
exercises the same flow against the sample data. When you click a cell of a
Measure Names/Values viz, `describe.ts` resolves it to the specific measure you
clicked (not the row's most-extreme one) and ranks it against that measure's
pivoted, whole-sheet distribution.

### Switching sheets on a dashboard

On a dashboard you switch which worksheet AInnotation targets by **clicking a
mark in it** (which auto-targets that sheet, above) or by **picking it from the
Worksheet dropdown**. Note that merely *selecting a worksheet zone* in the
dashboard editor (a single click that doesn't land on a mark) does **not** move
the target: the shipped Tableau Desktop host doesn't surface which zone is
selected to a workspace extension — there's no event to observe and no property
that reports the active zone. `WorkspaceActiveSheetChanged` fires only on
top-level tab switches, and the active-sheet payload carries no active-zone id.
True zone-selection follow therefore needs a host-side API change; the client
falls back to mark-click + the picker. See the note in
`src/tableau/selection.ts`.

### Viz types that can't be annotated

Tableau can only attach mark annotations to marks on a coordinate plane. A **text
table (crosstab)** draws grid cells, not marks, so its native "Annotate ▸ Mark"
command — which `annotateMarkAsync` delegates to — is unavailable. On analyze the
pane reads the worksheet's mark type via `getVisualSpecificationAsync`
(`getAnnotationSupport` in `src/tableau/worksheet.ts`); when it's an
unannotatable type (`UNANNOTATABLE_MARK_TYPES`, currently just `text`) it still
shows what stands out but replaces the pitch with a friendly note and disables
**Apply**. The public API docs don't enumerate this, so the blocklist is a single
extensible set rather than a guess across the ambiguous types (map, pie, polygon,
viz-extension) that do work or are unverified.

## Layout

| Path | What |
|------|------|
| `src/analysis/` | Pure insight engine: normalize, Measure-Names pivot, format, generators, per-mark describe, samples (+ tests) |
| `src/tableau/` | Extensions bootstrap, active-worksheet read, mark-selection subscribe, annotation write (+ tests) |
| `src/components/` | Annotation cards, toasts |
| `src/App.tsx` | Analyze → propose → select → apply state machine (desktop + preview): one list with a reactive Selected-marks section, viz-type gating |
| `src/styles/` | Design-token theme wiring (light/dark) |
| `public/vendor/` | Vendored `tableau.extensions.1.latest.js` + lazy-loaded `rosaenlg_tiny_en_US.js` |
| `extensions/ainnotation.trex` | Dev-load manifest |
| `docs/annotation-api.md` | The annotation command surface + API reality |
