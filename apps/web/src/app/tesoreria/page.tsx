'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { MILESTONE_KIND_LABELS, type MilestoneDto } from '@erp/shared';
import { formatDate, formatEur, treasuryApi } from '@/lib/api';
import { useToast } from '@/components/toast';
import { IconCheck } from '@/components/icons';
import { ErrorBanner, PageHeader, fieldCls, selectCls } from '@/components/ui';

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Tesorería a trece semanas: el horizonte en el que un problema de caja
 * todavía se puede resolver. Sin saldo de partida no se pinta ningún saldo,
 * porque una previsión que arranca en cero no dice si se llega a fin de mes.
 */
function TreceSemanas() {
  const [saldoTexto, setSaldoTexto] = useState('');
  const saldo = saldoTexto.trim() === '' ? null : Number(saldoTexto);
  const saldoValido = saldo === null || Number.isFinite(saldo);

  const query = useQuery({
    queryKey: ['13-semanas', saldoValido ? saldo : null],
    queryFn: () => treasuryApi.thirteenWeek(saldoValido ? saldo : null),
  });

  const r = query.data;
  const maxMov = r
    ? Math.max(1, ...r.weeks.map((w) => Math.max(w.cobros, w.pagos)))
    : 1;

  return (
    <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Tesorería a 13 semanas</h2>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500" htmlFor="saldo-inicial">
            Saldo de caja hoy
          </label>
          <input
            id="saldo-inicial"
            className={`${fieldCls} w-40 text-right tabular-nums`}
            inputMode="decimal"
            placeholder="p. ej. 420000"
            value={saldoTexto}
            onChange={(e) => setSaldoTexto(e.target.value)}
          />
        </div>
      </div>
      <p className="mb-4 text-xs text-gray-500">
        Es el plazo en el que un problema de caja todavía se puede resolver.
        Incluye lo ya facturado y, aparte, lo que va a pasar casi seguro pero no
        tiene factura: certificaciones sin facturar y albaranes sin factura.
      </p>

      {query.isError && <ErrorBanner message={errText(query.error)} />}

      {r && (
        <>
          {r.warnings.length > 0 && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <ul className="space-y-1.5">
                {r.warnings.map((w) => (
                  <li key={w} className="text-xs text-amber-800">
                    · {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
                Cobros
              </p>
              <p className="mt-1 text-lg font-bold text-emerald-600 tabular-nums">
                {formatEur(r.totalCobros)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
                Pagos
              </p>
              <p className="mt-1 text-lg font-bold text-red-500 tabular-nums">
                {formatEur(r.totalPagos)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
                Saldo a 13 semanas
              </p>
              <p className="mt-1 text-lg font-bold tabular-nums">
                {r.closingBalance === null ? (
                  <span className="text-sm font-normal text-gray-500">
                    Falta el saldo de hoy
                  </span>
                ) : (
                  <span className={r.closingBalance < 0 ? 'text-red-600' : ''}>
                    {formatEur(r.closingBalance)}
                  </span>
                )}
              </p>
            </div>
            {/* El punto más bajo casi nunca es el último: es el que decide si
                se llega, y mirando solo el saldo final no se ve. */}
            <div>
              <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
                Punto más bajo
              </p>
              <p className="mt-1 text-lg font-bold tabular-nums">
                {r.minBalance === null ? (
                  <span className="text-sm font-normal text-gray-500">—</span>
                ) : (
                  <>
                    <span className={r.minBalance < 0 ? 'text-red-600' : ''}>
                      {formatEur(r.minBalance)}
                    </span>
                    <span className="block text-xs font-medium text-gray-500">
                      {formatDate(r.minBalanceWeek ?? '')}
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs tracking-wide text-gray-500 uppercase">
                  <th className="px-3 py-2 font-medium">Semana</th>
                  <th className="px-3 py-2 text-right font-medium">Cobros</th>
                  <th className="px-3 py-2 text-right font-medium">Pagos</th>
                  <th className="px-3 py-2 text-right font-medium">Neto</th>
                  <th className="w-40 px-3 py-2 font-medium">Movimiento</th>
                  <th className="px-3 py-2 text-right font-medium">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {r.weeks.map((w) => (
                  <tr
                    key={w.weekStart}
                    className={`border-b border-gray-100 last:border-0 ${
                      w.tension ? 'bg-red-50/60' : ''
                    }`}
                  >
                    <td className="px-3 py-2 font-medium whitespace-nowrap">
                      {w.label}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {w.cobros === 0 ? (
                        <span className="text-gray-300">—</span>
                      ) : (
                        <>
                          <span className="text-emerald-700">
                            {formatEur(w.cobros)}
                          </span>
                          {w.cobrosPrevistos > 0 && (
                            <span className="block text-[11px] text-gray-400">
                              {formatEur(w.cobrosPrevistos)} sin facturar
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {w.pagos === 0 ? (
                        <span className="text-gray-300">—</span>
                      ) : (
                        <>
                          <span className="text-red-600">
                            {formatEur(w.pagos)}
                          </span>
                          {w.pagosPrevistos > 0 && (
                            <span className="block text-[11px] text-gray-400">
                              {formatEur(w.pagosPrevistos)} sin facturar
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        w.neto < 0 ? 'text-red-600' : ''
                      }`}
                    >
                      {w.neto === 0 ? (
                        <span className="text-gray-300">—</span>
                      ) : (
                        formatEur(w.neto)
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex h-4 items-center gap-px">
                        <div className="flex flex-1 justify-end">
                          <div
                            className="h-2 rounded-l bg-emerald-400"
                            style={{
                              width: `${Math.round((w.cobros / maxMov) * 100)}%`,
                            }}
                          />
                        </div>
                        <div className="flex flex-1">
                          <div
                            className="h-2 rounded-r bg-red-400"
                            style={{
                              width: `${Math.round((w.pagos / maxMov) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-semibold tabular-nums ${
                        w.saldo === null
                          ? 'text-gray-300'
                          : w.saldo < 0
                            ? 'text-red-600'
                            : ''
                      }`}
                    >
                      {w.saldo === null ? '—' : formatEur(w.saldo)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

export default function TesoreriaPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [direction, setDirection] = useState('');
  const [milestoneStatus, setMilestoneStatus] = useState('previsto');

  const milestonesQuery = useQuery({
    queryKey: ['milestones', direction, milestoneStatus],
    queryFn: () =>
      treasuryApi.milestones({
        direction: direction || undefined,
        status: milestoneStatus || undefined,
      }),
  });

  const invalidate = () => {
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

  const milestones = milestonesQuery.data ?? [];
  const overdue = milestones.filter(
    (m) => m.status === 'previsto' && m.dueDate < todayIso(),
  );

  return (
    <div className="animate-fade-in-up">
      <PageHeader
        title="Tesorería"
        subtitle="Previsión de caja a 13 semanas y calendario de vencimientos"
      />

      <TreceSemanas />

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
