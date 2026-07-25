'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  MILESTONE_KIND_LABELS,
  type CashflowGrouping,
  type MilestoneDto,
} from '@erp/shared';
import { formatDate, formatEur, treasuryApi } from '@/lib/api';
import { useToast } from '@/components/toast';
import {
  IconAlertTriangle,
  IconCheck,
  IconEuro,
  IconTrendingUp,
  IconWallet,
} from '@/components/icons';
import { ErrorBanner, PageHeader, selectCls } from '@/components/ui';

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function TesoreriaPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [groupBy, setGroupBy] = useState<CashflowGrouping>('semana');
  const [direction, setDirection] = useState('');
  const [milestoneStatus, setMilestoneStatus] = useState('previsto');

  const cashflowQuery = useQuery({
    queryKey: ['cashflow', groupBy],
    queryFn: () => treasuryApi.cashflow(groupBy),
  });

  const milestonesQuery = useQuery({
    queryKey: ['milestones', direction, milestoneStatus],
    queryFn: () =>
      treasuryApi.milestones({
        direction: direction || undefined,
        status: milestoneStatus || undefined,
      }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['cashflow'] });
    qc.invalidateQueries({ queryKey: ['milestones'] });
    qc.invalidateQueries({ queryKey: ['invoices'] });
  };

  const payMutation = useMutation({
    mutationFn: (id: string) => treasuryApi.pay(id),
    onSuccess: () => {
      toast('Vencimiento liquidado');
      invalidate();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const reopenMutation = useMutation({
    mutationFn: (id: string) => treasuryApi.reopen(id),
    onSuccess: () => {
      toast('Vencimiento reabierto');
      invalidate();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const report = cashflowQuery.data;
  const milestones = milestonesQuery.data ?? [];
  const maxFlow = report
    ? Math.max(1, ...report.buckets.map((b) => Math.max(b.cobros, b.pagos)))
    : 1;
  const overdue = milestones.filter(
    (m) => m.status === 'previsto' && m.dueDate < todayIso(),
  );

  return (
    <div className="animate-fade-in-up">
      <PageHeader title="Tesorería" subtitle="Previsión de caja a 90 días y calendario de vencimientos" />

      {cashflowQuery.isError && (
        <ErrorBanner message={errText(cashflowQuery.error)} />
      )}

      {report && (
        <>
          {/* Indicadores */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <IconTrendingUp size={19} />
                </span>
                <p className="text-sm font-medium text-gray-500">
                  Cobros previstos
                </p>
              </div>
              <p className="mt-4 text-2xl font-bold tracking-tight text-emerald-600 tabular-nums">
                {formatEur(report.totalCobros)}
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-500">
                  <IconEuro size={19} />
                </span>
                <p className="text-sm font-medium text-gray-500">
                  Pagos previstos
                </p>
              </div>
              <p className="mt-4 text-2xl font-bold tracking-tight text-red-500 tabular-nums">
                {formatEur(report.totalPagos)}
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                  <IconWallet size={19} />
                </span>
                <p className="text-sm font-medium text-gray-500">Saldo neto</p>
              </div>
              <p
                className={`mt-4 text-2xl font-bold tracking-tight tabular-nums ${
                  report.saldoFinal < 0 ? 'text-red-600' : 'text-gray-900'
                }`}
              >
                {formatEur(report.saldoFinal)}
              </p>
            </div>
            <div
              className={`rounded-2xl border p-5 shadow-sm ${
                report.alertas > 0
                  ? 'border-red-200 bg-red-50'
                  : 'border-gray-200 bg-white'
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                    report.alertas > 0
                      ? 'bg-red-100 text-red-600'
                      : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  <IconAlertTriangle size={19} />
                </span>
                <p className="text-sm font-medium text-gray-500">
                  Tensión de caja
                </p>
              </div>
              <p
                className={`mt-4 text-2xl font-bold tracking-tight tabular-nums ${
                  report.alertas > 0 ? 'text-red-600' : 'text-gray-900'
                }`}
              >
                {report.alertas > 0
                  ? `${report.alertas} periodo${report.alertas > 1 ? 's' : ''}`
                  : 'Sin alertas'}
              </p>
              {report.alertas > 0 && (
                <p className="mt-1 text-xs text-red-600">
                  Las salidas superan a las entradas acumuladas
                </p>
              )}
            </div>
          </div>

          {/* Gráfico de flujo de caja */}
          <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                Flujo de caja previsto ({formatDate(report.from)} –{' '}
                {formatDate(report.to)})
              </h2>
              <div className="inline-flex rounded-lg border border-gray-200 p-0.5">
                {(['semana', 'mes'] as const).map((g) => (
                  <button
                    key={g}
                    onClick={() => setGroupBy(g)}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                      groupBy === g
                        ? 'bg-amber-500 text-white'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {g === 'semana' ? 'Semanas' : 'Meses'}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto pb-2">
              <div className="flex min-w-full items-end gap-3">
                {report.buckets.map((b) => (
                  <div
                    key={b.periodStart}
                    className={`flex min-w-16 flex-1 flex-col items-center rounded-lg p-2 ${
                      b.tension ? 'bg-red-50' : ''
                    }`}
                    title={`${b.label}: +${b.cobros.toFixed(2)} € / −${b.pagos.toFixed(2)} € · saldo ${b.saldoAcumulado.toFixed(2)} €`}
                  >
                    <div className="flex h-32 items-end gap-1">
                      <div
                        className="w-4 rounded-t bg-emerald-500"
                        style={{
                          height: `${Math.round((b.cobros / maxFlow) * 100)}%`,
                          minHeight: b.cobros > 0 ? '3px' : '0',
                        }}
                      />
                      <div
                        className="w-4 rounded-t bg-red-400"
                        style={{
                          height: `${Math.round((b.pagos / maxFlow) * 100)}%`,
                          minHeight: b.pagos > 0 ? '3px' : '0',
                        }}
                      />
                    </div>
                    <p className="mt-2 text-[10px] font-medium text-gray-500">
                      {b.label}
                    </p>
                    <p
                      className={`text-[10px] font-semibold tabular-nums ${
                        b.saldoAcumulado < 0
                          ? 'text-red-600'
                          : 'text-gray-700'
                      }`}
                    >
                      {formatEur(b.saldoAcumulado)}
                    </p>
                    {b.tension && (
                      <IconAlertTriangle size={11} className="mt-0.5 text-red-500" />
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
                Cobros
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-red-400" />
                Pagos
              </span>
              <span className="flex items-center gap-1.5">
                <IconAlertTriangle size={11} className="text-red-500" />
                Tensión de caja (saldo acumulado negativo)
              </span>
            </div>
          </section>
        </>
      )}

      {/* Calendario de vencimientos */}
      <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold">Calendario de vencimientos</h2>
          {overdue.length > 0 && (
            <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-600">
              {overdue.length} vencido{overdue.length > 1 ? 's' : ''}
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <select
              className={selectCls}
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
            >
              <option value="">Cobros y pagos</option>
              <option value="cobro">Solo cobros</option>
              <option value="pago">Solo pagos</option>
            </select>
            <select
              className={selectCls}
              value={milestoneStatus}
              onChange={(e) => setMilestoneStatus(e.target.value)}
            >
              <option value="previsto">Previstos</option>
              <option value="pagado">Liquidados</option>
              <option value="">Todos</option>
            </select>
          </div>
        </div>

        {milestonesQuery.isError && (
          <ErrorBanner message={errText(milestonesQuery.error)} />
        )}

        {milestones.length === 0 && milestonesQuery.isSuccess ? (
          <p className="py-8 text-center text-sm text-gray-500">
            Sin vencimientos: se generan automáticamente al aprobar facturas.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs tracking-wide text-gray-500 uppercase">
                  <th className="px-3 py-2 font-medium">Vencimiento</th>
                  <th className="px-3 py-2 font-medium">Factura</th>
                  <th className="px-3 py-2 font-medium">Contacto</th>
                  <th className="px-3 py-2 font-medium">Tipo</th>
                  <th className="px-3 py-2 text-right font-medium">Importe</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {milestones.map((m: MilestoneDto) => {
                  const vencido =
                    m.status === 'previsto' && m.dueDate < todayIso();
                  return (
                    <tr
                      key={m.id}
                      className="border-b border-gray-100 last:border-0 hover:bg-amber-50/40"
                    >
                      <td className="px-3 py-2.5">
                        <span
                          className={
                            vencido ? 'font-semibold text-red-600' : undefined
                          }
                        >
                          {formatDate(m.dueDate)}
                        </span>
                        {vencido && (
                          <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">
                            Vencido
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-medium">
                        {m.invoiceNumber}
                      </td>
                      <td className="px-3 py-2.5">{m.contactName}</td>
                      <td className="px-3 py-2.5 text-gray-600">
                        {m.kind === 'retencion'
                          ? MILESTONE_KIND_LABELS.retencion
                          : m.direction === 'cobro'
                            ? 'Cobro'
                            : 'Pago'}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-medium tabular-nums ${
                          m.direction === 'cobro'
                            ? 'text-emerald-600'
                            : 'text-red-500'
                        }`}
                      >
                        {m.direction === 'cobro' ? '+' : '−'}
                        {formatEur(m.amount)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {m.status === 'previsto' ? (
                          <button
                            onClick={() => payMutation.mutate(m.id)}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50"
                          >
                            <IconCheck size={13} />
                            Liquidar
                          </button>
                        ) : (
                          <button
                            onClick={() => reopenMutation.mutate(m.id)}
                            className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100"
                          >
                            Reabrir
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
