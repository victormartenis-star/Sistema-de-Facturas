import type { ReactNode } from 'react';

export type TonoKpi = 'neutro' | 'bueno' | 'malo' | 'aviso';

const CLASE_TONO: Record<TonoKpi, string> = {
  neutro: 'text-gray-900',
  bueno: 'text-emerald-700',
  malo: 'text-red-700',
  aviso: 'text-amber-600',
};

/** Tarjeta de indicador única de la aplicación (sustituye a `Kpi` y `KpiCard`). */
export function KpiCard({
  etiqueta,
  valor,
  tono = 'neutro',
  detalle,
  cargando = false,
}: {
  etiqueta: string;
  valor: string;
  tono?: TonoKpi;
  detalle?: ReactNode;
  cargando?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
        {etiqueta}
      </p>
      {cargando ? (
        <div className="mt-2 h-7 w-24 animate-pulse rounded bg-gray-200" />
      ) : (
        <p
          className={`mt-1 text-xl font-bold tabular-nums ${CLASE_TONO[tono]}`}
        >
          {valor}
        </p>
      )}
      {detalle && !cargando && (
        <p className="mt-1 text-[11px] text-gray-500">{detalle}</p>
      )}
    </div>
  );
}
