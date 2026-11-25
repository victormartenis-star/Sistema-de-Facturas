'use client';

import { useQuery } from '@tanstack/react-query';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { costControlApi, formatEur } from '@/lib/api';
import { TableSkeleton } from '@/components/ui';
import { EstadoError } from '@/components/data-table';
import { KpiCard } from '@/components/kpi-card';
import { IconAlertTriangle } from '@/components/icons';

/**
 * Analítica de costes en tiempo real de una obra: BAC/AC/EV, margen, CPI,
 * EAC, curva de coste real vs. producción ganada y alertas de sobrecoste
 * por partida. Ver [[Control de Costes y Partes Diarios]].
 */
export function CostControlDashboard({ projectId }: { projectId: string }) {
  const query = useQuery({
    queryKey: ['cost-control', projectId],
    queryFn: () => costControlApi.get(projectId),
  });

  if (query.isLoading) return <TableSkeleton rows={3} />;
  if (query.isError)
    return (
      <EstadoError
        error={query.error}
        onReintentar={() => void query.refetch()}
      />
    );
  if (!query.data) return null;

  const cc = query.data;
  const overBudgetRows = cc.sobrecostePorPartida.filter((r) => r.overBudget);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard etiqueta="Presupuesto (BAC)" valor={formatEur(cc.bac)} />
        <KpiCard etiqueta="Coste real (AC)" valor={formatEur(cc.ac)} />
        <KpiCard etiqueta="Producción ganada (EV)" valor={formatEur(cc.ev)} />
        <KpiCard
          etiqueta="Margen actual"
          valor={formatEur(cc.currentMargin)}
          tono={cc.currentMargin >= 0 ? 'bueno' : 'malo'}
          detalle={
            cc.currentMarginPct !== null
              ? `${cc.currentMarginPct.toFixed(1)} % de lo ganado`
              : undefined
          }
        />
        <KpiCard
          etiqueta="CPI"
          valor={cc.cpi !== null ? cc.cpi.toFixed(2) : '—'}
          tono={cc.cpi !== null ? (cc.cpi >= 1 ? 'bueno' : 'malo') : 'neutro'}
          detalle="Ganado / gastado — por debajo de 1 es sobrecoste"
        />
        <KpiCard
          etiqueta={`Estimación a fin de obra (EAC${cc.origenEac === 'manual' ? ' manual' : ''})`}
          valor={formatEur(cc.eac)}
          tono={cc.varianceAtCompletion >= 0 ? 'bueno' : 'malo'}
          detalle={
            `${cc.varianceAtCompletion >= 0 ? 'Ahorro' : 'Sobrecoste'} previsto: ${formatEur(Math.abs(cc.varianceAtCompletion))}` +
            (cc.origenEac === 'manual'
              ? ` · por CPI: ${formatEur(cc.eacCalculada)}`
              : '') +
            (cc.eacAjustadaAlReal ? ' · elevada al coste real' : '')
          }
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <KpiCard
          etiqueta="Falta por gastar (ETC)"
          valor={formatEur(cc.etc)}
          detalle="EAC − coste real"
        />
        <KpiCard
          etiqueta="TCPI"
          valor={cc.tcpi !== null ? cc.tcpi.toFixed(2) : '—'}
          tono={cc.tcpi === null ? 'neutro' : cc.tcpi <= 1 ? 'bueno' : 'aviso'}
          detalle="Rendimiento necesario en lo que falta para cumplir el BAC"
        />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-1 text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
          Desglose del coste real imputado
        </p>
        <div className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-6">
          <div>
            <p className="text-gray-500">Facturas de compra</p>
            <p className="font-semibold tabular-nums">
              {formatEur(cc.acBreakdown.facturasCompra)}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Partes de personal</p>
            <p className="font-semibold tabular-nums">
              {formatEur(cc.acBreakdown.partesPersonal)}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Partes de maquinaria</p>
            <p className="font-semibold tabular-nums">
              {formatEur(cc.acBreakdown.partesMaquinaria)}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Almacén (consumo neto)</p>
            <p className="font-semibold tabular-nums">
              {formatEur(cc.acBreakdown.almacen)}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Amortización imputada</p>
            <p className="font-semibold tabular-nums">
              {formatEur(cc.acBreakdown.amortizacion)}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Avales (comisiones y ejecuciones)</p>
            <p className="font-semibold tabular-nums">
              {formatEur(cc.acBreakdown.avales)}
            </p>
          </div>
        </div>
      </div>

      {cc.curvaS.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="mb-3 text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
            Coste real vs. producción ganada (acumulado)
          </p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cc.curvaS}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f1f1" />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: number) => formatEur(v)}
                  width={80}
                />
                <Tooltip formatter={(value) => formatEur(Number(value))} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="actualCumulative"
                  name="Coste real acumulado"
                  stroke="#dc2626"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="earnedCumulative"
                  name="Producción ganada acumulada"
                  stroke="#059669"
                  strokeWidth={2}
                  dot={false}
                />
                {cc.curvaS.some((p) => p.plannedCumulative !== null) && (
                  <Line
                    type="monotone"
                    dataKey="plannedCumulative"
                    name="Planificado (PV)"
                    stroke="#94a3b8"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    dot={false}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
          {cc.curvaS.every((p) => p.plannedCumulative === null) ? (
            <p className="mt-2 text-[11px] text-gray-400">
              Sin curva planificada: ninguna partida de esta obra tiene
              cronograma (inicio/fin planificado) puesto todavía.
            </p>
          ) : (
            cc.curvaPlanificadaPartidasSinFechas > 0 && (
              <p className="mt-2 text-[11px] text-amber-600">
                Curva planificada parcial:{' '}
                {cc.curvaPlanificadaPartidasSinFechas} partida(s) con
                presupuesto no tienen cronograma puesto.
              </p>
            )
          )}
        </div>
      )}

      {overBudgetRows.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-red-800">
            <IconAlertTriangle size={15} /> Partidas con sobrecoste
          </p>
          <div className="space-y-1.5">
            {overBudgetRows.map((r) => (
              <div
                key={r.phaseId}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-red-900">
                  {r.code} · {r.name}
                </span>
                <span className="font-semibold tabular-nums text-red-700">
                  +{formatEur(r.deviation)}
                  {r.deviationPct !== null &&
                    ` (+${r.deviationPct.toFixed(1)}%)`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
