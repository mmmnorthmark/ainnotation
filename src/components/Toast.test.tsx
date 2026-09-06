import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useToasts } from './Toast';

describe('useToasts', () => {
  it('dedupes identical active toasts (double analyze → one toast)', () => {
    const { result } = renderHook(() => useToasts());
    let firstId = 0;
    let secondId = 0;
    act(() => {
      firstId = result.current.push('info', 'No standout marks found on “Sheet 1”.', 0);
      secondId = result.current.push('info', 'No standout marks found on “Sheet 1”.', 0);
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(secondId).toBe(firstId); // duplicate returns the existing toast's id
  });

  it('keeps distinct messages and distinct kinds separate', () => {
    const { result } = renderHook(() => useToasts());
    act(() => {
      result.current.push('info', 'A', 0);
      result.current.push('info', 'B', 0);
      result.current.push('error', 'A', 0);
    });
    expect(result.current.toasts.map((t) => `${t.kind}:${t.message}`)).toEqual([
      'info:A',
      'info:B',
      'error:A',
    ]);
  });

  it('never dedupes progress toasts and updates them in place', () => {
    const { result } = renderHook(() => useToasts());
    let a = 0;
    let b = 0;
    act(() => {
      a = result.current.push('progress', 'Annotating…', 0);
      b = result.current.push('progress', 'Annotating…', 0);
    });
    expect(a).not.toBe(b);
    expect(result.current.toasts).toHaveLength(2);
    act(() => result.current.update(a, 'success', 'Done'));
    expect(result.current.toasts.find((t) => t.id === a)?.message).toBe('Done');
  });

  it('re-shows a message once its earlier toast was dismissed', () => {
    const { result } = renderHook(() => useToasts());
    let firstId = 0;
    act(() => {
      firstId = result.current.push('info', 'again', 0);
    });
    act(() => result.current.dismiss(firstId));
    act(() => {
      result.current.push('info', 'again', 0);
    });
    expect(result.current.toasts).toHaveLength(1);
  });
});
