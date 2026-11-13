'use client';

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { projectsApi } from '@/lib/api';
import { btnGhostCls, selectCls } from '@/components/ui';

/** Contenedor de filtros con botón "Limpiar filtros". */
export function BarraFiltros({
  children,
  hayFiltros,
  onLimpiar,
}: {
  children: ReactNode;
  hayFiltros: boolean;
  onLimpiar: () => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {children}
      {hayFiltros && (
        <button onClick={onLimpiar} className={btnGhostCls}>
          Limpiar filtros
        </button>
      )}
    </div>
  );
}

/** Selector de obra (consulta propia y compartida en caché). */
export function FiltroObra({
  value,
  onChange,
  obligatorio = false,
  etiquetaTodas = 'Todas las obras',
}: {
  value: string;
  onChange: (projectId: string) => void;
  /** En presupuestos y certificaciones no existe "todas". */
  obligatorio?: boolean;
  etiquetaTodas?: string;
}) {
  const query = useQuery({
    queryKey: ['projects', '', ''],
    queryFn: () => projectsApi.list('', ''),
    staleTime: 5 * 60_000,
  });
  return (
    <select
      className={selectCls}
      aria-label="Obra"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">
        {obligatorio ? 'Selecciona una obra…' : etiquetaTodas}
      </option>
      {(query.data ?? []).map((p) => (
        <option key={p.id} value={p.id}>
          {p.code} · {p.name}
        </option>
      ))}
    </select>
  );
}

/** Selector de estado genérico. */
export function FiltroEstado<E extends string>({
  value,
  onChange,
  estados,
  etiquetas,
  etiquetaTodos = 'Todos los estados',
}: {
  value: E | '';
  onChange: (v: E | '') => void;
  estados: readonly E[];
  etiquetas: Record<E, string>;
  etiquetaTodos?: string;
}) {
  return (
    <select
      className={selectCls}
      aria-label="Estado"
      value={value}
      onChange={(e) => onChange(e.target.value as E | '')}
    >
      <option value="">{etiquetaTodos}</option>
      {estados.map((s) => (
        <option key={s} value={s}>
          {etiquetas[s]}
        </option>
      ))}
    </select>
  );
}
