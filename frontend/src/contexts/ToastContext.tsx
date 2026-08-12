import { createContext, use, useCallback, useMemo, useState, type PropsWithChildren } from 'react';
import { CheckCircle2, CircleAlert, X } from 'lucide-react';

interface Toast {
  id: number;
  message: string;
  tone: 'success' | 'error';
}

interface ToastContextValue {
  notify: (message: string, tone?: Toast['tone']) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: PropsWithChildren) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);
  const notify = useCallback((message: string, tone: Toast['tone'] = 'success') => {
    const id = Date.now();
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => dismiss(id), 4200);
  }, [dismiss]);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext value={value}>
      {children}
      <div className="toast-region" role="region" aria-label="Notifications" aria-live="polite">
        {toasts.map((toast) => (
          <div className={`toast toast--${toast.tone}`} key={toast.id}>
            {toast.tone === 'success' ? <CheckCircle2 aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
            <span>{toast.message}</span>
            <button className="icon-button icon-button--small" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification"><X /></button>
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast() {
  const context = use(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
