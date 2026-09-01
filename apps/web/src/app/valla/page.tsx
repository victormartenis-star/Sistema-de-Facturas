'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { WORKER_DOC_TYPE_LABELS, type WorkerDto } from '@erp/shared';
import { formatDate, projectsApi, workersApi } from '@/lib/api';
import {
  IconAlertTriangle,
  IconCheck,
  IconUsers,
  IconX,
} from '@/components/icons';
import {
  EmptyState,
  ErrorBanner,
  PageHeader,
  TableSkeleton,
  btnGhostCls,
  selectCls,
} from '@/components/ui';

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

/** Una ficha de la lista, pensada para leerse de un vistazo en la puerta. */
function WorkerRow({ w, allowed }: { w: WorkerDto; allowed: boolean }) {
  return (
    <div
      className={`flex items-start gap-3 border-b border-gray-100 px-4 py-3 last:border-0 ${
        allowed ? '' : 'bg-red-50/40'
      }`}
    >
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          allowed ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'
        }`}
      >
        {allowed ? <IconCheck size={14} /> : <IconX size={14} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          {w.fullName}
          {w.docId && (
            <span className="ml-2 font-mono text-xs font-normal text-gray-500">
              {w.docId}
            </span>
          )}
        </p>
        <p className="text-xs text-gray-500">
          {w.contactName}
          {w.jobTitle && ` · ${w.jobTitle}`}
        </p>
        {w.reasons.map((r) => (
          <p
            key={r}
            className={`mt-1 text-xs ${allowed ? 'text-amber-700' : 'text-red-700'}`}
          >
            {r}
          </p>
        ))}
      </div>
      {w.daysToNextExpiry !== null && (
        <span className="shrink-0 text-right text-[11px] text-gray-500">
          Próxima caducidad
          <span className="block font-medium">{w.daysToNextExpiry} días</span>
        </span>
      )}
    </div>
  );
}

export default function VallaPage() {
  const [projectId, setProjectId] = useState('');

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
    queryKey: ['valla', projectId],
    queryFn: () => workersApi.gateList(projectId),
    enabled: Boolean(projectId),
  });

  const g = query.data;

  return (
    <div>
      <PageHeader
        title="Listado de acceso a obra"
        subtitle="Quién puede pisar la obra hoy. Sin documentación validada no hay acceso"
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
        <button className={btnGhostCls} onClick={() => window.print()}>
          Imprimir
        </button>
      </PageHeader>

      {query.isError && <ErrorBanner message={errText(query.error)} />}
      {query.isLoading && <TableSkeleton rows={5} />}

      {g && (
        <>
          <p className="mb-4 text-xs text-gray-500">
            {g.projectCode} · {g.projectName} · generado el{' '}
            {formatDate(g.generatedAt)}
          </p>

          {g.warnings.length > 0 && (
            <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900">
                <IconAlertTriangle size={16} />
                Atención
              </p>
              <ul className="space-y-1.5">
                {g.warnings.map((w) => (
                  <li key={w} className="text-sm text-amber-800">
                    · {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {g.allowed.length + g.denied.length === 0 ? (
            <EmptyState
              icon={<IconUsers size={26} />}
              title="Nadie dado de alta en esta obra"
            >
              <p className="mx-auto max-w-md text-sm text-gray-500">
                Los trabajadores de subcontrata se dan de alta desde
                Homologación. Sin listado no se puede controlar el acceso.
              </p>
            </EmptyState>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm">
                <p className="border-b border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
                  Pueden acceder ({g.allowed.length})
                </p>
                {g.allowed.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-gray-500">
                    Nadie
                  </p>
                ) : (
                  g.allowed.map((w) => <WorkerRow key={w.id} w={w} allowed />)
                )}
              </section>

              {/*
                Los denegados se imprimen a propósito: un listado que solo trae
                a los buenos no sirve para negar el acceso a nadie, porque
                quien falta puede ser tanto un vetado como alguien a quien
                nadie dio de alta.
              */}
              <section className="overflow-hidden rounded-2xl border border-red-200 bg-white shadow-sm">
                <p className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
                  No pueden acceder ({g.denied.length})
                </p>
                {g.denied.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-gray-500">
                    Nadie
                  </p>
                ) : (
                  g.denied.map((w) => (
                    <WorkerRow key={w.id} w={w} allowed={false} />
                  ))
                )}
              </section>
            </div>
          )}

          <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-4">
            <p className="text-xs font-semibold text-gray-700">
              Documentación exigible a cada trabajador antes del acceso
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {Object.values(WORKER_DOC_TYPE_LABELS).slice(0, 5).join(' · ')}
            </p>
            <p className="mt-3 text-xs text-gray-500">
              La validación documental es de Compras, pero quien decide quién
              entra es el encargado. Si el control no llega a la valla, no sirve
              de nada.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
