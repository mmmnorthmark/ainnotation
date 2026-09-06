// RosaeNLG narration seam.
//
// Turns a candidate's structured `facts` into a flowing English sentence using
// RosaeNLG (Apache-2.0), the library chosen for narration. The heavy runtime
// (public/vendor/rosaenlg_tiny_en_US.js, ~1.5 MB) is LAZY-loaded on first use so
// it never touches initial paint.
//
// TWO INVARIANTS make this safe:
//   1. Numbers stay byte-exact. RosaeNLG runs typographic post-processing that
//      would turn "$1.23M" into "$1. 23M". So NO dynamic value is ever handed to
//      the renderer — every measure name, mark label, and formatted number goes
//      in as a letter-only placeholder token (TOKVAL, TOKLABEL, …) and is spliced
//      back verbatim AFTER rendering. RosaeNLG only ever sees fixed English prose
//      plus its own synonym/grammar directives.
//   2. It always degrades gracefully. If the runtime can't load (offline, blocked)
//      or a render throws, the candidate keeps the deterministic `text` the engine
//      already built (src/analysis/insights.ts). Narration is pure enhancement.
//
// Output is deterministic: synonym choice is seeded from the candidate id, so the
// same insight always narrates the same way.

import { KIND_META, type AnnotationCandidate, type InsightKind, type NarrationFacts } from './types';

// ---- runtime loader -----------------------------------------------------

interface RosaeRuntime {
  render: (template: string, params: Record<string, unknown>) => string;
}
type RenderFn = (template: string, params: Record<string, unknown>) => string;

declare global {
  interface Window {
    rosaenlg_en_US?: RosaeRuntime;
  }
}

const VENDOR_URL = '/vendor/rosaenlg_tiny_en_US.js';

// `undefined` = not overridden; `null` = force fallback (no renderer). Tests use this.
let injectedRenderer: RenderFn | null | undefined;
let loaderPromise: Promise<RenderFn | null> | null = null;

/** Test seam: inject a renderer (or null to force the deterministic fallback). */
export function __setRenderer(fn: RenderFn | null): void {
  injectedRenderer = fn;
  loaderPromise = null;
}

async function getRenderer(): Promise<RenderFn | null> {
  if (injectedRenderer !== undefined) return injectedRenderer;
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;
  if (!loaderPromise) loaderPromise = loadRuntime();
  return loaderPromise;
}

function loadRuntime(): Promise<RenderFn | null> {
  return new Promise((resolve) => {
    if (window.rosaenlg_en_US) return resolve(wrap(window.rosaenlg_en_US));
    const el = document.createElement('script');
    el.src = VENDOR_URL;
    el.async = true;
    el.onload = () => resolve(window.rosaenlg_en_US ? wrap(window.rosaenlg_en_US) : null);
    el.onerror = () => resolve(null);
    document.head.appendChild(el);
  });
}

function wrap(rt: RosaeRuntime): RenderFn {
  return (t, p) => rt.render(t, p);
}

// ---- public API ---------------------------------------------------------

/**
 * Narrate a batch of candidates. Loads the RosaeNLG runtime once (lazily); if it
 * can't be loaded, returns the candidates untouched (their fallback text stands).
 */
export async function narrateCandidates(
  candidates: AnnotationCandidate[],
): Promise<AnnotationCandidate[]> {
  const render = await getRenderer();
  if (!render) return candidates;
  return candidates.map((c) => narrateOne(c, render));
}

/** Narrate a single candidate with an explicit renderer (also the unit-test entry). */
export function narrateOne(c: AnnotationCandidate, render: RenderFn): AnnotationCandidate {
  if (!c.facts) return c;
  const template = TEMPLATES[c.kind];
  const built = built_(c.kind, c.facts);
  if (!template || !built) return c;
  try {
    const raw = render(template, {
      language: 'en_US',
      forceRandomSeed: seedFor(c.id),
      rising: !!c.facts.rising,
    });
    const sentence = splice(raw, built);
    if (!sentence) return c;
    const meta = KIND_META[c.kind];
    return { ...c, text: `${meta.glyph} ${meta.label}\n${sentence}` };
  } catch {
    return c; // any render failure → keep the deterministic fallback text
  }
}

// ---- templates ----------------------------------------------------------
//
// Pug source (whitespace-significant): `synz` holds synonym `syn` branches; the
// leading `| ` lines are literal text. The uppercase TOK* words are placeholder
// tokens, spliced out afterward — NOT Pug variables.

const T = (lines: string[]): string => lines.join('\n');

const TEMPLATES: Partial<Record<InsightKind, string>> = {
  max: T([
    '| TOKMEAS',
    'synz',
    '  syn',
    '    | peaks',
    '  syn',
    '    | tops out',
    '  syn',
    '    | reaches its high',
    '| in TOKLABEL at TOKVAL TOKTAIL',
  ]),
  min: T([
    '| TOKMEAS',
    'synz',
    '  syn',
    '    | bottoms out',
    '  syn',
    '    | is at its weakest',
    '  syn',
    '    | hits its low',
    '| in TOKLABEL at TOKVAL TOKTAIL',
  ]),
  'outlier-high': T([
    '| TOKLABEL',
    'synz',
    '  syn',
    '    | stands out',
    '  syn',
    '    | is a clear outlier',
    '  syn',
    '    | breaks from the pack',
    '| on TOKMEAS at TOKVAL TOKTAIL',
  ]),
  'outlier-low': T([
    '| TOKLABEL',
    'synz',
    '  syn',
    '    | slumps',
    '  syn',
    '    | is a clear low outlier',
    '  syn',
    '    | trails the pack',
    '| on TOKMEAS at TOKVAL TOKTAIL',
  ]),
  share: T([
    '| TOKLABEL',
    'synz',
    '  syn',
    '    | dominates',
    '  syn',
    '    | leads',
    '  syn',
    '    | takes the biggest slice of',
    '| TOKMEAS at TOKVAL TOKTAIL',
  ]),
  gap: T([
    '| TOKMEAS',
    'synz',
    '  syn',
    '    | breaks away',
    '  syn',
    '    | pulls clear',
    '| at TOKLABEL TOKTAIL',
  ]),
  trend: T([
    '| TOKMEAS',
    'if rising',
    '  synz',
    '    syn',
    '      | climbed',
    '    syn',
    '      | rose',
    '    syn',
    '      | advanced',
    'else',
    '  synz',
    '    syn',
    '      | fell',
    '    syn',
    '      | slid',
    '    syn',
    '      | declined',
    '| TOKPCT from TOKFROM to TOKTO TOKTAIL',
  ]),
  mover: T([
    '| The biggest single move in TOKMEAS',
    'synz',
    '  syn',
    '    | came',
    '  syn',
    '    | landed',
    '| from TOKFROM to TOKTO TOKTAIL',
  ]),
  changepoint: T([
    '| TOKMEAS',
    'if rising',
    '  synz',
    '    syn',
    '      | stepped up',
    '    syn',
    '      | shifted higher',
    'else',
    '  synz',
    '    syn',
    '      | stepped down',
    '    syn',
    '      | shifted lower',
    '| at TOKLABEL TOKTAIL',
  ]),
  'off-trend': T([
    '| TOKLABEL',
    'synz',
    '  syn',
    '    | sits off the trend',
    '  syn',
    '    | breaks the pattern',
    '| of TOKMEAS against TOKOTHER TOKTAIL',
  ]),
  mark: T([
    '| TOKLABEL',
    'synz',
    '  syn',
    '    | shows',
    '  syn',
    '    | posts',
    '  syn',
    '    | records',
    '| TOKMEAS of TOKVAL TOKTAIL',
  ]),
};

// ---- per-kind token composition -----------------------------------------
//
// Every dynamic value (numbers included, already formatted upstream) becomes a
// token here; `TOKTAIL` carries the kind-specific closing clause with the exact
// numbers. Nothing here is re-formatted.

function built_(kind: InsightKind, f: NarrationFacts): Record<string, string> | null {
  const base = { TOKMEAS: f.measure, TOKLABEL: f.label, TOKVAL: f.value ?? '' };
  switch (kind) {
    case 'max':
      return { ...base, TOKTAIL: `— ranked #1 of ${f.count}${vsAvgClause(f)}.` };
    case 'min':
      return { ...base, TOKTAIL: `— ranked #${f.rank} of ${f.count}${vsAvgClause(f)}.` };
    case 'outlier-high':
      return {
        ...base,
        TOKTAIL: `— ${sig(f)} above the ${f.avg} average, past the ${f.fence} upper fence.`,
      };
    case 'outlier-low':
      return {
        ...base,
        TOKTAIL: `— ${sig(f)} below the ${f.avg} average, under the ${f.fence} lower fence.`,
      };
    case 'share':
      return {
        ...base,
        TOKTAIL: `— ${f.sharePct} of the total; the top ${f.paretoN} make up 80% (Gini ${f.gini}).`,
      };
    case 'gap':
      return {
        ...base,
        TOKTAIL:
          (f.leaders ?? 1) === 1
            ? `— ${f.gapValue} clear of #2 ${f.nextLabel}.`
            : `— the top ${f.leaders} pull ${f.gapValue} clear of the pack.`,
      };
    case 'trend':
      return {
        ...base,
        TOKPCT: f.pct ?? '',
        TOKFROM: f.fromLabel ?? '',
        TOKTO: f.toLabel ?? '',
        TOKTAIL: `(${f.fromVal} → ${f.toVal}; linear R² ${f.r2} over ${f.points} points).`,
      };
    case 'mover':
      return {
        ...base,
        TOKFROM: f.fromLabel ?? '',
        TOKTO: f.toLabel ?? '',
        TOKTAIL: `— ${f.delta}${f.pct ? ` (${f.pct})` : ''}.`,
      };
    case 'changepoint':
      return { ...base, TOKTAIL: `— from ~${f.before} to ~${f.after} (${f.delta}).` };
    case 'off-trend':
      return {
        ...base,
        TOKOTHER: f.otherMeasure ?? '',
        TOKTAIL: `— ${f.above ? 'above' : 'below'} the line by ${f.residual} (predicted ${f.predicted}); pair r ${f.r}.`,
      };
    case 'mark': {
      const bits: string[] = [];
      if (f.rank && f.count) bits.push(`ranked #${f.rank} of ${f.count}`);
      if (f.vsAvgPct) bits.push(`${f.vsAvgPct} vs the ${f.avg} average`);
      if (f.sigma && f.sigma >= 2) {
        bits.push(`${f.sigma.toFixed(1)}σ ${f.direction === 'below' ? 'low' : 'high'}`);
      }
      return { ...base, TOKTAIL: bits.length ? `— ${bits.join(', ')}.` : '' };
    }
    default:
      return null;
  }
}

function vsAvgClause(f: NarrationFacts): string {
  return f.vsAvgPct ? `, ${f.vsAvgPct} vs the ${f.avg} average` : '';
}

function sig(f: NarrationFacts): string {
  return `${(f.sigma ?? 0).toFixed(1)}σ`;
}

// ---- splice + tidy ------------------------------------------------------

function splice(raw: string, tokens: Record<string, string>): string {
  const keys = Object.keys(tokens).sort((a, b) => b.length - a.length);
  const re = new RegExp(keys.join('|'), 'g');
  let s = raw.replace(re, (m) => tokens[m] ?? '');
  s = decodeEntities(s);
  s = s
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+([.,;)])/g, '$1')
    .trim();
  if (s && !/[.!?]$/.test(s)) s += '.';
  return capitalizeFirst(s);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ');
}

function capitalizeFirst(s: string): string {
  const i = s.search(/[A-Za-z]/);
  if (i < 0) return s;
  const ch = s[i];
  return ch >= 'a' && ch <= 'z' ? s.slice(0, i) + ch.toUpperCase() + s.slice(i + 1) : s;
}

/** Stable small seed from a candidate id, so narration is deterministic per insight. */
function seedFor(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100000;
}
