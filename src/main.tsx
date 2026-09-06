import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initTableau } from './tableau/extensions';
// Theme tokens (light + dark) are defined inline in global.css.
import './styles/global.css';
import { initTheme } from './styles/theme';

async function bootstrap() {
  initTheme();
  const mode = await initTableau();
  const el = document.getElementById('root');
  if (!el) throw new Error('#root not found');
  createRoot(el).render(
    <React.StrictMode>
      <App mode={mode} />
    </React.StrictMode>,
  );
}

void bootstrap();
