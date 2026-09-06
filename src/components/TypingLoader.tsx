// A pure-CSS animated chart-glyph loader, shown while we analyze the active viz.
//
// A self-contained implementation (no new dependency): 11 chart-type glyphs in
// 4 color variants, each with its own geometry and motion. Stateless — the host
// picks a `type` + `variant` (see getRandomTypingLoader). Freezes calm under
// prefers-reduced-motion. Styles live in TypingLoader.css (plain global CSS, so
// the `.lv-N` variant classes and geometry class names are literal, not scoped).

import './TypingLoader.css';

export const TYPING_LOADER_TYPES = [
  'bar',
  'line',
  'scatter',
  'area',
  'pie',
  'scatterPlus',
  'treemap',
  'sankey',
  'scatterSquare',
  'donut',
  'hbar',
] as const;
export type TypingLoaderType = (typeof TYPING_LOADER_TYPES)[number];

/** The 4 color variants. Each is a recolor only; geometry and motion are shared. */
export const TYPING_LOADER_VARIANTS = [1, 2, 3, 4] as const;
export type TypingLoaderVariant = (typeof TYPING_LOADER_VARIANTS)[number];

export interface TypingLoaderSelection {
  type: TypingLoaderType;
  variant: TypingLoaderVariant;
}

// Variant-major ordering keeps the three scatter families from landing adjacent.
export const TYPING_LOADER_SELECTIONS: readonly TypingLoaderSelection[] = TYPING_LOADER_VARIANTS.flatMap(
  (variant) => TYPING_LOADER_TYPES.map((type) => ({ type, variant })),
);

/** Pick a random loader. `random` is injectable for deterministic tests. */
export function getRandomTypingLoader(random: () => number = Math.random): TypingLoaderSelection {
  return TYPING_LOADER_SELECTIONS[Math.floor(random() * TYPING_LOADER_SELECTIONS.length)];
}

const cx = (...classes: (string | false | undefined)[]) => classes.filter(Boolean).join(' ');

const svgProps = { viewBox: '0 0 14 11' } as const;
const TREND_POINTS = '0.9,8.6 5,5 8.5,6.5 13,1.3';
const TREND_DOTS = [
  { cx: 0.9, cy: 8.6 },
  { cx: 5, cy: 5 },
  { cx: 8.5, cy: 6.5 },
  { cx: 13, cy: 1.3 },
];
const trendDots = (className: string): Mark[] =>
  TREND_DOTS.map((p) => ({ kind: 'circle', className, cx: p.cx, cy: p.cy, r: 1.7 }));

const WEDGE_ROTATIONS = [-90, 90, -90, 90];
const wedgeRing = (r: number, ringClass: string, colorClasses: string[]): Mark[] =>
  WEDGE_ROTATIONS.map((rotate, i) => ({
    kind: 'circle',
    className: cx(ringClass, colorClasses[i]),
    cx: 7,
    cy: 5.5,
    r,
    pathLength: 100,
    rotate,
  }));

type Mark =
  | { kind: 'circle'; className: string; cx: number; cy: number; r: number; pathLength?: number; rotate?: number }
  | { kind: 'rect'; className: string; x: number; y: number; width: number; height: number; rx?: number }
  | { kind: 'polyline'; className: string; points: string }
  | { kind: 'polygon'; className: string; points: string }
  | { kind: 'path'; className: string; d: string; pathLength?: number };

type Shape =
  | { rootClass: string; render: 'spans'; barClass: string; barCount: number }
  | { rootClass: string; render: 'svg'; marks: Mark[] };

const SHAPES: Record<TypingLoaderType, Shape> = {
  bar: { rootClass: 'tl-chart', render: 'spans', barClass: 'tl-bar', barCount: 3 },
  line: {
    rootClass: 'tl-line',
    render: 'svg',
    marks: [{ kind: 'polyline', className: 'tl-line-path', points: TREND_POINTS }, ...trendDots('tl-line-dot')],
  },
  area: {
    rootClass: 'tl-area',
    render: 'svg',
    marks: [
      { kind: 'polygon', className: 'tl-area-fill', points: `${TREND_POINTS} 13,11 0.9,11` },
      { kind: 'polyline', className: cx('tl-line-path', 'tl-area-line'), points: TREND_POINTS },
      ...trendDots('tl-area-dot'),
    ],
  },
  pie: {
    rootClass: 'tl-pie',
    render: 'svg',
    marks: [
      { kind: 'circle', className: 'tl-pie-base', cx: 7, cy: 5.5, r: 6 },
      ...wedgeRing(3, 'tl-pie-wedge', ['tl-pie-o', 'tl-pie-g', 'tl-pie-r', 'tl-pie-b']),
    ],
  },
  donut: {
    rootClass: 'tl-donut',
    render: 'svg',
    marks: [
      { kind: 'circle', className: 'tl-donut-base', cx: 7, cy: 5.5, r: 4.4 },
      ...wedgeRing(4.4, 'tl-donut-ring', ['tl-donut-o', 'tl-donut-g', 'tl-donut-r', 'tl-donut-b']),
    ],
  },
  treemap: {
    rootClass: 'tl-treemap',
    render: 'svg',
    marks: [
      { kind: 'rect', className: cx('tl-tm', 'tl-tm-a'), x: 0.3, y: 0.3, width: 5.6, height: 10.4 },
      { kind: 'rect', className: cx('tl-tm', 'tl-tm-g'), x: 10.1, y: 5.1, width: 3.6, height: 5.6 },
      { kind: 'rect', className: cx('tl-tm', 'tl-tm-d'), x: 10.1, y: 0.3, width: 3.6, height: 4.4 },
      { kind: 'rect', className: cx('tl-tm', 'tl-tm-c'), x: 6.3, y: 0.3, width: 3.4, height: 4.4 },
      { kind: 'rect', className: cx('tl-tm', 'tl-tm-e'), x: 6.3, y: 5.1, width: 3.4, height: 2.6 },
      { kind: 'rect', className: cx('tl-tm', 'tl-tm-f'), x: 6.3, y: 8.1, width: 3.4, height: 2.6 },
    ],
  },
  sankey: {
    rootClass: 'tl-sankey',
    render: 'svg',
    marks: [
      { kind: 'path', className: cx('tl-sk-link', 'tl-sk-link-a'), d: 'M2.6 3.5 C7 3.5 7 7.1 11.4 7.1', pathLength: 100 },
      { kind: 'path', className: cx('tl-sk-link', 'tl-sk-link-b'), d: 'M2.6 7.3 C7 7.3 7 3.3 11.4 3.3', pathLength: 100 },
      { kind: 'rect', className: cx('tl-sk-bar', 'tl-sk-lt'), x: 0.4, y: 1.8, width: 2.2, height: 3.4 },
      { kind: 'rect', className: cx('tl-sk-bar', 'tl-sk-lb'), x: 0.4, y: 5.4, width: 2.2, height: 3.8 },
      { kind: 'rect', className: cx('tl-sk-bar', 'tl-sk-rt'), x: 11.4, y: 1.8, width: 2.2, height: 3 },
      { kind: 'rect', className: cx('tl-sk-bar', 'tl-sk-rb'), x: 11.4, y: 5, width: 2.2, height: 4.2 },
    ],
  },
  hbar: {
    rootClass: 'tl-hbar',
    render: 'svg',
    marks: [
      { kind: 'rect', className: 'tl-hbar-track', x: 0.3, y: 1, width: 13.4, height: 2.2, rx: 0.5 },
      { kind: 'rect', className: 'tl-hbar-track', x: 0.3, y: 4.4, width: 13.4, height: 2.2, rx: 0.5 },
      { kind: 'rect', className: 'tl-hbar-track', x: 0.3, y: 7.8, width: 13.4, height: 2.2, rx: 0.5 },
      { kind: 'rect', className: cx('tl-hbar-fill', 'hb-a'), x: 0.3, y: 1, width: 9.2, height: 2.2, rx: 0.5 },
      { kind: 'rect', className: cx('tl-hbar-fill', 'hb-b'), x: 0.3, y: 4.4, width: 13, height: 2.2, rx: 0.5 },
      { kind: 'rect', className: cx('tl-hbar-fill', 'hb-c'), x: 0.3, y: 7.8, width: 7, height: 2.2, rx: 0.5 },
      { kind: 'rect', className: cx('tl-hbar-ref', 'hb-a'), x: 8.9, y: 0.6, width: 0.6, height: 3 },
      { kind: 'rect', className: cx('tl-hbar-ref', 'hb-b'), x: 9.3, y: 4, width: 0.6, height: 3 },
      { kind: 'rect', className: cx('tl-hbar-ref', 'hb-c'), x: 6.3, y: 7.4, width: 0.6, height: 3 },
    ],
  },
  scatter: {
    rootClass: 'tl-scatter',
    render: 'svg',
    marks: [
      { kind: 'circle', className: 'tl-dot', cx: 2.6, cy: 8, r: 2.1 },
      { kind: 'circle', className: 'tl-dot', cx: 6.6, cy: 3.6, r: 2.6 },
      { kind: 'circle', className: 'tl-dot', cx: 9.4, cy: 8, r: 2.1 },
      { kind: 'circle', className: 'tl-dot', cx: 11.6, cy: 2.6, r: 1.6 },
    ],
  },
  scatterPlus: {
    rootClass: 'tl-scatter',
    render: 'svg',
    marks: [
      { kind: 'polygon', className: 'tl-dot', points: '2.18,5.9 3.02,5.9 3.02,7.58 4.7,7.58 4.7,8.42 3.02,8.42 3.02,10.1 2.18,10.1 2.18,8.42 0.5,8.42 0.5,7.58 2.18,7.58' },
      { kind: 'polygon', className: 'tl-dot', points: '5.12,1 6.68,1 6.68,2.82 8.5,2.82 8.5,4.38 6.68,4.38 6.68,6.2 5.12,6.2 5.12,4.38 3.3,4.38 3.3,2.82 5.12,2.82' },
      { kind: 'polygon', className: 'tl-dot', points: '8.9,5.9 9.9,5.9 9.9,7.5 11.5,7.5 11.5,8.5 9.9,8.5 9.9,10.1 8.9,10.1 8.9,8.5 7.3,8.5 7.3,7.5 8.9,7.5' },
      { kind: 'polygon', className: 'tl-dot', points: '11.48,0.5 12.32,0.5 12.32,2.18 14,2.18 14,3.02 12.32,3.02 12.32,4.7 11.48,4.7 11.48,3.02 9.8,3.02 9.8,2.18 11.48,2.18' },
    ],
  },
  scatterSquare: {
    rootClass: 'tl-scatter',
    render: 'svg',
    marks: [
      { kind: 'rect', className: 'tl-dot', x: 0.82, y: 6.22, width: 3.57, height: 3.57, rx: 0.3 },
      { kind: 'rect', className: 'tl-dot', x: 4.39, y: 1.39, width: 4.42, height: 4.42, rx: 0.3 },
      { kind: 'rect', className: 'tl-dot', x: 7.62, y: 6.22, width: 3.57, height: 3.57, rx: 0.3 },
      { kind: 'rect', className: 'tl-dot', x: 10.24, y: 1.24, width: 2.72, height: 2.72, rx: 0.3 },
    ],
  },
};

function renderMark(mark: Mark, key: number) {
  switch (mark.kind) {
    case 'circle':
      return (
        <circle
          key={key}
          className={mark.className}
          cx={mark.cx}
          cy={mark.cy}
          r={mark.r}
          pathLength={mark.pathLength}
          transform={mark.rotate !== undefined ? `rotate(${mark.rotate} ${mark.cx} ${mark.cy})` : undefined}
        />
      );
    case 'rect':
      return <rect key={key} className={mark.className} x={mark.x} y={mark.y} width={mark.width} height={mark.height} rx={mark.rx} />;
    case 'polyline':
      return <polyline key={key} className={mark.className} points={mark.points} />;
    case 'polygon':
      return <polygon key={key} className={mark.className} points={mark.points} />;
    case 'path':
      return <path key={key} className={mark.className} d={mark.d} pathLength={mark.pathLength} />;
  }
}

export interface TypingLoaderProps {
  type: TypingLoaderType;
  variant?: TypingLoaderVariant;
  /** Uniform scale as a percent of the intrinsic 14×11 size. 100 = default. */
  scalePercent?: number;
  className?: string;
}

/** An animated chart glyph. One of 11 chart types, in one of 4 color variants. */
export function TypingLoader({ type, variant = 1, scalePercent, className }: TypingLoaderProps) {
  const shape = SHAPES[type];
  const scaleStyle =
    scalePercent !== undefined && scalePercent !== 100
      ? ({ '--tb-loader-scale': scalePercent / 100 } as React.CSSProperties)
      : undefined;
  const body =
    shape.render === 'spans' ? (
      <>
        {Array.from({ length: shape.barCount }, (_, i) => (
          <span key={i} aria-hidden="true" className={shape.barClass} />
        ))}
      </>
    ) : (
      <svg {...svgProps} className="tl-svg" aria-hidden="true">
        {shape.marks.map(renderMark)}
      </svg>
    );
  return (
    <div className={cx(shape.rootClass, `lv-${variant}`, className)} style={scaleStyle} role="status" aria-live="polite">
      {body}
      <span className="tl-sr-only">Analyzing…</span>
    </div>
  );
}
