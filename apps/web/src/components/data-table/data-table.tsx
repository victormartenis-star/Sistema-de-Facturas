'use client';

import { Fragment, type ReactNode } from 'react';
import { EmptyState } from '@/components/ui';
import { IconChevronDown, IconChevronUp } from '@/components/icons';
import { EstadoError } from './estado-error';
import { Paginacion, type PaginacionProps } from './paginacion';

export interface ColumnaDef<T> {
  id: string;
  cabecera: ReactNode;
  celda: (fila: T) => ReactNode;
  alineacion?: 'izquierda' | 'derecha' | 'centro';
  /** Clase Tailwind de ancho, p. ej. 'w-28'. */
  claseAncho?: string;
  ocultaEnMovil?: boolean;
}

export interface DataTableProps<T> {
  /** aria-label de la tabla. */
  etiqueta: string;
  columnas: ColumnaDef<T>[];
  filas: T[];
  idFila: (fila: T) => string;

  /** Primera carga, sin datos: skeleton. */
  cargando: boolean;
  /** Recarga con datos previos: aria-busy y opacidad, sin salto de layout. */
  actualizando?: boolean;
  error?: unknown;
  onReintentar?: () => void;

  /** Ausente = tabla sin paginar. */
  paginacion?: PaginacionProps;
  vacio: { icono: ReactNode; titulo: string; accion?: ReactNode };
  vacioConFiltros?: { titulo: string; onLimpiar: () => void };
  /** Si es true se usa `vacioConFiltros` en lugar de `vacio`. */
  hayFiltros?: boolean;

  /** Última columna, alineada a la derecha. */
  acciones?: (fila: T) => ReactNode;
  /** Detalle bajo la fila. */
  filaExpandida?: (fila: T) => ReactNode;
  idExpandida?: string | null;
  onExpandir?: (id: string | null) => void;
  filasSkeleton?: number;
}

const ALINEACION = {
  izquierda: 'text-left',
  derecha: 'text-right tabular-nums',
  centro: 'text-center',
} as const;

function claseColumna<T>(c: ColumnaDef<T>): string {
  return [
    ALINEACION[c.alineacion ?? 'izquierda'],
    c.claseAncho ?? '',
    c.ocultaEnMovil ? 'hidden sm:table-cell' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function SkeletonTabla({
  columnas,
  filas,
}: {
  columnas: number;
  filas: number;
}) {
  return (
    <div
      className="overflow-hidden rounded-2xl border border-gray-200 bg-white"
      aria-busy="true"
    >
      <div className="border-b border-gray-100 bg-gray-50/60 px-4 py-3.5">
        <div className="skeleton h-3 w-1/3" />
      </div>
      {Array.from({ length: filas }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-gray-100 px-4 py-4 last:border-0"
        >
          {Array.from({ length: columnas }).map((__, j) => (
            <div key={j} className="skeleton h-3 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function DataTable<T>({
  etiqueta,
  columnas,
  filas,
  idFila,
  cargando,
  actualizando = false,
  error,
  onReintentar,
  paginacion,
  vacio,
  vacioConFiltros,
  hayFiltros = false,
  acciones,
  filaExpandida,
  idExpandida = null,
  onExpandir,
  filasSkeleton,
}: DataTableProps<T>) {
  const nCols = columnas.length + (acciones ? 1 : 0) + (filaExpandida ? 1 : 0);

  if (cargando) {
    return (
      <SkeletonTabla
        columnas={Math.min(nCols, 6)}
        filas={filasSkeleton ?? Math.min(paginacion?.pageSize ?? 6, 10)}
      />
    );
  }
  if (error && filas.length === 0) {
    return <EstadoError error={error} onReintentar={onReintentar} />;
  }
  if (filas.length === 0) {
    if (hayFiltros && vacioConFiltros) {
      return (
        <EmptyState icon={vacio.icono} title={vacioConFiltros.titulo}>
          <button
            onClick={vacioConFiltros.onLimpiar}
            className="text-sm font-medium text-amber-700 hover:underline"
          >
            Limpiar filtros
          </button>
        </EmptyState>
      );
    }
    return (
      <EmptyState icon={vacio.icono} title={vacio.titulo}>
        {vacio.accion}
      </EmptyState>
    );
  }

  return (
    <div>
      {error ? (
        <div className="mb-3">
          <EstadoError error={error} onReintentar={onReintentar} compacto />
        </div>
      ) : null}
      <div
        className={`overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm transition-opacity ${
          actualizando ? 'opacity-60' : ''
        }`}
        aria-busy={actualizando}
      >
        <table className="w-full text-sm" aria-label={etiqueta}>
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/60 text-xs tracking-wide text-gray-500 uppercase">
              {filaExpandida && <th className="w-8 px-2 py-3" />}
              {columnas.map((c) => (
                <th
                  key={c.id}
                  scope="col"
                  className={`px-4 py-3 font-medium ${claseColumna(c)}`}
                >
                  {c.cabecera}
                </th>
              ))}
              {acciones && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody>
            {filas.map((fila) => {
              const id = idFila(fila);
              const abierta = idExpandida === id;
              return (
                <Fragment key={id}>
                  <tr className="border-b border-gray-100 transition-colors last:border-0 hover:bg-amber-50/40">
                    {filaExpandida && (
                      <td className="px-2 py-3">
                        <button
                          onClick={() => onExpandir?.(abierta ? null : id)}
                          aria-expanded={abierta}
                          aria-label={
                            abierta ? 'Ocultar detalle' : 'Ver detalle'
                          }
                          className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                        >
                          {abierta ? (
                            <IconChevronUp size={14} />
                          ) : (
                            <IconChevronDown size={14} />
                          )}
                        </button>
                      </td>
                    )}
                    {columnas.map((c) => (
                      <td key={c.id} className={`px-4 py-3 ${claseColumna(c)}`}>
                        {c.celda(fila)}
                      </td>
                    ))}
                    {acciones && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                          {acciones(fila)}
                        </div>
                      </td>
                    )}
                  </tr>
                  {abierta && filaExpandida && (
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      <td colSpan={nCols} className="px-6 py-4">
                        {filaExpandida(fila)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {paginacion && (
        <Paginacion {...paginacion} deshabilitada={actualizando} />
      )}
    </div>
  );
}
