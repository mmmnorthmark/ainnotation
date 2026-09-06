// Number / percentage formatting for DERIVED statistics (means, deltas, shares,
// z-scores). Marks' own values are shown using the viz's formattedValue; these
// helpers format the numbers we compute ourselves so they read cleanly.

/** Compact, locale-aware number: 1234567 → "1.23M", 8420 → "8,420", 3.14159 → "3.14". */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return trimZeros((n / 1_000_000).toFixed(2)) + 'M';
  if (abs >= 100_000) return trimZeros((n / 1_000).toFixed(0)) + 'K';
  if (abs >= 1_000) return new Intl.NumberFormat('en-US').format(Math.round(n));
  if (abs >= 1 || abs === 0) return trimZeros(n.toFixed(2));
  return trimZeros(n.toPrecision(3));
}

/** Ratio (0.413) → "41%". Keeps one decimal below 10%. */
export function formatPct(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—';
  const pct = ratio * 100;
  const decimals = Math.abs(pct) < 10 ? 1 : 0;
  return trimZeros(pct.toFixed(decimals)) + '%';
}

/** Signed percentage with a unicode sign: 0.41 → "+41%", -0.12 → "−12%". */
export function formatSignedPct(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—';
  const sign = ratio > 0 ? '+' : ratio < 0 ? '−' : '±';
  return sign + formatPct(Math.abs(ratio));
}

/** Signed absolute delta: 4200 → "+4,200", -830 → "−830". */
export function formatSignedNumber(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '±';
  return sign + formatNumber(Math.abs(n));
}

/** Ordinal rank: 1 → "#1", 3 → "#3". */
export function rankOf(index0: number): string {
  return '#' + (index0 + 1);
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}
