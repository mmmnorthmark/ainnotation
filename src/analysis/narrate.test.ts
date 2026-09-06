/// <reference types="vite/client" />
import { afterEach, describe, expect, it } from 'vitest';
// Vendored UMD bundle loaded as a raw string (vite `?raw`) so the test needs no
// node builtins — it's eval'd into a throwaway exports object below.
import rosaeBundle from '../../public/vendor/rosaenlg_tiny_en_US.js?raw';
import { __setRenderer, narrateCandidates, narrateOne } from './narrate';
import { type AnnotationCandidate } from './types';

function cand(partial: Partial<AnnotationCandidate>): AnnotationCandidate {
  return {
    id: 'max:Sales:1',
    kind: 'max',
    measure: 'Sales',
    rowIndex: 1,
    target: [],
    label: 'West & Co',
    title: 'Peak — West & Co',
    text: 'FALLBACK',
    score: 90,
    ...partial,
  };
}

const peak = cand({
  facts: {
    measure: 'Sales',
    label: 'West & Co',
    value: '$1.23M',
    rank: 1,
    count: 4,
    vsAvgPct: '+41%',
    avg: '$870K',
  },
});

afterEach(() => __setRenderer(undefined as unknown as null)); // reset override

describe('narrate — fallback', () => {
  it('returns candidates untouched when no renderer is available', async () => {
    __setRenderer(null);
    const out = await narrateCandidates([peak]);
    expect(out[0].text).toBe('FALLBACK');
  });

  it('leaves a candidate without facts alone', () => {
    const noFacts = cand({ facts: undefined });
    const out = narrateOne(noFacts, () => 'TOKMEAS peaks');
    expect(out.text).toBe('FALLBACK');
  });
});

describe('narrate — token splice (numbers stay exact)', () => {
  // Simulate RosaeNLG output: synonym chosen, first char capitalized, tokens intact.
  const fakePeak = () => 'TOKMEAS peaks in TOKLABEL at TOKVAL TOKTAIL';

  it('splices exact numbers and symbols back verbatim', () => {
    const out = narrateOne(peak, fakePeak);
    expect(out.text).toBe(
      '▲ Peak\nSales peaks in West & Co at $1.23M — ranked #1 of 4, +41% vs the $870K average.',
    );
    expect(out.text).toContain('$1.23M'); // never mangled to "$1. 23M"
    expect(out.text).not.toMatch(/TOK[A-Z]/); // no leftover placeholders
  });

  it('is deterministic for the same candidate', () => {
    const a = narrateOne(peak, fakePeak);
    const b = narrateOne(peak, fakePeak);
    expect(a.text).toBe(b.text);
  });

  it('narrates a selected mark with rank + vs-average context', () => {
    const mark = cand({
      id: 'mark:Sales:42',
      kind: 'mark',
      facts: {
        measure: 'Sales',
        label: 'East',
        value: '$1.23M',
        rank: 3,
        count: 20,
        vsAvgPct: '+12%',
        avg: '$980K',
      },
    });
    const out = narrateOne(mark, () => 'TOKLABEL shows TOKMEAS of TOKVAL TOKTAIL');
    expect(out.text).toBe(
      '⌖ Selected mark\nEast shows Sales of $1.23M — ranked #3 of 20, +12% vs the $980K average.',
    );
  });

  it('narrates an unmatched selected mark with no tail clause', () => {
    const mark = cand({
      id: 'mark:Sales:7',
      kind: 'mark',
      facts: { measure: 'Sales', label: 'Mars', value: '999' },
    });
    const out = narrateOne(mark, () => 'TOKLABEL shows TOKMEAS of TOKVAL TOKTAIL');
    expect(out.text).toBe('⌖ Selected mark\nMars shows Sales of 999.');
  });

  it('does not let a shorter token corrupt a longer one (TOKTO vs TOKTAIL)', () => {
    const trend = cand({
      id: 'trend:Sales:5',
      kind: 'trend',
      facts: {
        measure: 'Sales',
        label: 'Dec',
        rising: true,
        pct: '+50%',
        fromLabel: 'Jan',
        toLabel: 'Dec',
        fromVal: '100',
        toVal: '150',
        r2: '0.80',
        points: 6,
      },
    });
    const out = narrateOne(trend, () => 'TOKMEAS rose TOKPCT from TOKFROM to TOKTO TOKTAIL');
    expect(out.text).toBe(
      '↗ Trend\nSales rose +50% from Jan to Dec (100 → 150; linear R² 0.80 over 6 points).',
    );
  });
});

describe('narrate — real RosaeNLG runtime (integration)', () => {
  it('renders varied prose while keeping the number byte-exact', () => {
    // Eval the vendored UMD bundle (it populates the exports object we pass in).
    const mod: { exports: Record<string, unknown> } = { exports: {} };
    new Function('module', 'exports', rosaeBundle)(mod, mod.exports);
    const rt = mod.exports as { render: (t: string, p: Record<string, unknown>) => string };
    expect(typeof rt.render).toBe('function');

    __setRenderer((t, p) => rt.render(t, p));
    const out = narrateOne(peak, (t, p) => rt.render(t, p));

    expect(out.text.startsWith('▲ Peak\n')).toBe(true);
    expect(out.text).toContain('$1.23M'); // survived RosaeNLG's typographic pass
    expect(out.text).toContain('West & Co');
    expect(out.text).toMatch(/peaks|tops out|reaches its high/); // a real synonym was chosen
    expect(out.text).not.toMatch(/TOK[A-Z]/);
  });
});
