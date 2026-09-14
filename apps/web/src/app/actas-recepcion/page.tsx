'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ACTA_RECEPCION_ESTADO_LABELS,
  ACTA_RECEPCION_TIPOS,
  ACTA_RECEPCION_TIPO_LABELS,
  type ActaRecepcionCreateInput,
  type ActaRecepcionEstado,
  type RepasoCreateInput,
} from '@erp/shared';
import {
  ApiError,
  actasRecepcionApi,
  formatDate,
  projectsApi,
} from '@/lib/api';
import { useToast } from '@/components/toast';
import { IconCheck, IconChevronDown } from '@/components/icons';
import {
  EmptyState,
  ErrorBanner,
  Modal,
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

const ESTADO_TONE: Record<ActaRecepcionEstado, string> = {
  pendiente_firma: 'bg-amber-100 text-amber-700',
  firmada_sin_reservas: 'bg-emerald-100 text-emerald-700',
  firmada_con_reservas: 'bg-orange-100 text-orange-700',
};

function NewActaModal({
  open,
  saving,
  error,
  onSave,
  onClose,
}: {
  open: boolean;
  saving: boolean;
  error: Error | null;
  onSave: (v: ActaRecepcionCreateInput) => void;
  onClose: () => void;
}) {
  const [projectId, setProjectId] = useState('');
  const [tipo, setTipo] =
    useState<ActaRecepcionCreateInput['tipo']>('provisional');
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));

  useEffect(() => {
    if (!open) return;
    setProjectId('');
    setTipo('provisional');
    setFecha(new Date().toISOString().slice(0, 10));
  }, [open]);

  const projectsQuery = useQuery({
    queryKey: ['projects', '', ''],
    queryFn: () => projectsApi.list('', ''),
    staleTime: 5 * 60_000,
    enabled: open,
  });

  const fieldErrors = error instanceof ApiError ? error.fieldErrors : [];

  return (
    <Modal open={open} title="Nueva acta de recepción" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ projectId, tipo, fecha });
        }}
        className="space-y-4"
      >
        <div>
          <label className={labelCls}>Obra *</label>
          <select
            className={selectCls}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
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
          <label className={labelCls}>Tipo de recepción *</label>
          <select
            className={selectCls}
            value={tipo}
            onChange={(e) =>
              setTipo(e.target.value as ActaRecepcionCreateInput['tipo'])
            }
          >
            {ACTA_RECEPCION_TIPOS.map((t) => (
              <option key={t} value={t}>
                {ACTA_RECEPCION_TIPO_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Fecha *</label>
          <input
            type="date"
            className={fieldCls}
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            required
          />
        </div>

        {error && fieldErrors.length === 0 && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error.message}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className={btnGhostCls}>
            Cancelar
          </button>
          <button type="submit" disabled={saving} className={btnPrimaryCls}>
            {saving ? 'Creando…' : 'Crear acta'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RepasosPanel({ actaId }: { actaId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [descripcion, setDescripcion] = useState('');

  const repasosQuery = useQuery({
    queryKey: ['acta-repasos', actaId],
    queryFn: () => actasRecepcionApi.listRepasos(actaId),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['acta-repasos', actaId] });
    qc.invalidateQueries({ queryKey: ['actas-recepcion'] });
  };

  const addMutation = useMutation({
    mutationFn: (input: RepasoCreateInput) =>
      actasRecepcionApi.addRepaso(actaId, input),
    onSuccess: () => {
      setDescripcion('');
      invalidate();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, subsanado }: { id: string; subsanado: boolean }) =>
      actasRecepcionApi.updateRepaso(id, {
        estado: subsanado ? 'subsanado' : 'pendiente',
        fechaSubsanacion: subsanado
          ? new Date().toISOString().slice(0, 10)
          : null,
      }),
    onSuccess: invalidate,
    onError: (e) => toast(errText(e), 'error'),
  });

  const firmarMutation = useMutation({
    mutationFn: () => actasRecepcionApi.firmar(actaId),
    onSuccess: (dto) => {
      toast(
        dto.estado === 'firmada_sin_reservas'
          ? 'Acta firmada sin reservas'
          : 'Acta firmada con reservas: quedan repasos pendientes',
      );
      invalidate();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const repasos = repasosQuery.data ?? [];
  const pendientes = repasos.filter((r) => r.estado === 'pendiente').length;

  return (
    <div className="space-y-3 border-t border-gray-100 bg-gray-50/60 p-4">
      {repasosQuery.isLoading && (
        <p className="text-xs text-gray-400">Cargando repasos…</p>
      )}
      <ul className="space-y-1.5">
        {repasos.map((r) => (
          <li key={r.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={r.estado === 'subsanado'}
              onChange={(e) =>
                toggleMutation.mutate({ id: r.id, subsanado: e.target.checked })
              }
              className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
            />
            <span
              className={
                r.estado === 'subsanado'
                  ? 'text-gray-400 line-through'
                  : 'text-gray-800'
              }
            >
              {r.descripcion}
            </span>
            {r.responsable && (
              <span className="text-xs text-gray-400">({r.responsable})</span>
            )}
            {r.fechaLimite && (
              <span className="text-xs text-gray-400">
                límite {formatDate(r.fechaLimite)}
              </span>
            )}
          </li>
        ))}
        {repasos.length === 0 && !repasosQuery.isLoading && (
          <li className="text-xs text-gray-400">
            Sin repasos: recepción limpia.
          </li>
        )}
      </ul>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!descripcion.trim()) return;
          addMutation.mutate({ descripcion });
        }}
      >
        <input
          className={fieldCls + ' flex-1'}
          placeholder="Añadir repaso (defecto a subsanar)…"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
        />
        <button
          type="submit"
          className={btnGhostCls}
          disabled={addMutation.isPending}
        >
          Añadir
        </button>
      </form>

      <div className="flex items-center justify-between pt-1">
        <p className="text-xs text-gray-500">
          {pendientes === 0
            ? 'Todos los repasos están subsanados.'
            : `${pendientes} repaso${pendientes !== 1 ? 's' : ''} pendiente${pendientes !== 1 ? 's' : ''}.`}
        </p>
        <button
          className={btnPrimaryCls}
          disabled={firmarMutation.isPending}
          onClick={() => firmarMutation.mutate()}
        >
          <IconCheck size={14} />
          Firmar acta
        </button>
      </div>
    </div>
  );
}

export default function ActasRecepcionPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [projectFilter, setProjectFilter] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const projectsQuery = useQuery({
    queryKey: ['projects', '', ''],
    queryFn: () => projectsApi.list('', ''),
    staleTime: 5 * 60_000,
  });

  const query = useQuery({
    queryKey: ['actas-recepcion', projectFilter],
    queryFn: () => actasRecepcionApi.list(projectFilter || undefined),
  });

  const createMutation = useMutation({
    mutationFn: (input: ActaRecepcionCreateInput) =>
      actasRecepcionApi.create(input),
    onSuccess: () => {
      toast('Acta creada');
      setFormOpen(false);
      qc.invalidateQueries({ queryKey: ['actas-recepcion'] });
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const actas = query.data ?? [];

  return (
    <div>
      <PageHeader
        title="Actas de recepción"
        subtitle="Recepciones provisionales y definitivas, con su lista de repasos"
        count={actas.length}
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
          Nueva acta
        </button>
      </PageHeader>

      {query.isError && <ErrorBanner message={errText(query.error)} />}
      {query.isLoading && <TableSkeleton />}

      {query.isSuccess && actas.length === 0 && (
        <EmptyState
          icon={<IconCheck size={26} />}
          title="Todavía no hay actas de recepción"
        >
          <p className="mx-auto max-w-md text-sm text-gray-500">
            Crea un acta provisional o definitiva y añade su lista de repasos.
          </p>
        </EmptyState>
      )}

      {actas.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {actas.map((a) => {
            const expanded = expandedId === a.id;
            return (
              <div
                key={a.id}
                className="border-b border-gray-100 last:border-0"
              >
                <button
                  className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-amber-50/40"
                  onClick={() => setExpandedId(expanded ? null : a.id)}
                >
                  <span className="text-sm font-medium">
                    {ACTA_RECEPCION_TIPO_LABELS[a.tipo]}
                  </span>
                  <span className="text-sm text-gray-500">
                    {formatDate(a.fecha)}
                  </span>
                  <span
                    className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${ESTADO_TONE[a.estado]}`}
                  >
                    {ACTA_RECEPCION_ESTADO_LABELS[a.estado]}
                  </span>
                  <IconChevronDown
                    size={14}
                    className={`text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
                  />
                </button>
                {expanded && <RepasosPanel actaId={a.id} />}
              </div>
            );
          })}
        </div>
      )}

      <NewActaModal
        open={formOpen}
        saving={createMutation.isPending}
        error={(createMutation.error as ApiError | null) ?? null}
        onSave={(v) => createMutation.mutate(v)}
        onClose={() => setFormOpen(false)}
      />
    </div>
  );
}
