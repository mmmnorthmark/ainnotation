import { describe, expect, it } from 'vitest';
import {
  formatNumber,
  formatPct,
  formatSignedNumber,
  formatSignedPct,
  rankOf,
} from './format';

describe('formatNumber', () => {
  it('scales large magnitudes', () => {
    expect(formatNumber(1_234_567)).toBe('1.23M');
    expect(formatNumber(330_007)).toBe('330K');
    expect(formatNumber(8_420)).toBe('8,420');
  });
  it('handles small and zero values', () => {
    expect(formatNumber(3.14159)).toBe('3.14');
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(0.5)).toBe('0.5');
    expect(formatNumber(NaN)).toBe('—');
  });
});

describe('percentages', () => {
  it('drops decimals at/above 10%, keeps one below', () => {
    expect(formatPct(0.413)).toBe('41%');
    expect(formatPct(0.054)).toBe('5.4%');
  });
  it('signs with unicode +/−', () => {
    expect(formatSignedPct(0.41)).toBe('+41%');
    expect(formatSignedPct(-0.12)).toBe('−12%');
  });
});

describe('signed numbers + rank', () => {
  it('signs absolute deltas', () => {
    expect(formatSignedNumber(4200)).toBe('+4,200');
    expect(formatSignedNumber(-830)).toBe('−830');
  });
  it('renders 1-based ranks', () => {
    expect(rankOf(0)).toBe('#1');
    expect(rankOf(16)).toBe('#17');
  });
});
