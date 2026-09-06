import { useCallback, useRef, useState } from 'react';
import {
  StatusActiveIcon,
  StatusErrorIcon,
  NotificationInfoOutlineIcon,
  ClearBaseIcon,
} from './icons';

export type ToastKind = 'info' | 'success' | 'error' | 'progress';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

let nextId = 1;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Mirror of `toasts` so push() can check for duplicates synchronously (state
  // updates are async, and StrictMode fires our mount effect — hence analyze,
  // hence a toast — twice in dev). The ref is the source of truth; each mutation
  // makes a new array so setToasts still triggers a render.
  const toastsRef = useRef<Toast[]>([]);
  const commit = useCallback((next: Toast[]) => {
    toastsRef.current = next;
    setToasts(next);
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      commit(toastsRef.current.filter((x) => x.id !== id));
    },
    [commit],
  );

  const push = useCallback(
    (kind: ToastKind, message: string, autoDismissMs = 4000): number => {
      // Dedupe identical active toasts (e.g. the same "No standout marks" info
      // fired by a double analyze). Progress toasts are updated in place, so
      // they're never deduped.
      if (kind !== 'progress') {
        const existing = toastsRef.current.find((x) => x.kind === kind && x.message === message);
        if (existing) return existing.id;
      }
      const id = nextId++;
      commit([...toastsRef.current, { id, kind, message }]);
      if (autoDismissMs > 0) {
        setTimeout(() => dismiss(id), autoDismissMs);
      }
      return id;
    },
    [commit, dismiss],
  );

  const update = useCallback(
    (id: number, kind: ToastKind, message: string) => {
      commit(toastsRef.current.map((x) => (x.id === id ? { ...x, kind, message } : x)));
    },
    [commit],
  );

  return { toasts, push, update, dismiss };
}

function ToastIcon({ kind }: { kind: ToastKind }) {
  switch (kind) {
    case 'progress':
      return <span className="toast-spinner" aria-hidden />;
    case 'success':
      return <StatusActiveIcon size={18} />;
    case 'error':
      return <StatusErrorIcon size={18} />;
    case 'info':
    default:
      return <NotificationInfoOutlineIcon size={18} />;
  }
}

export function ToastHost({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`} role="status">
          <span className="toast-icon" aria-hidden>
            <ToastIcon kind={t.kind} />
          </span>
          <span className="toast-msg">{t.message}</span>
          <button className="toast-x" onClick={() => onDismiss(t.id)} aria-label="Dismiss">
            <ClearBaseIcon size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
