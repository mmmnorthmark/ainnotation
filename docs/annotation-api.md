# The annotation command surface

How AInnotation talks to Tableau Desktop, and why the annotation path works
on-host where workbook-XML injection does not.

## Why this extension actually runs on-host

An earlier experiment tried to *inject* a viz by rewriting workbook XML through
the `set-workbook-xml` verb. That verb is **host-blocked** for workspace
extensions on shipped Desktop — it isn't in the workspace command allowlist, so
the call fails with `UNKNOWN_VERB_ID` before any permission check.

Annotation is different. The three commands AInnotation needs —
`CreateAnnotation`, `GetAnnotations`, `RemoveAnnotation` — **are** in the
shipped workspace allowlist, at `ExtensionPermission::None` (no `full data`
grant required to reach them). They are exposed on the worksheet object as:

| Extensions API method                         | Host command       | Permission |
| ---------------------------------------------- | ------------------ | ---------- |
| `worksheet.annotateMarkAsync(mark, text)`      | `CreateAnnotation` | None       |
| `worksheet.getAnnotationsAsync()`              | `GetAnnotations`   | None       |
| `worksheet.removeAnnotationAsync(annotation)`  | `RemoveAnnotation` | None       |

Signatures verified against the vendored
`public/vendor/tableau.extensions.1.latest.js` (apiVersion 1.19.0).

## Active-sheet scope (worksheets *and* dashboards)

This is a **workspace** extension, so the live surface is
`tableau.extensions.workspaceContent.workbook.activeSheet` — a `Worksheet`,
`Dashboard`, or `Story` object. `listAnalyzableWorksheets()`
(`src/tableau/worksheet.ts`) resolves it to the worksheets we can annotate:

- **Worksheet** active sheet → that one worksheet.
- **Dashboard** active sheet → **every worksheet the dashboard contains**, via
  `dashboard.worksheets` (which returns full `Worksheet` surfaces). The UI shows a
  worksheet picker so you choose which contained sheet to annotate.
- **Story** / none → `NoActiveWorksheetError` with guidance.

Why the dashboard case works: annotate/select go through the worksheet's
`verifyActiveSheet()`, and that guard passes when the sheet is the active sheet
**or** `isInsideActiveDashboard()` **or** `isInsideActiveStoryPoint()` — verified
in the vendored `tableau.extensions.1.latest.js`:

```js
verifyActiveSheet(){
  const e=this.active, t=this.isInsideActiveDashboard(), r=this.isInsideActiveStoryPoint();
  if(!e&&!t&&!r) throw new TableauError(NotActiveSheet, "Operation not allowed on non-active sheet");
}
isInsideActiveDashboard(){ return this._parentDashboardImpl && this._parentDashboardImpl.active }
```

So a worksheet inside the *active* dashboard is a legal annotation target. Marks
on worksheets that aren't in the active sheet would fail this guard — the
per-candidate `try/catch` in `applyCandidates` surfaces that as a skip.

## The select → read → annotate loop

`annotateMarkAsync` attaches text to a **mark**, and a mark is identified by a
`tupleId`. The problem: `getSummaryDataAsync` rows carry **no** tupleId — the
only place a tupleId comes back is `getSelectedMarksAsync`. So to annotate an
analyzed row we round-trip through the selection API
(`src/tableau/annotate.ts`, `applyCandidate`):

1. **Select** the mark by its dimension values —
   `selectMarksByValueAsync(criteria, Replace)`, where `criteria` is
   `[{fieldName, value}, …]` from the candidate's `target`.
2. **Read** the selection back — `getSelectedMarksAsync()` →
   `data[0].marksInfo[0].tupleId`.
3. **Annotate** — `annotateMarkAsync({ tupleId }, sanitizedText)`.
4. **Clear** — `clearSelectedMarksAsync()` in a `finally`, so we never leave the
   sheet in a selected/filtered state even if a step throws.

A candidate whose `target` is empty (a whole-sheet insight with no dimension to
select) can't be attached to a mark, so it fails with `NoMarkError` and is
reported as a skip rather than crashing the batch.

## Text escaping

The host wraps annotation text as
`<formatted-text><run>${text}</run></formatted-text>` with **no escaping**. Raw
`&`, `<`, `>` in insight text (e.g. "Sales > $1M") would corrupt the run markup.
`sanitizeAnnotationText()` escapes those three characters and normalizes
`\r\n` → `\n` (newlines are preserved — the host honors them inside a run).

## Data shapes

`getSummaryDataAsync({ maxRows, ignoreSelection: true, ignoreAliases: false })`
returns:

- `columns: { fieldName, dataType, index }[]`
- `data: DataValue[][]` where `DataValue = { value, nativeValue, formattedValue, aliasValue, hasAlias }`
- `totalRowCount`

`normalizeDataTable()` (`src/analysis/normalize.ts`) classifies each column as a
**measure** (float/integer) or **dimension**, flags date/date-time dimensions as
`ordered`, and produces the host-free `NormalizedTable` the analyzer runs on.
Everything under `src/analysis/` is pure — no `window.tableau` — so it unit-tests
without a host (see the `*.test.ts` files).

## What's verified vs. uncertain

- **Verified** (against the vendored lib): the three annotation verbs exist, are
  allowlisted at `None`, and the method signatures match.
- **Verified** (empirically): `executeCommandAsync` / `set-workbook-xml` are *not*
  routable for workspace extensions on shipped Desktop. AInnotation deliberately
  avoids that path.
- **Uncertain until run on a live host**: exact `tupleId` round-trip behavior for
  every mark type, and whether `selectMarksByValueAsync` resolves multi-dimension
  criteria identically across mark types. The loop is written defensively (per
  candidate try/catch, always-clear `finally`) so partial failures degrade to
  per-annotation skips instead of aborting the batch.
- **Viz-type gating**: the public docs enumerate *no* unsupported mark types —
  `help.tableau.com` only says the "Mark" annotation is available when a mark is
  selected, and neither the API reference nor GitHub issues list a `@throws` or an
  excluded `MarkType`. The one established limitation is the **text table
  (crosstab)**: its cells are grid-positioned, not coordinate-plane marks, so the
  native "Annotate ▸ Mark" is unavailable and `annotateMarkAsync` has nothing
  valid to bind to. So `getAnnotationSupport` reads the mark type via
  `getVisualSpecificationAsync` and blocks only `text` (`UNANNOTATABLE_MARK_TYPES`
  in `src/tableau/worksheet.ts`); map/pie/polygon/viz-extension are left enabled
  (they work or are unverified — over-blocking would break legitimate vizzes). If
  the host doesn't expose the spec, the sheet is assumed annotatable.
