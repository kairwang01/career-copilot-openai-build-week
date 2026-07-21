
import React, { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';
import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextType {
  addToast: (message: string, type?: ToastType) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

// Errors are often long, interpolated messages — give them time to read; success/info stay brief.
const TOAST_DURATION_MS: Record<ToastType, number> = { success: 4000, info: 4000, error: 9000 };
const TOAST_ICONS = {
  success: CheckCircle2,
  error: CircleAlert,
  info: Info,
};
const TOAST_ICON_CLASSES: Record<ToastType, string> = {
  success: 'text-green-500',
  error: 'text-red-500',
  info: 'text-blue-500',
};

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const removeToast = useCallback((id: string) => {
    const timer = timers.current[id];
    if (timer) { clearTimeout(timer); delete timers.current[id]; }
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const scheduleDismiss = useCallback((id: string, ms: number) => {
    timers.current[id] = setTimeout(() => removeToast(id), ms);
  }, [removeToast]);

  const addToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).slice(2, 11);
    setToasts((prev) => [...prev, { id, type, message }]);
    scheduleDismiss(id, TOAST_DURATION_MS[type]);
  }, [scheduleDismiss]);

  // Pause auto-dismiss while the toast is hovered so a user mid-read isn't cut off.
  const pauseDismiss = useCallback((id: string) => {
    const timer = timers.current[id];
    if (timer) { clearTimeout(timer); delete timers.current[id]; }
  }, []);
  const resumeDismiss = useCallback((id: string, type: ToastType) => {
    if (!timers.current[id]) scheduleDismiss(id, TOAST_DURATION_MS[type]);
  }, [scheduleDismiss]);

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <div className="fixed top-24 right-5 z-[100] flex flex-col gap-3 pointer-events-none">
        {toasts.map((toast) => {
          const ToastIcon = TOAST_ICONS[toast.type];
          return (
            <div
              key={toast.id}
              role={toast.type === 'error' ? 'alert' : 'status'}
              onMouseEnter={() => pauseDismiss(toast.id)}
              onMouseLeave={() => resumeDismiss(toast.id, toast.type)}
              className={`pointer-events-auto min-w-[300px] max-w-md p-4 rounded-lg shadow-lg border-l-4 transform transition-all duration-300 animate-slide-in-right flex items-start gap-3 backdrop-blur-sm
                ${toast.type === 'success' ? 'bg-white/95 dark:bg-slate-800/95 border-green-500 text-green-800 dark:text-green-200' : ''}
                ${toast.type === 'error' ? 'bg-white/95 dark:bg-slate-800/95 border-red-500 text-red-800 dark:text-red-200' : ''}
                ${toast.type === 'info' ? 'bg-white/95 dark:bg-slate-800/95 border-blue-500 text-blue-800 dark:text-blue-200' : ''}
              `}
            >
              <div className="flex-shrink-0 mt-0.5">
                <ToastIcon className={`w-5 h-5 ${TOAST_ICON_CLASSES[toast.type]}`} aria-hidden="true" />
              </div>
              <div className="flex-1 text-sm font-medium">{toast.message}</div>
              <button
                type="button"
                onClick={() => removeToast(toast.id)}
                aria-label="Dismiss notification"
                className="rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-400/40"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};
