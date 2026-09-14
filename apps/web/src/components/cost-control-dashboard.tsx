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
import { ErrorBanner, TableSkeleton } from '@/components/ui';
import { IconAlertTriangle } from '@/components/icons';

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

function Kpi({
  label,
  value,
  tone = 'default',
  hint,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'good' | 'bad';
  hint?: string;
}) {
  const toneCls =
    tone === 'good'
      ? 'text-emerald-700'
      : tone === 'bad'
        ? 'text-red-700'
        : 'text-gray-900';
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
        {label}
      </p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${toneCls}`}>
        {value}
      </p>
      {hint && <p className="mt-1 text-[11px] text-gray-500">{hint}</p>}
    </div>
  );
}

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
  if (query.isError) return <ErrorBanner message={errText(query.error)} />;
  if (!query.data) return null;

  const cc = query.data;
  const overBudgetRows = cc.sobrecostePorPartida.filter((r) => r.overBudget);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Presupuesto (BAC)" value={formatEur(cc.bac)} />
        <Kpi label="Coste real (AC)" value={formatEur(cc.ac)} />
        <Kpi label="Producción ganada (EV)" value={formatEur(cc.ev)} />
        <Kpi
          label="Margen actual"
          value={formatEur(cc.currentMargin)}
          tone={cc.currentMargin >= 0 ? 'good' : 'bad'}
          hint={
            cc.currentMarginPct !== null
              ? `${cc.currentMarginPct.toFixed(1)} % de lo ganado`
              : undefined
          }
        />
        <Kpi
          label="CPI"
          value={cc.cpi !== null ? cc.cpi.toFixed(2) : '—'}
          tone={cc.cpi !== null ? (cc.cpi >= 1 ? 'good' : 'bad') : 'default'}
          hint="Ganado / gastado — por debajo de 1 es sobrecoste"
        />
        <Kpi
          label="Estimación a fin de obra (EAC)"
          value={formatEur(cc.eac)}
          tone={cc.varianceAtCompletion >= 0 ? 'good' : 'bad'}
          hint={`${cc.varianceAtCompletion >= 0 ? 'Ahorro' : 'Sobrecoste'} previsto: ${formatEur(Math.abs(cc.varianceAtCompletion))}`}
        />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-1 text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
          Desglose del coste real imputado
        </p>
        <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
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
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-[11px] text-gray-400">
            Sin curva de planificación teórica: esta obra no tiene un cronograma
            cargado todavía.
          </p>
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
