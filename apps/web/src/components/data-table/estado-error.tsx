'use client';

import { mensajeDeError } from '@/lib/errores';
import { IconAlertTriangle } from '@/components/icons';

/** Error de carga con mensaje según el caso y botón de reintento. */
export function EstadoError({
  error,
  onReintentar,
  compacto = false,
}: {
  error: unknown;
  onReintentar?: () => void;
  compacto?: boolean;
}) {
  const m = mensajeDeError(error);
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 text-sm text-red-700 ${
        compacto ? 'px-3 py-2' : 'px-4 py-4'
      }`}
    >
      <IconAlertTriangle size={16} className="mt-0.5 shrink-0" />
      <div className="flex-1">
        <p className="font-medium">{m.titulo}</p>
        {m.detalle && <p className="mt-0.5 text-red-600">{m.detalle}</p>}
      </div>
      {onReintentar && m.reintentable && (
        <button
          onClick={onReintentar}
          className="rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
        >
          Reintentar
        </button>
      )}
    </div>
  );
}
