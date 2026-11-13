'use client';

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ObraEconomicsDto } from '@erp/shared';
import { costControlApi, formatEur } from '@/lib/api';
import { EstadoError } from '@/components/data-table';
import { KpiCard, type TonoKpi } from '@/components/kpi-card';
import { TablaDesviaciones } from './tabla-desviaciones';
import { PanelRetenciones } from './panel-retenciones';

const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)} %`);

function Seccion({
  titulo,
  children,
}: {
  titulo: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold">{titulo}</h2>
      {children}
    </section>
  );
}

function Barra({
  etiqueta,
  valor,
}: {
  etiqueta: string;
  valor: number | null;
}) {
  const ancho = valor === null ? 0 : Math.min(100, Math.max(0, valor));
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-gray-600">
        <span>{etiqueta}</span>
        <span className="font-medium tabular-nums">{pct(valor)}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full bg-amber-500"
          style={{ width: `${ancho}%` }}
        />
      </div>
    </div>
  );
}

function SkeletonDashboard() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Cargando dashboard">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <KpiCard key={i} etiqueta="Cargando" valor="" cargando />
        ))}
      </div>
      <div className="skeleton h-32 w-full rounded-2xl" />
      <div className="skeleton h-64 w-full rounded-2xl" />
      <div className="skeleton h-40 w-full rounded-2xl" />
    </div>
  );
}

function Contenido({ d }: { d: ObraEconomicsDto }) {
  const { margen, previsto, retenciones, iva } = d;
  const sinActividad =
    margen.certificado === 0 &&
    margen.costeReal === 0 &&
    d.desviaciones.length === 0;
  const tonoMargen: TonoKpi =
    margen.margenSobreCertificado >= 0 ? 'bueno' : 'malo';
  const diferencia = previsto.diferenciaPuntos;
  return (
    <div className="space-y-6">
      {sinActividad && (
        <p className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
          Aún no hay certificaciones ni costes imputados.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard
          etiqueta="Ingresos certificados"
          valor={formatEur(margen.certificado)}
          detalle={`Facturado ${formatEur(margen.facturadoVenta)} · pendiente de facturar ${formatEur(margen.pendienteFacturar)}`}
        />
        <KpiCard
          etiqueta="Costes reales imputados"
          valor={formatEur(margen.costeReal)}
          detalle={
            margen.facturasCompraEnBorrador > 0
              ? `Incluye ${formatEur(margen.facturasCompraEnBorrador)} en facturas sin aprobar`
              : undefined
          }
        />
        <KpiCard
          etiqueta="Margen bruto actual"
          valor={formatEur(margen.margenSobreCertificado)}
          tono={tonoMargen}
          detalle={`${pct(margen.margenSobreCertificadoPct)} sobre certificado`}
        />
        <KpiCard
          etiqueta="Margen previsto"
          valor={
            previsto.margenPrevisto === null
              ? '—'
              : formatEur(previsto.margenPrevisto)
          }
          detalle={
            previsto.margenPrevisto === null
              ? 'Falta importe de contrato o presupuesto'
              : `${pct(previsto.margenPrevistoPct)} sobre contrato`
          }
        />
        <KpiCard
          etiqueta="Retención pendiente de cobro"
          valor={formatEur(retenciones.aCobrarDeCliente.pendiente)}
          tono={retenciones.aCobrarDeCliente.vencido > 0 ? 'aviso' : 'neutro'}
          detalle={`Retenido acumulado ${formatEur(retenciones.aCobrarDeCliente.retenido)}`}
        />
      </div>

      <Seccion titulo="Margen actual frente al previsto">
        <div className="space-y-3">
          <Barra
            etiqueta="Margen actual (sobre certificado)"
            valor={margen.margenSobreCertificadoPct}
          />
          <Barra
            etiqueta="Margen previsto (sobre contrato)"
            valor={previsto.margenPrevistoPct}
          />
        </div>
        <p className="mt-3 text-xs text-gray-500">
          {diferencia === null
            ? 'No se puede comparar: falta el margen actual o el previsto.'
            : `${diferencia >= 0 ? '+' : ''}${diferencia.toFixed(1)} puntos respecto al previsto.`}
        </p>
        <details className="mt-3 text-xs text-gray-500">
          <summary className="cursor-pointer">Desglose del coste real</summary>
          <p className="mt-2 tabular-nums">
            Facturas de compra {formatEur(margen.costes.facturasCompra)} ·
            Partes de personal {formatEur(margen.costes.partesPersonal)} ·
            Partes de maquinaria {formatEur(margen.costes.partesMaquinaria)}
          </p>
        </details>
      </Seccion>

      <Seccion titulo="Desviación frente a presupuesto">
        <TablaDesviaciones
          filas={d.desviaciones}
          totalPresupuestado={previsto.totalPresupuestado}
          totalReal={margen.costeReal}
        />
      </Seccion>

      <Seccion titulo="Retenciones acumuladas">
        <PanelRetenciones r={retenciones} />
      </Seccion>

      <details className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <summary className="cursor-pointer text-sm font-semibold">
          IVA de la obra
        </summary>
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-gray-500">Repercutido</dt>
            <dd className="font-medium tabular-nums">
              {formatEur(iva.totalRepercutido)}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Soportado</dt>
            <dd className="font-medium tabular-nums">
              {formatEur(iva.totalSoportado)}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Saldo (positivo = a ingresar)</dt>
            <dd className="font-medium tabular-nums">{formatEur(iva.saldo)}</dd>
          </div>
        </dl>
      </details>
    </div>
  );
}

/** Dashboard ejecutivo de una obra, alimentado solo por `GET /projects/:id/economics`. */
export function DashboardEjecutivo({ projectId }: { projectId: string }) {
  const query = useQuery({
    queryKey: ['economics', projectId],
    queryFn: () => costControlApi.economics(projectId),
  });

  if (query.isLoading) return <SkeletonDashboard />;
  if (query.isError)
    return (
      <EstadoError
        error={query.error}
        onReintentar={() => void query.refetch()}
      />
    );
  if (!query.data) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-3 text-xs text-gray-500">
        <span>
          Actualizado a las{' '}
          {new Date(query.data.generadoEn).toLocaleTimeString('es-ES', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
        <button
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          className="rounded-md border border-gray-200 px-3 py-1 font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
        >
          {query.isFetching ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>
      <Contenido d={query.data} />
    </div>
  );
}
