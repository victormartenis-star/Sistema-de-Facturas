'use client';

import { useState } from 'react';
import { MENSAJE_CONFLICTO_VERSION } from '@/lib/api-error';

/**
 * Aviso en línea de un conflicto de versión (409 `VERSION_CONFLICT`) dentro de
 * un formulario. Se mantiene hasta que la recarga termina: `onReload` debe
 * traer de nuevo la entidad (con su `version`) y el aviso desaparece al
 * resetear el error de la mutación.
 */
export function AvisoConflicto({
  onReload,
}: {
  onReload?: () => Promise<unknown> | void;
}) {
  const [cargando, setCargando] = useState(false);
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800"
    >
      <span>{MENSAJE_CONFLICTO_VERSION}</span>
      {onReload && (
        <button
          type="button"
          disabled={cargando}
          onClick={async () => {
            setCargando(true);
            try {
              await onReload();
            } finally {
              setCargando(false);
            }
          }}
          className="shrink-0 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {cargando ? 'Recargando…' : 'Recargar'}
        </button>
      )}
    </div>
  );
}
