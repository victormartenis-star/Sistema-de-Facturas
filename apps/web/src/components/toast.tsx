'use client';

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { esConflictoVersion, MENSAJE_CONFLICTO_VERSION } from '@/lib/api-error';
import { textoDeError } from '@/lib/errores';
import { IconAlertTriangle, IconCheck, IconInfo, IconX } from './icons';

type ToastType = 'success' | 'error' | 'info';

/** Acción opcional del aviso (p. ej. "Recargar"). El aviso no caduca solo. */
export interface ToastAccion {
  etiqueta: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  accion?: ToastAccion;
}

type ToastFn = (
  message: string,
  type?: ToastType,
  accion?: ToastAccion,
) => void;

const ToastContext = createContext<ToastFn>(() => {});

/** Hook para lanzar notificaciones: `const toast = useToast(); toast('Guardado');` */
export function useToast(): ToastFn {
  return useContext(ToastContext);
}

/**
 * Avisa de un error de una mutación. Si es un conflicto de versión
 * (409 `VERSION_CONFLICT`) el aviso es persistente y ofrece `recargar`;
 * cualquier otro error (incluidos los 409 de estado) se muestra tal cual.
 */
export function useAvisarError(): (e: unknown, recargar?: () => void) => void {
  const toast = useToast();
  return useCallback(
    (e, recargar) => {
      if (esConflictoVersion(e)) {
        toast(
          MENSAJE_CONFLICTO_VERSION,
          'error',
          recargar ? { etiqueta: 'Recargar', onClick: recargar } : undefined,
        );
      } else {
        toast(textoDeError(e), 'error');
      }
    },
    [toast],
  );
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
    (message, type = 'success', accion) => {
      const id = nextId.current++;
      // Máximo 4 visibles a la vez
      setToasts((prev) => [...prev.slice(-3), { id, type, message, accion }]);
      // Con acción (conflicto de versión) el aviso espera a que el usuario actúe.
      if (!accion) window.setTimeout(() => dismiss(id), 4500);
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
            <div className="flex-1">
              <p className="text-sm text-gray-800">{t.message}</p>
              {t.accion && (
                <button
                  onClick={() => {
                    t.accion?.onClick();
                    dismiss(t.id);
                  }}
                  className="mt-1.5 rounded-md bg-gray-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-700"
                >
                  {t.accion.etiqueta}
                </button>
              )}
            </div>
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
