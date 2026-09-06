// Dark-mode wiring for the Tableau design tokens.
//
// The blessed token CSS defines light values on `:root`/`.tds-light` and dark
// values scoped under `.tds-dark`. There is no React ThemeProvider — theming is a
// class on the root element. We follow the OS preference and keep it in sync.

export function initTheme(): void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = (dark: boolean) => {
    document.documentElement.classList.toggle('tds-dark', dark);
    document.documentElement.classList.toggle('tds-light', !dark);
  };
  apply(mq.matches);
  // addEventListener is supported in modern CEF/Chromium; guard just in case.
  mq.addEventListener?.('change', (e) => apply(e.matches));
}
