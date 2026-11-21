import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { cx } from './components';

interface Toast {
  id: number;
  message: string;
  tone: 'good' | 'bad' | 'info';
  action?: { label: string; onClick: () => void };
}

const ToastContext = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), t.action ? 8000 : 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div role="region" aria-label="Notifications" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              'pointer-events-auto flex w-fit max-w-full items-center gap-3 sm:max-w-md rounded-lg border px-4 py-2.5 text-sm shadow-lg',
              t.tone === 'bad' ? 'border-bad/40 bg-bad-soft text-ink' : t.tone === 'good' ? 'border-good/40 bg-good-soft text-ink' : 'border-border bg-surface text-ink',
            )}
          >
            <span>{t.message}</span>
            {t.action && (
              <button className="font-semibold text-accent underline" onClick={t.action.onClick}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
