'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PERMISO_STATUSES,
  PERMISO_STATUS_LABELS,
  PERMISO_TIPOS,
  PERMISO_TIPO_LABELS,
  type PermisoCreateInput,
  type PermisoPublicoDto,
  type PermisoStatus,
} from '@erp/shared';
import { ApiError, formatDate, permisosApi, projectsApi } from '@/lib/api';
import { useToast } from '@/components/toast';
import { IconAlertTriangle, IconFileText } from '@/components/icons';
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

const STATUS_TONE: Record<PermisoStatus, string> = {
  solicitado: 'bg-gray-100 text-gray-600 border-gray-200',
  en_tramite: 'bg-sky-100 text-sky-700 border-sky-200',
  concedido: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  denegado: 'bg-red-100 text-red-700 border-red-200',
};

function AlertBadge({ permiso }: { permiso: PermisoPublicoDto }) {
  if (!permiso.alertLevel) return null;
  const vencido = permiso.alertLevel === 'vencido';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        vencido ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
      }`}
    >
      <IconAlertTriangle size={11} />
      {vencido ? 'Vencido' : 'Vence pronto'}
    </span>
  );
}

function PermisoCard({ permiso }: { permiso: PermisoPublicoDto }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="mb-1 flex items-start justify-between gap-2">
        <span className="text-xs font-semibold text-gray-500">
          {PERMISO_TIPO_LABELS[permiso.tipo]}
        </span>
        <AlertBadge permiso={permiso} />
      </div>
      <p className="text-sm font-medium text-gray-900">
        {permiso.organismoPublico}
      </p>
      {permiso.numeroExpediente && (
        <p className="text-xs text-gray-400">Exp. {permiso.numeroExpediente}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
        <span>Solicitud: {formatDate(permiso.fechaSolicitud)}</span>
        {permiso.fechaVencimiento && (
          <span>Vence: {formatDate(permiso.fechaVencimiento)}</span>
        )}
        {permiso.canonImporte !== null && (
          <span>Tasa: {permiso.canonImporte.toFixed(2)} €</span>
        )}
      </div>
    </div>
  );
}

function NewPermisoModal({
  open,
  saving,
  error,
  onSave,
  onClose,
}: {
  open: boolean;
  saving: boolean;
  error: Error | null;
  onSave: (v: PermisoCreateInput) => void;
  onClose: () => void;
}) {
  const [projectId, setProjectId] = useState('');
  const [tipo, setTipo] = useState<PermisoCreateInput['tipo']>('licencia_obra');
  const [organismoPublico, setOrganismoPublico] = useState('');
  const [numeroExpediente, setNumeroExpediente] = useState('');
  const [fechaSolicitud, setFechaSolicitud] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [fechaVencimiento, setFechaVencimiento] = useState('');
  const [canonImporte, setCanonImporte] = useState('');

  useEffect(() => {
    if (!open) return;
    setProjectId('');
    setTipo('licencia_obra');
    setOrganismoPublico('');
    setNumeroExpediente('');
    setFechaSolicitud(new Date().toISOString().slice(0, 10));
    setFechaVencimiento('');
    setCanonImporte('');
  }, [open]);

  const projectsQuery = useQuery({
    queryKey: ['projects', '', ''],
    queryFn: () => projectsApi.list('', ''),
    staleTime: 5 * 60_000,
    enabled: open,
  });

  const fieldErrors = error instanceof ApiError ? error.fieldErrors : [];
  const errorFor = (field: string) =>
    fieldErrors.find((e) => e.field === field)?.message;

  return (
    <Modal open={open} title="Nuevo trámite" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            projectId,
            tipo,
            organismoPublico,
            numeroExpediente: numeroExpediente || undefined,
            fechaSolicitud,
            fechaVencimiento: fechaVencimiento || undefined,
            canonImporte: canonImporte ? Number(canonImporte) : undefined,
          });
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
          <label className={labelCls}>Tipo de trámite *</label>
          <select
            className={selectCls}
            value={tipo}
            onChange={(e) =>
              setTipo(e.target.value as PermisoCreateInput['tipo'])
            }
          >
            {PERMISO_TIPOS.map((t) => (
              <option key={t} value={t}>
                {PERMISO_TIPO_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Organismo público *</label>
          <input
            className={fieldCls}
            placeholder="Ayuntamiento de..."
            value={organismoPublico}
            onChange={(e) => setOrganismoPublico(e.target.value)}
            required
          />
          {errorFor('organismoPublico') && (
            <p className="mt-1 text-xs text-red-600">
              {errorFor('organismoPublico')}
            </p>
          )}
        </div>
        <div>
          <label className={labelCls}>Nº de expediente</label>
          <input
            className={fieldCls}
            value={numeroExpediente}
            onChange={(e) => setNumeroExpediente(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Fecha de solicitud *</label>
            <input
              type="date"
              className={fieldCls}
              value={fechaSolicitud}
              onChange={(e) => setFechaSolicitud(e.target.value)}
              required
            />
          </div>
          <div>
            <label className={labelCls}>Fecha de vencimiento</label>
            <input
              type="date"
              className={fieldCls}
              value={fechaVencimiento}
              onChange={(e) => setFechaVencimiento(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className={labelCls}>Canon / tasa (€)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            className={fieldCls}
            value={canonImporte}
            onChange={(e) => setCanonImporte(e.target.value)}
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
            {saving ? 'Creando…' : 'Crear trámite'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function PermisosPage() {
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
    queryKey: ['permisos', projectFilter],
    queryFn: () => permisosApi.list(projectFilter || undefined),
  });

  const alertasQuery = useQuery({
    queryKey: ['permisos-alertas', projectFilter],
    queryFn: () => permisosApi.alertas(projectFilter || undefined),
  });

  const createMutation = useMutation({
    mutationFn: (input: PermisoCreateInput) => permisosApi.create(input),
    onSuccess: () => {
      toast('Trámite creado');
      setFormOpen(false);
      qc.invalidateQueries({ queryKey: ['permisos'] });
      qc.invalidateQueries({ queryKey: ['permisos-alertas'] });
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const permisos = query.data ?? [];
  const alertas = alertasQuery.data ?? [];

  return (
    <div>
      <PageHeader
        title="Permisos públicos y licencias"
        subtitle="Licencias de obra, vados, ocupación de vía pública y gestión de residuos"
        count={permisos.length}
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
          Nuevo trámite
        </button>
      </PageHeader>

      {alertas.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="mb-1 flex items-center gap-1.5 font-medium">
            <IconAlertTriangle size={14} />
            {alertas.length} permiso{alertas.length !== 1 ? 's' : ''} vencido
            {alertas.length !== 1 ? 's' : ''} o próximo
            {alertas.length !== 1 ? 's' : ''} a caducar
          </p>
          <ul className="list-disc space-y-0.5 pl-5">
            {alertas.slice(0, 5).map((a) => (
              <li key={a.id}>
                {PERMISO_TIPO_LABELS[a.tipo]} · {a.organismoPublico} —{' '}
                {a.daysToExpiry < 0
                  ? `venció hace ${Math.abs(a.daysToExpiry)} días`
                  : `vence en ${a.daysToExpiry} días`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {query.isError && <ErrorBanner message={errText(query.error)} />}
      {query.isLoading && <TableSkeleton />}

      {query.isSuccess && permisos.length === 0 && (
        <EmptyState
          icon={<IconFileText size={26} />}
          title="Todavía no hay trámites registrados"
        >
          <p className="mx-auto max-w-md text-sm text-gray-500">
            Da de alta una licencia de obra, vado, ocupación de vía pública o
            gestión de residuos para empezar a hacerle seguimiento.
          </p>
        </EmptyState>
      )}

      {permisos.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PERMISO_STATUSES.map((status) => {
            const columna = permisos.filter((p) => p.status === status);
            return (
              <div key={status} className="min-w-0">
                <div
                  className={`mb-2 rounded-lg border px-3 py-1.5 text-xs font-semibold ${STATUS_TONE[status]}`}
                >
                  {PERMISO_STATUS_LABELS[status]}{' '}
                  <span className="opacity-70">({columna.length})</span>
                </div>
                <div className="space-y-2">
                  {columna.map((p) => (
                    <PermisoCard key={p.id} permiso={p} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <NewPermisoModal
        open={formOpen}
        saving={createMutation.isPending}
        error={(createMutation.error as ApiError | null) ?? null}
        onSave={(v) => createMutation.mutate(v)}
        onClose={() => setFormOpen(false)}
      />
    </div>
  );
}
