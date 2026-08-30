'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  TRAFFIC_LIGHT_LABELS,
  type MonthlyPlanRowDto,
  type TrafficLight,
} from '@erp/shared';
import { forecastApi, formatEur, projectsApi } from '@/lib/api';
import { IconAlertTriangle, IconChart } from '@/components/icons';
import { useToast } from '@/components/toast';
import {
  EmptyState,
  ErrorBanner,
  PageHeader,
  TableSkeleton,
  btnGhostCls,
  btnPrimaryCls,
  fieldCls,
  labelCls,
  selectCls,
} from '@/components/ui';

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

const LIGHT_TONE: Record<TrafficLight, string> = {
  verde: 'bg-emerald-100 text-emerald-700',
  ambar: 'bg-amber-100 text-amber-700',
  rojo: 'bg-red-100 text-red-700',
};

const pct = (v: number | null) => (v === null ? '—' : `${v} %`);

/** Una de las cuatro cajas del coste probable. */
function CostBucket({
  label,
  amount,
  hint,
  strong = false,
}: {
  label: string;
  amount: number;
  hint: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        strong
          ? 'border-gray-900 bg-gray-900 text-white'
          : 'border-gray-200 bg-white'
      }`}
    >
      <p
        className={`text-[11px] font-semibold tracking-wide uppercase ${
          strong ? 'text-gray-300' : 'text-gray-500'
        }`}
      >
        {label}
      </p>
      <p className="mt-1 text-xl font-bold tabular-nums">{formatEur(amount)}</p>
      <p
        className={`mt-1 text-[11px] ${strong ? 'text-gray-400' : 'text-gray-500'}`}
      >
        {hint}
      </p>
    </div>
  );
}

export default function EconomiaPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [projectId, setProjectId] = useState('');
  const [planRows, setPlanRows] = useState<MonthlyPlanRowDto[]>([]);
  const [editingPlan, setEditingPlan] = useState(false);
  const [pending, setPending] = useState('');
  const [reportedBy, setReportedBy] = useState('');

  const projectsQuery = useQuery({
    queryKey: ['projects', '', ''],
    queryFn: () => projectsApi.list('', ''),
    staleTime: 5 * 60_000,
  });

  // Al entrar se selecciona la primera obra: la pantalla sirve para mirar,
  // no para elegir en un desplegable vacío.
  useEffect(() => {
    if (!projectId && projectsQuery.data?.length) {
      setProjectId(projectsQuery.data[0].id);
    }
  }, [projectId, projectsQuery.data]);

  const query = useQuery({
    queryKey: ['economia', projectId],
    queryFn: () => forecastApi.economics(projectId),
    enabled: Boolean(projectId),
  });

  const planQuery = useQuery({
    queryKey: ['plan', projectId],
    queryFn: () => forecastApi.getPlan(projectId),
    enabled: Boolean(projectId),
  });

  useEffect(() => {
    if (planQuery.data) setPlanRows(planQuery.data);
  }, [planQuery.data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['economia'] });
    qc.invalidateQueries({ queryKey: ['plan'] });
  };

  const savePlan = useMutation({
    mutationFn: () => forecastApi.savePlan(projectId, { rows: planRows }),
    onSuccess: () => {
      toast('Planificación guardada');
      setEditingPlan(false);
      invalidate();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const saveForecast = useMutation({
    mutationFn: () =>
      forecastApi.saveForecast(projectId, {
        asOfMonth: `${new Date().toISOString().slice(0, 7)}-01`,
        pendingToContract: Number(pending.replace(',', '.')) || 0,
        reportedBy: reportedBy || null,
      }),
    onSuccess: () => {
      toast('Previsión registrada');
      setPending('');
      invalidate();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const e = query.data;

  return (
    <div>
      <PageHeader
        title="Economía de obra"
        subtitle="Coste probable y evolución mensual · lo que se revisa en la reunión"
      >
        <select
          className={selectCls}
          value={projectId}
          onChange={(ev) => setProjectId(ev.target.value)}
        >
          {projectsQuery.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </select>
      </PageHeader>

      {query.isError && <ErrorBanner message={errText(query.error)} />}
      {query.isLoading && <TableSkeleton rows={4} />}

      {!projectId && projectsQuery.isSuccess && (
        <EmptyState
          icon={<IconChart size={26} />}
          title="Todavía no hay obras que analizar"
        />
      )}

      {e && (
        <>
          {/* Avisos: lo que hay que leer antes de entrar en la reunión */}
          {e.warnings.length > 0 && (
            <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900">
                <IconAlertTriangle size={16} />
                Antes de la reunión
              </p>
              <ul className="space-y-1.5">
                {e.warnings.map((w) => (
                  <li key={w} className="text-sm text-amber-800">
                    · {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Coste probable: los cuatro sumandos, que no se solapan */}
          <h2 className="mb-1 text-sm font-semibold">Coste probable</h2>
          <p className="mb-3 text-xs text-gray-500">
            Cada euro cae en un solo sumando, según lo lejos que esté de estar
            pagado. Sumar el importe íntegro de los pedidos al coste facturado
            contaría dos veces lo que ya llegó.
          </p>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <CostBucket
              label="Facturado"
              amount={e.probableCost.invoicedCost}
              hint="Ya hay factura de compra"
            />
            <CostBucket
              label="Recibido sin facturar"
              amount={e.probableCost.accruedCost}
              hint="La provisión del cierre"
            />
            <CostBucket
              label="Comprometido"
              amount={e.probableCost.committedCost}
              hint="Pedido, aún no servido"
            />
            <CostBucket
              label="Por contratar"
              amount={e.probableCost.pendingToContract}
              hint="Estimación del jefe de obra"
            />
            <CostBucket
              strong
              label="Coste probable"
              amount={e.probableCost.total}
              hint="Lo que va a costar la obra"
            />
          </div>

          {/* Previsión a cierre */}
          <div className="mb-8 grid gap-4 rounded-2xl border border-gray-200 bg-white p-5 sm:grid-cols-4">
            <div>
              <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
                Presupuesto de venta
              </p>
              <p className="mt-1 text-lg font-bold tabular-nums">
                {formatEur(e.atCompletion.salesBudget)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
                Coste objetivo
              </p>
              <p className="mt-1 text-lg font-bold tabular-nums">
                {e.atCompletion.targetCost === null
                  ? '—'
                  : formatEur(e.atCompletion.targetCost)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
                Desvío sobre objetivo
              </p>
              <p
                className={`mt-1 text-lg font-bold tabular-nums ${
                  (e.atCompletion.costDeviation ?? 0) > 0
                    ? 'text-red-600'
                    : 'text-emerald-600'
                }`}
              >
                {e.atCompletion.costDeviation === null
                  ? '—'
                  : formatEur(e.atCompletion.costDeviation)}
                <span className="ml-1 text-xs font-medium">
                  {pct(e.atCompletion.costDeviationPct)}
                </span>
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
                Margen previsto a cierre
              </p>
              <p
                className={`mt-1 text-lg font-bold tabular-nums ${
                  e.atCompletion.margin < 0 ? 'text-red-600' : ''
                }`}
              >
                {formatEur(e.atCompletion.margin)}
                <span className="ml-1 text-xs font-medium text-gray-500">
                  {pct(e.atCompletion.marginPct)}
                </span>
              </p>
            </div>
          </div>

          {/* Evolución mensual: las tres curvas sobre el mismo eje de meses */}
          <div className="mb-2 flex items-center gap-3">
            <h2 className="text-sm font-semibold">
              Evolución económica mensual
            </h2>
            <button
              className={btnGhostCls}
              onClick={() => setEditingPlan((v) => !v)}
            >
              {editingPlan ? 'Cerrar plan' : 'Editar planificación'}
            </button>
          </div>
          {e.evolution.firstDivergenceMonth && (
            <p className="mb-3 text-xs text-red-700">
              El coste real se separó del plan en{' '}
              <strong>{e.evolution.firstDivergenceMonth.slice(0, 7)}</strong>.
              La causa está en ese mes, no en el último.
            </p>
          )}

          {e.evolution.rows.length === 0 ? (
            <EmptyState
              icon={<IconChart size={26} />}
              title="No hay meses que comparar todavía"
            >
              <p className="mx-auto max-w-md text-sm text-gray-500">
                Reparte producción y coste por meses en la planificación: sin
                ese reparto no existe el corte mensual.
              </p>
            </EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/60 text-left text-xs tracking-wide text-gray-500 uppercase">
                    <th className="px-4 py-3 font-medium">Mes</th>
                    <th className="px-4 py-3 text-right font-medium">
                      Producción plan
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      Producción real
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      Coste plan
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      Coste real
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      Margen mes
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      Margen acum.
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      Desvío coste
                    </th>
                    <th className="px-4 py-3 font-medium">Semáforo</th>
                  </tr>
                </thead>
                <tbody>
                  {e.evolution.rows.map((r) => (
                    <tr
                      key={r.month}
                      className={`border-b border-gray-100 last:border-0 ${
                        r.month === e.evolution.firstDivergenceMonth
                          ? 'bg-red-50/60'
                          : ''
                      }`}
                    >
                      <td className="px-4 py-3 font-medium">
                        {r.month.slice(0, 7)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                        {formatEur(r.plannedProduction)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatEur(r.realProduction)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                        {formatEur(r.plannedCost)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatEur(r.realCost)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums ${
                          r.monthMargin < 0 ? 'text-red-600' : ''
                        }`}
                      >
                        {formatEur(r.monthMargin)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
                        {formatEur(r.cumulativeMargin)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {pct(r.costDeviationPct)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${LIGHT_TONE[r.light]}`}
                        >
                          {TRAFFIC_LIGHT_LABELS[r.light]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Editor de la periodificación */}
          {editingPlan && (
            <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
              <h3 className="mb-1 text-sm font-semibold">
                Planificación económica
              </h3>
              <p className="mb-4 text-xs text-gray-500">
                Reparto por meses de la producción y el coste previstos hasta
                fin de obra.
              </p>
              <div className="space-y-2">
                {planRows.map((row, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-2">
                    <div>
                      <label className={labelCls}>Mes</label>
                      <input
                        type="month"
                        className={fieldCls}
                        value={row.month.slice(0, 7)}
                        onChange={(ev) =>
                          setPlanRows((rows) =>
                            rows.map((r, j) =>
                              j === i
                                ? { ...r, month: `${ev.target.value}-01` }
                                : r,
                            ),
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Producción prevista</label>
                      <input
                        className={fieldCls}
                        inputMode="decimal"
                        value={row.plannedProduction}
                        onChange={(ev) =>
                          setPlanRows((rows) =>
                            rows.map((r, j) =>
                              j === i
                                ? {
                                    ...r,
                                    plannedProduction:
                                      Number(ev.target.value) || 0,
                                  }
                                : r,
                            ),
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Coste previsto</label>
                      <input
                        className={fieldCls}
                        inputMode="decimal"
                        value={row.plannedCost}
                        onChange={(ev) =>
                          setPlanRows((rows) =>
                            rows.map((r, j) =>
                              j === i
                                ? {
                                    ...r,
                                    plannedCost: Number(ev.target.value) || 0,
                                  }
                                : r,
                            ),
                          )
                        }
                      />
                    </div>
                    <button
                      className="pb-2 text-xs text-gray-500 hover:text-red-600"
                      onClick={() =>
                        setPlanRows((rows) => rows.filter((_, j) => j !== i))
                      }
                    >
                      Quitar
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  className={btnGhostCls}
                  onClick={() =>
                    setPlanRows((rows) => [
                      ...rows,
                      {
                        month: `${new Date().toISOString().slice(0, 7)}-01`,
                        plannedProduction: 0,
                        plannedCost: 0,
                      },
                    ])
                  }
                >
                  Añadir mes
                </button>
                <button
                  className={btnPrimaryCls}
                  disabled={savePlan.isPending}
                  onClick={() => savePlan.mutate()}
                >
                  {savePlan.isPending ? 'Guardando…' : 'Guardar planificación'}
                </button>
              </div>
            </section>
          )}

          {/* Declaración del coste pendiente de contratar */}
          <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
            <h3 className="mb-1 text-sm font-semibold">
              Coste pendiente de contratar y ejecutar
            </h3>
            <p className="mb-4 text-xs text-gray-500">
              Es el único sumando del coste probable que no sale de ningún
              documento: lo estima el jefe de obra. Se guarda el histórico para
              poder contrastar después lo que se dijo con lo que costó.
              {e.lastForecast && (
                <>
                  {' '}
                  Última:{' '}
                  <strong>
                    {formatEur(e.lastForecast.pendingToContract)}
                  </strong>{' '}
                  ({e.lastForecast.asOfMonth.slice(0, 7)}
                  {e.lastForecast.reportedBy &&
                    `, ${e.lastForecast.reportedBy}`}
                  ).
                </>
              )}
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className={labelCls}>Importe estimado (€)</label>
                <input
                  className={fieldCls}
                  inputMode="decimal"
                  value={pending}
                  onChange={(ev) => setPending(ev.target.value)}
                  placeholder="7500000"
                />
              </div>
              <div>
                <label className={labelCls}>Quién lo declara</label>
                <input
                  className={fieldCls}
                  value={reportedBy}
                  onChange={(ev) => setReportedBy(ev.target.value)}
                  placeholder="Jefe de obra"
                />
              </div>
              <button
                className={btnPrimaryCls}
                disabled={saveForecast.isPending || pending === ''}
                onClick={() => saveForecast.mutate()}
              >
                {saveForecast.isPending ? 'Guardando…' : 'Registrar previsión'}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
