import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribeMarkSelection, type SelectionSubscription } from './selection';
import {
  type AnalyzableWorksheet,
  type SelectedMarksTable,
  type WorksheetSurface,
} from './worksheet';

/**
 * A worksheet whose event manager accepts exactly one event-name string and
 * throws (like the real bundle) for any other — models the two-enum mismatch.
 */
function fakeWorksheet(name: string, acceptEvent: string | null) {
  const handlers: Array<() => void> = [];
  const surface = {
    name,
    addEventListener: acceptEvent
      ? vi.fn((ev: string, handler: () => void) => {
          if (ev !== acceptEvent) throw new Error(`Cannot add event, unsupported event type: ${ev}`);
          handlers.push(handler);
          return () => {
            const i = handlers.indexOf(handler);
            if (i >= 0) handlers.splice(i, 1);
          };
        })
      : undefined,
    getSelectedMarksAsync: vi.fn(async () => ({
      data: [
        {
          columns: [{ fieldName: 'Category', dataType: 'string', index: 0 }],
          data: [[{ value: 'A' }]],
          marksInfo: [{ tupleId: 7 }],
        } as unknown as SelectedMarksTable,
      ],
    })),
  } as unknown as WorksheetSurface;
  return { surface, handlers, fire: () => handlers.forEach((h) => h()) };
}

afterEach(() => {
  delete (window as unknown as { tableau?: unknown }).tableau;
});

describe('subscribeMarkSelection', () => {
  it('attaches on the accepted event name even when the first candidate throws', () => {
    // Runtime enum offers the dash form, but this host only accepts no-dash.
    (window as unknown as { tableau: unknown }).tableau = {
      TableauEventType: { MarkSelectionChanged: 'mark-selection-changed' },
    };
    const ws = fakeWorksheet('Sale Map', 'markselectionchanged');
    let summary: SelectionSubscription | undefined;
    const off = subscribeMarkSelection(
      [{ name: ws.surface.name, surface: ws.surface } as AnalyzableWorksheet],
      () => {},
      (s) => (summary = s),
    );
    expect(summary).toEqual({ attached: 1, total: 1, event: 'markselectionchanged' });
    off();
  });

  it('routes a selection to onSelect with the worksheet name and picks', async () => {
    const ws = fakeWorksheet('Sale Map', 'mark-selection-changed');
    const onSelect = vi.fn();
    const off = subscribeMarkSelection(
      [{ name: ws.surface.name, surface: ws.surface } as AnalyzableWorksheet],
      onSelect,
    );
    ws.fire();
    await vi.waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    const [name, read] = onSelect.mock.calls[0];
    expect(name).toBe('Sale Map');
    expect(read.picks).toEqual([{ rowIndex: 0, tupleId: 7 }]);
    off();
  });

  it('reports attached=0 when no worksheet exposes addEventListener', () => {
    const ws = fakeWorksheet('Text Table', null);
    let summary: SelectionSubscription | undefined;
    subscribeMarkSelection(
      [{ name: ws.surface.name, surface: ws.surface } as AnalyzableWorksheet],
      () => {},
      (s) => (summary = s),
    );
    expect(summary).toEqual({ attached: 0, total: 1, event: null });
  });
});
