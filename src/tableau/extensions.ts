// Thin wrapper around Tableau Extensions API initialization.
//
// Tableau Desktop injects `window.tableau` via the vendored API script before
// the app boots. Outside Desktop (e.g. a plain browser tab during UI work) the
// global is absent — we detect that and run in a degraded "preview" mode driven
// by a bundled sample dataset, so the UI is fully developable without Tableau.

export type TableauMode = 'desktop' | 'preview';

let mode: TableauMode = 'preview';

export function getMode(): TableauMode {
  return mode;
}

export function isDesktop(): boolean {
  return mode === 'desktop';
}

/**
 * Initialize the Extensions API. Resolves with the detected mode.
 * Never rejects — if init fails we fall back to preview mode so the app still
 * renders and the failure is surfaced in the UI rather than a blank screen.
 */
export async function initTableau(): Promise<TableauMode> {
  const tableau = window.tableau;
  if (!tableau?.extensions?.initializeAsync) {
    mode = 'preview';
    return mode;
  }
  try {
    await tableau.extensions.initializeAsync();
    mode = 'desktop';
  } catch (err) {
    console.error('[tableau] initializeAsync failed; running in preview mode', err);
    mode = 'preview';
  }
  return mode;
}
