// Ambient declaration for the Tableau Extensions API global injected by
// /vendor/tableau.extensions.1.latest.js (apiVersion 1.19.0, workspace-capable).
//
// The Extensions surface is typed loosely as `any` here and narrowed in
// src/tableau/*.ts against the small slice we actually use (active-sheet data
// reads + the annotation verbs). The published @tableau/extensions-api-types
// package (1.17.0) does not yet declare workspaceContent, so there is no upstream
// type to import.
export {};

declare global {
  interface TableauExtensionsApi {
    initializeAsync(contextMenuCallbacks?: Record<string, () => void>): Promise<void>;
    // workspaceContent / dashboardContent / worksheetContent + enums — see
    // src/tableau/worksheet.ts and annotate.ts.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }

  interface TableauGlobal {
    extensions: TableauExtensionsApi;
    // Enums (SelectionUpdateType, MarkType, AnnotationType, …) hang off the global.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }

  interface Window {
    tableau?: TableauGlobal;
  }
}
