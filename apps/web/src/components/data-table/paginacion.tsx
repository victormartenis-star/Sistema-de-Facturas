'use client';

import { paginasVisibles, rangoVisible, totalPaginas } from '@erp/shared';
import { selectCls } from '@/components/ui';

/** Tamaños de página ofrecidos en el selector. */
export const PAGE_SIZE_OPCIONES = [10, 25, 50, 100] as const;

export interface PaginacionProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Sin esta función no se muestra el selector de tamaño. */
  onPageSizeChange?: (pageSize: number) => void;
  opcionesPageSize?: readonly number[];
}

const btnCls =
  'min-w-8 rounded-md px-2 py-1 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40';

export function Paginacion({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  opcionesPageSize = PAGE_SIZE_OPCIONES,
  deshabilitada = false,
}: PaginacionProps & { deshabilitada?: boolean }) {
  const paginas = totalPaginas(total, pageSize);
  if (paginas <= 1 && !onPageSizeChange) return null;
  const { desde, hasta } = rangoVisible(page, pageSize, total);
  return (
    <nav
      aria-label="Paginación"
      className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600"
    >
      <span className="tabular-nums">
        {desde}–{hasta} de {total}
      </span>
      <div className="flex flex-wrap items-center gap-1">
        <button
          className={`${btnCls} hover:bg-gray-100`}
          disabled={deshabilitada || page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Anterior
        </button>
        {paginasVisibles(page, paginas).map((p, i) =>
          p === 'elipsis' ? (
            <span key={`e${i}`} className="px-1 text-gray-400">
              …
            </span>
          ) : (
            <button
              key={p}
              aria-current={p === page ? 'page' : undefined}
              disabled={deshabilitada}
              onClick={() => onPageChange(p)}
              className={`${btnCls} tabular-nums ${
                p === page
                  ? 'bg-amber-500 text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {p}
            </button>
          ),
        )}
        <button
          className={`${btnCls} hover:bg-gray-100`}
          disabled={deshabilitada || page >= paginas}
          onClick={() => onPageChange(page + 1)}
        >
          Siguiente
        </button>
      </div>
      {onPageSizeChange && (
        <label className="flex items-center gap-2">
          Filas
          <select
            className={selectCls}
            value={pageSize}
            disabled={deshabilitada}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
          >
            {opcionesPageSize.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}
    </nav>
  );
}
