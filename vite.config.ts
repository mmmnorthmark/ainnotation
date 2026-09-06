import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The .trex manifest's <source-location> points at this dev server. Keep the
// port stable so the manifest URL never drifts. (Distinct from the sibling
// tableau-public-explorer extension's 8765 so both can dev-load at once.)
const PORT = 8770;

// Unlike the Tableau Public explorer, this extension talks ONLY to the host
// (window.tableau via the Extensions API) — it fetches nothing cross-origin, so
// no CORS proxy is needed. Desktop loads the page from this dev server; all data
// comes back over the Extensions postMessage bridge.
export default defineConfig({
  plugins: [react()],
  server: { port: PORT, strictPort: true, cors: true },
  preview: { port: PORT, strictPort: true },
  build: { outDir: 'dist', sourcemap: true },
});
