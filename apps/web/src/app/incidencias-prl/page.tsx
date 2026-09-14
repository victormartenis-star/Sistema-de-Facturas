'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  INCIDENCIA_PRL_ESTADO_LABELS,
  INCIDENCIA_PRL_GRAVEDADES,
  INCIDENCIA_PRL_GRAVEDAD_LABELS,
  type IncidenciaPRLCreateInput,
  type IncidenciaPRLEstado,
  type IncidenciaPRLGravedad,
  type IncidenciaPRLUpdateInput,
} from '@erp/shared';
import {
  ApiError,
  formatDate,
  incidenciasPRLApi,
  projectsApi,
} from '@/lib/api';
import { useToast } from '@/components/toast';
import { IconAlertTriangle } from '@/components/icons';
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

const GRAVEDAD_TONE: Record<IncidenciaPRLGravedad, string> = {
  leve: 'bg-sky-100 text-sky-700',
  grave: 'bg-amber-100 text-amber-700',
  muy_grave: 'bg-red-100 text-red-700',
};

const ESTADO_TONE: Record<IncidenciaPRLEstado, string> = {
  abierta: 'bg-red-50 text-red-600 border-red-200',
  en_subsanacion: 'bg-amber-50 text-amber-700 border-amber-200',
  cerrada: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

/** Alta rápida: los campos imprescindibles caben en una fila, para no frenar la inspección. */
function AltaRapidaForm({
  onSave,
  saving,
  error,
}: {
  onSave: (v: IncidenciaPRLCreateInput) => void;
  saving: boolean;
  error: Error | null;
}) {
  const [projectId, setProjectId] = useState('');
  const [puntoInspeccion, setPuntoInspeccion] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [gravedad, setGravedad] =
    useState<IncidenciaPRLCreateInput['gravedad']>('leve');
  const [fechaLimiteSubsanacion, setFechaLimiteSubsanacion] = useState('');

  const projectsQuery = useQuery({
    queryKey: ['projects', '', ''],
    queryFn: () => projectsApi.list('', ''),
    staleTime: 5 * 60_000,
  });

  const fieldErrors = error instanceof ApiError ? error.fieldErrors : [];

  return (
    <form
      className="mb-6 space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          projectId,
          fecha: new Date().toISOString().slice(0, 10),
          puntoInspeccion,
          descripcion,
          gravedad,
          fechaLimiteSubsanacion: fechaLimiteSubsanacion || undefined,
        });
        setPuntoInspeccion('');
        setDescripcion('');
        setGravedad('leve');
        setFechaLimiteSubsanacion('');
      }}
    >
      <p className="text-sm font-semibold text-gray-700">
        Alta rápida de inspección
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
        <div className="sm:col-span-1">
          <label className={labelCls}>Obra *</label>
          <select
            className={selectCls}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            required
          >
            <option value="">Obra…</option>
            {projectsQuery.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-1">
          <label className={labelCls}>Punto de inspección *</label>
          <input
            className={fieldCls}
            placeholder="Andamios planta 3…"
            value={puntoInspeccion}
            onChange={(e) => setPuntoInspeccion(e.target.value)}
            required
          />
        </div>
        <div className="sm:col-span-1">
          <label className={labelCls}>Gravedad</label>
          <select
            className={selectCls}
            value={gravedad}
            onChange={(e) =>
              setGravedad(e.target.value as IncidenciaPRLGravedad)
            }
          >
            {INCIDENCIA_PRL_GRAVEDADES.map((g) => (
              <option key={g} value={g}>
                {INCIDENCIA_PRL_GRAVEDAD_LABELS[g]}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-1">
          <label className={labelCls}>Plazo de subsanación</label>
          <input
            type="date"
            className={fieldCls}
            value={fechaLimiteSubsanacion}
            onChange={(e) => setFechaLimiteSubsanacion(e.target.value)}
          />
        </div>
        <div className="flex items-end sm:col-span-1">
          <button
            type="submit"
            disabled={saving}
            className={btnPrimaryCls + ' w-full justify-center'}
          >
            {saving ? 'Guardando…' : 'Registrar'}
          </button>
        </div>
      </div>
      <div>
        <label className={labelCls}>Descripción *</label>
        <textarea
          rows={2}
          className={fieldCls}
          placeholder="Qué se ha observado…"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          required
        />
      </div>
      {error && fieldErrors.length === 0 && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error.message}
        </p>
      )}
    </form>
  );
}

export default function IncidenciasPRLPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [projectFilter, setProjectFilter] = useState('');
  const [estadoFilter, setEstadoFilter] = useState<IncidenciaPRLEstado | ''>(
    '',
  );

  const projectsQuery = useQuery({
    queryKey: ['projects', '', ''],
    queryFn: () => projectsApi.list('', ''),
    staleTime: 5 * 60_000,
  });

  const query = useQuery({
    queryKey: ['incidencias-prl', projectFilter, estadoFilter],
    queryFn: () =>
      incidenciasPRLApi.list(
        projectFilter || undefined,
        estadoFilter || undefined,
      ),
  });

  const createMutation = useMutation({
    mutationFn: (input: IncidenciaPRLCreateInput) =>
      incidenciasPRLApi.create(input),
    onSuccess: () => {
      toast('Incidencia registrada');
      qc.invalidateQueries({ queryKey: ['incidencias-prl'] });
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: IncidenciaPRLUpdateInput;
    }) => incidenciasPRLApi.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['incidencias-prl'] }),
    onError: (e) => toast(errText(e), 'error'),
  });

  const incidencias = query.data ?? [];

  return (
    <div>
      <PageHeader
        title="Incidencias y control de seguridad PRL"
        subtitle="Alta rápida de inspecciones de obra y seguimiento de subsanaciones"
        count={incidencias.length}
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
        <select
          className={selectCls}
          value={estadoFilter}
          onChange={(e) =>
            setEstadoFilter(e.target.value as IncidenciaPRLEstado | '')
          }
        >
          <option value="">Todos los estados</option>
          <option value="abierta">Abiertas</option>
          <option value="en_subsanacion">En subsanación</option>
          <option value="cerrada">Cerradas</option>
        </select>
      </PageHeader>

      <AltaRapidaForm
        onSave={(v) => createMutation.mutate(v)}
        saving={createMutation.isPending}
        error={(createMutation.error as ApiError | null) ?? null}
      />

      {query.isError && <ErrorBanner message={errText(query.error)} />}
      {query.isLoading && <TableSkeleton />}

      {query.isSuccess && incidencias.length === 0 && (
        <EmptyState
          icon={<IconAlertTriangle size={26} />}
          title="Sin incidencias registradas"
        >
          <p className="mx-auto max-w-md text-sm text-gray-500">
            Usa el alta rápida de arriba para registrar la primera inspección.
          </p>
        </EmptyState>
      )}

      {incidencias.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60 text-left text-xs tracking-wide text-gray-500 uppercase">
                <th className="px-4 py-3 font-medium">Fecha</th>
                <th className="px-4 py-3 font-medium">Punto de inspección</th>
                <th className="px-4 py-3 font-medium">Gravedad</th>
                <th className="px-4 py-3 font-medium">Plazo</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {incidencias.map((i) => (
                <tr
                  key={i.id}
                  className="border-b border-gray-100 last:border-0 hover:bg-amber-50/40"
                >
                  <td className="px-4 py-3 text-gray-600">
                    {formatDate(i.fecha)}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{i.puntoInspeccion}</p>
                    <p className="text-xs text-gray-400">{i.descripcion}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${GRAVEDAD_TONE[i.gravedad]}`}
                    >
                      {INCIDENCIA_PRL_GRAVEDAD_LABELS[i.gravedad]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {i.fechaLimiteSubsanacion ? (
                      <span
                        className={
                          i.fueraDePlazo ? 'font-medium text-red-600' : ''
                        }
                      >
                        {formatDate(i.fechaLimiteSubsanacion)}
                        {i.fueraDePlazo && ' · fuera de plazo'}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${ESTADO_TONE[i.estado]}`}
                    >
                      {INCIDENCIA_PRL_ESTADO_LABELS[i.estado]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {i.estado !== 'cerrada' && (
                      <div className="flex justify-end gap-2">
                        {i.estado === 'abierta' && (
                          <button
                            className={btnGhostCls + ' text-xs'}
                            onClick={() =>
                              updateMutation.mutate({
                                id: i.id,
                                input: { estado: 'en_subsanacion' },
                              })
                            }
                          >
                            En subsanación
                          </button>
                        )}
                        <button
                          className={btnGhostCls + ' text-xs text-emerald-600'}
                          onClick={() =>
                            updateMutation.mutate({
                              id: i.id,
                              input: { estado: 'cerrada' },
                            })
                          }
                        >
                          Cerrar
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
