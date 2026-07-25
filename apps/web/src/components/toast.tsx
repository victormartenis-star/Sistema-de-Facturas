'use client';

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { IconAlertTriangle, IconCheck, IconInfo, IconX } from './icons';

type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

type ToastFn = (message: string, type?: ToastType) => void;

const ToastContext = createContext<ToastFn>(() => {});

/** Hook para lanzar notificaciones: `const toast = useToast(); toast('Guardado');` */
export function useToast(): ToastFn {
  return useContext(ToastContext);
}

const TONE: Record<ToastType, { chip: string; icon: ReactNode }> = {
  success: {
    chip: 'bg-emerald-100 text-emerald-600',
    icon: <IconCheck size={14} />,
  },
  error: {
    chip: 'bg-red-100 text-red-600',
    icon: <IconAlertTriangle size={14} />,
  },
  info: {
    chip: 'bg-sky-100 text-sky-600',
    icon: <IconInfo size={14} />,
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback<ToastFn>(
    (message, type = 'success') => {
      const id = nextId.current++;
      // Máximo 4 visibles a la vez
      setToasts((prev) => [...prev.slice(-3), { id, type, message }]);
      window.setTimeout(() => dismiss(id), 4500);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="animate-toast-in pointer-events-auto flex items-start gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-lg"
          >
            <span
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${TONE[t.type].chip}`}
            >
              {TONE[t.type].icon}
            </span>
            <p className="flex-1 text-sm text-gray-800">{t.message}</p>
            <button
              onClick={() => dismiss(t.id)}
              className="mt-0.5 shrink-0 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="Cerrar aviso"
            >
              <IconX size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
