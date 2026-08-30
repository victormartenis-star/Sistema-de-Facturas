'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { ChecklistRowDto } from '@erp/shared';
import { checklistApi, formatDate, projectsApi } from '@/lib/api';
import { hasCapability } from '@/lib/session';
import {
  IconAlertTriangle,
  IconCheck,
  IconLock,
  IconSparkles,
} from '@/components/icons';
import { useToast } from '@/components/toast';
import {
  ErrorBanner,
  PageHeader,
  TableSkeleton,
  selectCls,
} from '@/components/ui';

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

export default function AperturaPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [projectId, setProjectId] = useState('');
  const puedeMarcar = hasCapability('obras.gestionar');

  const projectsQuery = useQuery({
    queryKey: ['projects', '', ''],
    queryFn: () => projectsApi.list('', ''),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!projectId && projectsQuery.data?.length) {
      setProjectId(projectsQuery.data[0].id);
    }
  }, [projectId, projectsQuery.data]);

  const query = useQuery({
    queryKey: ['apertura', projectId],
    queryFn: () => checklistApi.get(projectId),
    enabled: Boolean(projectId),
  });

  const mark = useMutation({
    mutationFn: ({ row, done }: { row: ChecklistRowDto; done: boolean }) =>
      checklistApi.mark(projectId, { key: row.key, done }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['apertura'] });
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const c = query.data;
  const pct = c ? Math.round((c.doneCount / c.totalCount) * 100) : 0;

  return (
    <div>
      <PageHeader
        title="Apertura de obra"
        subtitle="Toda obra nueva nace con contrato, presupuesto, objetivo, planificación y responsables"
      >
        <select
          className={selectCls}
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          {projectsQuery.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </select>
      </PageHeader>

      {query.isError && <ErrorBanner message={errText(query.error)} />}
      {query.isLoading && <TableSkeleton rows={6} />}

      {c && (
        <>
          {/* Estado de arranque */}
          <div
            className={`mb-6 rounded-2xl border p-5 ${
              c.canStart
                ? 'border-emerald-200 bg-emerald-50'
                : 'border-red-200 bg-red-50'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p
                  className={`flex items-center gap-2 text-sm font-semibold ${
                    c.canStart ? 'text-emerald-900' : 'text-red-900'
                  }`}
                >
                  {c.canStart ? (
                    <IconCheck size={16} />
                  ) : (
                    <IconAlertTriangle size={16} />
                  )}
                  {c.canStart
                    ? 'La obra cumple los requisitos de apertura'
                    : `Faltan ${c.pendingBlockers.length} requisito(s) para poder arrancar`}
                </p>
                {!c.canStart && (
                  <p className="mt-1 text-sm text-red-800">
                    {c.pendingBlockers.map((b) => b.label).join(' · ')}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold tabular-nums">
                  {c.doneCount}
                  <span className="text-base font-normal text-gray-500">
                    /{c.totalCount}
                  </span>
                </p>
                <div className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-white/70">
                  <div
                    className={`h-full ${c.canStart ? 'bg-emerald-500' : 'bg-red-400'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {c.warnings.length > 0 && (
            <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <ul className="space-y-1.5">
                {c.warnings.map((w) => (
                  <li key={w} className="text-sm text-amber-800">
                    · {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            {c.rows.map((r) => {
              const bloqueado = r.blockedBy.length > 0 && !r.done;
              return (
                <div
                  key={r.key}
                  className={`flex items-start gap-3 border-b border-gray-100 px-4 py-3.5 last:border-0 ${
                    r.done ? 'bg-emerald-50/30' : ''
                  }`}
                >
                  {/* Casilla: solo se toca en los puntos manuales */}
                  <span className="mt-0.5 shrink-0">
                    {r.auto ? (
                      <span
                        title="Lo comprueba el sistema"
                        className={`flex h-5 w-5 items-center justify-center rounded ${
                          r.done
                            ? 'bg-emerald-500 text-white'
                            : 'bg-gray-100 text-gray-400'
                        }`}
                      >
                        <IconSparkles size={12} />
                      </span>
                    ) : (
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4"
                        checked={r.done}
                        disabled={!puedeMarcar || bloqueado || mark.isPending}
                        onChange={(e) =>
                          mark.mutate({ row: r, done: e.target.checked })
                        }
                      />
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {r.label}
                      {r.blocksStart && !r.done && (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                          BLOQUEA INICIO
                        </span>
                      )}
                      {bloqueado && (
                        <span className="flex items-center gap-1 text-[10px] font-semibold text-gray-500">
                          <IconLock size={11} />
                          ORDEN
                        </span>
                      )}
                    </p>

                    {r.detail && (
                      <p
                        className={`mt-0.5 text-xs ${
                          r.done ? 'text-emerald-700' : 'text-amber-700'
                        }`}
                      >
                        {r.detail}
                      </p>
                    )}
                    {bloqueado && (
                      <p className="mt-0.5 text-xs text-gray-500">
                        Antes hace falta:{' '}
                        {r.blockedBy
                          .map(
                            (k) => c.rows.find((x) => x.key === k)?.label ?? k,
                          )
                          .join(', ')}
                        . El orden no se puede invertir.
                      </p>
                    )}
                    {r.why && !r.detail && !bloqueado && (
                      <p className="mt-0.5 text-xs text-gray-500">{r.why}</p>
                    )}
                  </div>

                  <div className="shrink-0 text-right text-[11px] text-gray-500">
                    <p>{r.responsible}</p>
                    {r.doneAt && (
                      <p className="text-emerald-700">
                        {formatDate(r.doneAt)}
                        {r.markedBy && ` · ${r.markedBy}`}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-4 text-xs text-gray-500">
            Los puntos con <IconSparkles size={11} className="inline" /> los
            comprueba el sistema con sus propios datos y no se marcan a mano: se
            cumplen registrando el dato que falta. El resto ocurre fuera del ERP
            —una firma, un registro presentado— y alguien tiene que confirmarlo.
          </p>
        </>
      )}
    </div>
  );
}
