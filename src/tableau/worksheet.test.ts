import { describe, expect, it, vi } from 'vitest';
import {
  getAnnotationSupport,
  getWorksheetMarkType,
  UNANNOTATABLE_MARK_TYPES,
  type VisualSpecification,
  type WorksheetSurface,
} from './worksheet';

/** A worksheet exposing only the spec method (all this module reads). */
function wsWithSpec(
  spec: VisualSpecification | (() => Promise<VisualSpecification>) | 'absent',
): WorksheetSurface {
  const base = { name: 'Sheet 1' } as Partial<WorksheetSurface>;
  if (spec === 'absent') return base as WorksheetSurface;
  base.getVisualSpecificationAsync =
    typeof spec === 'function' ? spec : vi.fn(async () => spec);
  return base as WorksheetSurface;
}

const spec = (markTypes: string[], activeIndex = 0): VisualSpecification => ({
  activeMarksSpecificationIndex: activeIndex,
  marksSpecifications: markTypes.map((markType) => ({ markType })),
});

describe('getWorksheetMarkType', () => {
  it('returns the active layer’s mark type', async () => {
    expect(await getWorksheetMarkType(wsWithSpec(spec(['bar'])))).toBe('bar');
  });

  it('honors activeMarksSpecificationIndex across layers', async () => {
    expect(await getWorksheetMarkType(wsWithSpec(spec(['line', 'text'], 1)))).toBe('text');
  });

  it('returns null when the host doesn’t expose the spec method', async () => {
    expect(await getWorksheetMarkType(wsWithSpec('absent'))).toBeNull();
  });

  it('returns null (never throws) when the spec call rejects', async () => {
    const ws = wsWithSpec(() => Promise.reject(new Error('nope')));
    expect(await getWorksheetMarkType(ws)).toBeNull();
  });

  it('returns null when there are no marks specifications', async () => {
    expect(await getWorksheetMarkType(wsWithSpec(spec([])))).toBeNull();
  });

  it('falls back to the first layer when the active index is out of range', async () => {
    expect(await getWorksheetMarkType(wsWithSpec(spec(['circle'], 9)))).toBe('circle');
  });
});

describe('getAnnotationSupport', () => {
  it('blocks text tables (crosstabs)', async () => {
    expect(await getAnnotationSupport(wsWithSpec(spec(['text'])))).toEqual({
      supported: false,
      markType: 'text',
    });
  });

  it('allows ordinary chart mark types', async () => {
    for (const markType of ['bar', 'line', 'area', 'circle', 'map', 'pie']) {
      expect(await getAnnotationSupport(wsWithSpec(spec([markType])))).toEqual({
        supported: true,
        markType,
      });
    }
  });

  it('assumes annotatable when the mark type is unknown', async () => {
    expect(await getAnnotationSupport(wsWithSpec('absent'))).toEqual({
      supported: true,
      markType: null,
    });
  });

  it('only text is currently blocked', () => {
    expect([...UNANNOTATABLE_MARK_TYPES]).toEqual(['text']);
  });
});
