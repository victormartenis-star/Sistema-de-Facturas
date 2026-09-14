'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  COMPARATIVO_STATUS_LABELS,
  type ComparativoDto,
  type ComparativoStatus,
} from '@erp/shared';
import { ApiError, comparativosApi, phasesApi, projectsApi } from '@/lib/api';
import { useToast } from '@/components/toast';
import { IconTrendingUp } from '@/components/icons';
import {
  EmptyState,
  ErrorBanner,
  Modal,
  PageHeader,
  TableSkeleton,
  btnPrimaryCls,
  fieldCls,
  labelCls,
  selectCls,
} from '@/components/ui';

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

const STATUS_TONE: Record<ComparativoStatus, string> = {
  abierto: 'bg-sky-100 text-sky-700',
  adjudicado: 'bg-emerald-100 text-emerald-700',
  cancelado: 'bg-gray-200 text-gray-600',
};

function StatusBadge({ status }: { status: ComparativoStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[status]}`}
    >
      {COMPARATIVO_STATUS_LABELS[status]}
    </span>
  );
}

/** Alta de un comparativo: obra → fase (la matriz sale de las partidas de esa fase). */
function NewComparativoModal({
  open,
  saving,
  error,
  onSave,
  onClose,
}: {
  open: boolean;
  saving: boolean;
  error: Error | null;
  onSave: (v: { projectId: string; phaseId: string; title: string }) => void;
  onClose: () => void;
}) {
  const [projectId, setProjectId] = useState('');
  const [phaseId, setPhaseId] = useState('');
  const [title, setTitle] = useState('');

  useEffect(() => {
    if (!open) return;
    setProjectId('');
    setPhaseId('');
    setTitle('');
  }, [open]);

  const projectsQuery = useQuery({
    queryKey: ['projects', '', ''],
    queryFn: () => projectsApi.list('', ''),
    staleTime: 5 * 60_000,
    enabled: open,
  });
  const phasesQuery = useQuery({
    queryKey: ['phases', projectId],
    queryFn: () => phasesApi.list(projectId),
    enabled: open && projectId !== '',
  });

  const fieldErrors = error instanceof ApiError ? error.fieldErrors : [];
  const errorFor = (field: string) =>
    fieldErrors.find((e) => e.field === field)?.message;

  return (
    <Modal open={open} title="Nuevo comparativo" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ projectId, phaseId, title });
        }}
        className="space-y-4"
      >
        <div>
          <label className={labelCls} htmlFor="cmp-project">
            Obra *
          </label>
          <select
            id="cmp-project"
            className={selectCls}
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setPhaseId('');
            }}
            required
          >
            <option value="">Selecciona una obra…</option>
            {projectsQuery.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="cmp-phase">
            Fase / capítulo *
          </label>
          <select
            id="cmp-phase"
            className={selectCls}
            value={phaseId}
            onChange={(e) => setPhaseId(e.target.value)}
            required
            disabled={!projectId}
          >
            <option value="">
              {projectId ? 'Selecciona una fase…' : 'Elige antes una obra'}
            </option>
            {phasesQuery.data?.map((ph) => (
              <option key={ph.id} value={ph.id}>
                {ph.code} · {ph.name}
              </option>
            ))}
          </select>
          {errorFor('phaseId') && (
            <p className="mt-1 text-xs text-red-600">{errorFor('phaseId')}</p>
          )}
        </div>
        <div>
          <label className={labelCls} htmlFor="cmp-title">
            Título *
          </label>
          <input
            id="cmp-title"
            className={fieldCls}
            placeholder="Comparativo instalación eléctrica"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          {errorFor('title') && (
            <p className="mt-1 text-xs text-red-600">{errorFor('title')}</p>
          )}
        </div>

        {error && fieldErrors.length === 0 && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error.message}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            Cancelar
          </button>
          <button type="submit" disabled={saving} className={btnPrimaryCls}>
            {saving ? 'Creando…' : 'Crear comparativo'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function ComparativosPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [projectFilter, setProjectFilter] = useState('');
  const [formOpen, setFormOpen] = useState(false);

  const projectsQuery = useQuery({
    queryKey: ['projects', '', ''],
    queryFn: () => projectsApi.list('', ''),
    staleTime: 5 * 60_000,
  });

  const query = useQuery({
    queryKey: ['comparativos', projectFilter],
    queryFn: () => comparativosApi.list(projectFilter || undefined),
  });

  const createMutation = useMutation({
    mutationFn: (input: {
      projectId: string;
      phaseId: string;
      title: string;
    }) => comparativosApi.create(input),
    onSuccess: () => {
      toast('Comparativo creado');
      setFormOpen(false);
      qc.invalidateQueries({ queryKey: ['comparativos'] });
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const comparativos = query.data ?? [];

  return (
    <div>
      <PageHeader
        title="Comparativos"
        subtitle="Cuadros comparativos de ofertas y adjudicación de subcontratas"
        count={comparativos.length}
      >
        <select
          className={selectCls}
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
        >
          <option value="">Todas las obras</option>
          {projectsQuery.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </select>
        <button className={btnPrimaryCls} onClick={() => setFormOpen(true)}>
          Nuevo comparativo
        </button>
      </PageHeader>

      {query.isError && <ErrorBanner message={errText(query.error)} />}
      {query.isLoading && <TableSkeleton />}

      {query.isSuccess && comparativos.length === 0 && (
        <EmptyState
          icon={<IconTrendingUp size={26} />}
          title={
            projectFilter
              ? 'Esta obra todavía no tiene comparativos'
              : 'Todavía no hay comparativos'
          }
        >
          <p className="mx-auto max-w-md text-sm text-gray-500">
            Un comparativo enfrenta las ofertas de varios proveedores partida a
            partida, para una fase de la obra.
          </p>
        </EmptyState>
      )}

      {comparativos.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60 text-left text-xs tracking-wide text-gray-500 uppercase">
                <th className="px-4 py-3 font-medium">Título</th>
                <th className="px-4 py-3 font-medium">Fase</th>
                <th className="px-4 py-3 text-right font-medium">Ofertas</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {comparativos.map((c: ComparativoDto) => (
                <tr
                  key={c.id}
                  className="border-b border-gray-100 transition-colors last:border-0 hover:bg-amber-50/40"
                >
                  <td className="px-4 py-3 font-medium">{c.title}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {c.phaseCode} · {c.phaseName}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {c.ofertaCount}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/comparativos/${c.id}`}
                      className="text-xs font-medium text-amber-600 hover:text-amber-800"
                    >
                      Ver matriz →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewComparativoModal
        open={formOpen}
        saving={createMutation.isPending}
        error={(createMutation.error as ApiError | null) ?? null}
        onSave={(v) => createMutation.mutate(v)}
        onClose={() => setFormOpen(false)}
      />
    </div>
  );
}
