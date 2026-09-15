'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  CHANGE_ORDER_ESTADO_LABELS,
  CHANGE_ORDER_TIPO_LABELS,
  type ChangeOrderDto,
  type ChangeOrderEstado,
  type ChangeOrderLineaInput,
  type ChangeOrderTipo,
} from '@erp/shared';
import {
  budgetsApi,
  changeOrdersApi,
  contactsApi,
  formatEur,
  projectsApi,
} from '@/lib/api';
import { useToast } from '@/components/toast';
import { IconClipboard, IconPlus, IconTrash } from '@/components/icons';
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

const ESTADO_STYLES: Record<ChangeOrderEstado, string> = {
  borrador: 'bg-gray-100 text-gray-600',
  enviado_df: 'bg-amber-100 text-amber-700',
  aprobado: 'bg-emerald-100 text-emerald-700',
  rechazado: 'bg-red-100 text-red-700',
};

export default function ContradictoriosPage() {
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const projectsQuery = useQuery({
    queryKey: ['projects-for-change-orders'],
    queryFn: () => projectsApi.list('', ''),
  });
  const listQuery = useQuery({
    queryKey: ['change-orders', projectId],
    queryFn: () => changeOrdersApi.list({ projectId: projectId || undefined }),
  });
  const selectedQuery = useQuery({
    queryKey: ['change-order', selectedId],
    queryFn: () => changeOrdersApi.get(selectedId!),
    enabled: !!selectedId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['change-orders'] });
    if (selectedId)
      queryClient.invalidateQueries({ queryKey: ['change-order', selectedId] });
  };

  return (
    <div>
      <PageHeader
        title="Contradictorios y Modificados"
        subtitle="Precios contradictorios y modificados de obra, con aprobación de la Dirección Facultativa"
      >
        <select
          className={selectCls}
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">Todas las obras</option>
          {projectsQuery.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} — {p.name}
            </option>
          ))}
        </select>
        <button
          className={btnPrimaryCls}
          disabled={!projectId}
          title={!projectId ? 'Elige primero una obra' : undefined}
          onClick={() => setNewOpen(true)}
        >
          <IconPlus size={14} /> Nuevo
        </button>
      </PageHeader>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_1fr]">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          {listQuery.isLoading && <TableSkeleton rows={4} />}
          {listQuery.error && (
            <ErrorBanner message={errText(listQuery.error)} />
          )}
          <div className="space-y-1">
            {listQuery.data?.map((co) => (
              <button
                key={co.id}
                onClick={() => setSelectedId(co.id)}
                className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${
                  selectedId === co.id
                    ? 'bg-amber-50 text-amber-700'
                    : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{co.numero}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ESTADO_STYLES[co.estado]}`}
                  >
                    {CHANGE_ORDER_ESTADO_LABELS[co.estado]}
                  </span>
                </div>
                <p className="truncate text-xs text-gray-400">{co.titulo}</p>
                <p className="text-xs text-gray-400">
                  {formatEur(co.importeEstimado)}
                </p>
              </button>
            ))}
            {listQuery.data?.length === 0 && (
              <p className="px-2 py-4 text-sm text-gray-400">Sin registros.</p>
            )}
          </div>
        </div>

        <div>
          {!selectedId && (
            <EmptyState
              icon={<IconClipboard size={24} />}
              title="Elige un registro"
            >
              Selecciona un contradictorio o modificado de la lista para ver su
              detalle y resolverlo.
            </EmptyState>
          )}
          {selectedId && selectedQuery.data && (
            <ChangeOrderDetail
              changeOrder={selectedQuery.data}
              onDone={invalidate}
            />
          )}
        </div>
      </div>

      <NewChangeOrderModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        projectId={projectId}
        onCreated={(id) => {
          setSelectedId(id);
          invalidate();
        }}
      />
    </div>
  );
}

function ChangeOrderDetail({
  changeOrder,
  onDone,
}: {
  changeOrder: ChangeOrderDto;
  onDone: () => void;
}) {
  const toast = useToast();
  const [enviarOpen, setEnviarOpen] = useState(false);
  const [resolverOpen, setResolverOpen] = useState(false);

  const cancelMutation = useMutation({
    mutationFn: () => changeOrdersApi.remove(changeOrder.id),
    onSuccess: () => {
      toast('Eliminado', 'success');
      onDone();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">{changeOrder.numero}</h2>
            <p className="text-sm text-gray-500">{changeOrder.titulo}</p>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${ESTADO_STYLES[changeOrder.estado]}`}
          >
            {CHANGE_ORDER_ESTADO_LABELS[changeOrder.estado]}
          </span>
        </div>
        <p className="mb-3 text-sm text-gray-600">{changeOrder.descripcion}</p>
        {changeOrder.motivo && (
          <p className="mb-3 text-xs text-gray-400">
            Motivo: {changeOrder.motivo}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="Tipo"
            value={CHANGE_ORDER_TIPO_LABELS[changeOrder.tipo]}
          />
          <Stat
            label="Importe estimado"
            value={formatEur(changeOrder.importeEstimado)}
          />
          <Stat
            label="Importe aprobado"
            value={
              changeOrder.importeAprobado !== null
                ? formatEur(changeOrder.importeAprobado)
                : '—'
            }
          />
          <Stat
            label="Dirección Facultativa"
            value={changeOrder.direccionFacultativaNombre ?? '—'}
          />
        </div>

        {changeOrder.comentarioResolucion && (
          <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
            Resolución: {changeOrder.comentarioResolucion}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {changeOrder.estado === 'borrador' && (
            <>
              <button
                className={btnPrimaryCls}
                onClick={() => setEnviarOpen(true)}
              >
                Enviar a Dirección Facultativa
              </button>
              <button
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                onClick={() => cancelMutation.mutate()}
              >
                <IconTrash size={13} className="mr-1 inline" /> Eliminar
              </button>
            </>
          )}
          {changeOrder.estado === 'enviado_df' && (
            <button
              className={btnPrimaryCls}
              onClick={() => setResolverOpen(true)}
            >
              Registrar resolución de la DF
            </button>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold">Líneas</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400">
              <th className="pb-2">Descripción</th>
              <th className="pb-2 text-right">Cantidad</th>
              <th className="pb-2 text-right">Precio</th>
              <th className="pb-2 text-right">Importe</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {changeOrder.lineas.map((l) => (
              <tr key={l.id}>
                <td className="py-1.5">{l.descripcion}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {l.cantidad} {l.unidad}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {formatEur(l.precioUnitario)}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {formatEur(l.importe)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <EnviarModal
        open={enviarOpen}
        onClose={() => setEnviarOpen(false)}
        changeOrderId={changeOrder.id}
        onDone={onDone}
      />
      <ResolverModal
        open={resolverOpen}
        onClose={() => setResolverOpen(false)}
        changeOrderId={changeOrder.id}
        importeEstimado={changeOrder.importeEstimado}
        onDone={onDone}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function EnviarModal({
  open,
  onClose,
  changeOrderId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  changeOrderId: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const [contactId, setContactId] = useState('');
  const contactsQuery = useQuery({
    queryKey: ['contacts-for-df'],
    queryFn: () => contactsApi.list('', ''),
    enabled: open,
  });
  const mutation = useMutation({
    mutationFn: () =>
      changeOrdersApi.enviar(changeOrderId, {
        direccionFacultativaContactId: contactId,
      }),
    onSuccess: () => {
      toast('Enviado a la Dirección Facultativa', 'success');
      onDone();
      onClose();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Enviar a Dirección Facultativa">
      <div className="space-y-3">
        <div className={fieldCls}>
          <label className={labelCls}>Contacto de Dirección Facultativa</label>
          <select
            className={selectCls}
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
          >
            <option value="">Selecciona…</option>
            {contactsQuery.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.legalName}
              </option>
            ))}
          </select>
        </div>
        <button
          className={`${btnPrimaryCls} w-full justify-center`}
          disabled={!contactId || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Enviar
        </button>
      </div>
    </Modal>
  );
}

function ResolverModal({
  open,
  onClose,
  changeOrderId,
  importeEstimado,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  changeOrderId: string;
  importeEstimado: number;
  onDone: () => void;
}) {
  const toast = useToast();
  const [estado, setEstado] = useState<'aprobado' | 'rechazado'>('aprobado');
  const [importeAprobado, setImporteAprobado] = useState(
    String(importeEstimado),
  );
  const [comentario, setComentario] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      changeOrdersApi.resolver(changeOrderId, {
        estado,
        importeAprobado:
          estado === 'aprobado' ? Number(importeAprobado) || 0 : null,
        comentarioResolucion: comentario || null,
      }),
    onSuccess: () => {
      toast('Resolución registrada', 'success');
      onDone();
      onClose();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Resolución de la Dirección Facultativa"
    >
      <div className="space-y-3">
        <div className={fieldCls}>
          <label className={labelCls}>Resolución</label>
          <div className="flex gap-2">
            <button
              className={`flex-1 rounded-lg py-2 text-sm font-medium ${
                estado === 'aprobado'
                  ? 'bg-emerald-500 text-white'
                  : 'bg-gray-100 text-gray-600'
              }`}
              onClick={() => setEstado('aprobado')}
            >
              Aprobar
            </button>
            <button
              className={`flex-1 rounded-lg py-2 text-sm font-medium ${
                estado === 'rechazado'
                  ? 'bg-red-500 text-white'
                  : 'bg-gray-100 text-gray-600'
              }`}
              onClick={() => setEstado('rechazado')}
            >
              Rechazar
            </button>
          </div>
        </div>
        {estado === 'aprobado' && (
          <div className={fieldCls}>
            <label className={labelCls}>Importe aprobado</label>
            <input
              type="number"
              step="0.01"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={importeAprobado}
              onChange={(e) => setImporteAprobado(e.target.value)}
            />
          </div>
        )}
        <div className={fieldCls}>
          <label className={labelCls}>Comentario (opcional)</label>
          <textarea
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            rows={2}
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
          />
        </div>
        <button
          className={`${btnPrimaryCls} w-full justify-center`}
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Registrar resolución
        </button>
      </div>
    </Modal>
  );
}

function NewChangeOrderModal({
  open,
  onClose,
  projectId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const [tipo, setTipo] = useState<ChangeOrderTipo>('contradictorio');
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [motivo, setMotivo] = useState('');
  const [lineas, setLineas] = useState<ChangeOrderLineaInput[]>([]);

  const budgetItemsQuery = useQuery({
    queryKey: ['budget-items-for-change-order', projectId],
    queryFn: async () => {
      const budgets = await budgetsApi.listByProject(projectId);
      const active = budgets.find((b) => b.status === 'activo') ?? budgets[0];
      if (!active) return [];
      return (await budgetsApi.getDetail(active.id)).items;
    },
    enabled: open && !!projectId,
  });

  const mutation = useMutation({
    mutationFn: () =>
      changeOrdersApi.create({
        projectId,
        tipo,
        titulo: titulo.trim(),
        descripcion: descripcion.trim(),
        motivo: motivo || null,
        lineas,
      }),
    onSuccess: (co) => {
      toast('Registro creado', 'success');
      onCreated(co.id);
      onClose();
      setTitulo('');
      setDescripcion('');
      setMotivo('');
      setLineas([]);
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  function addLinea() {
    setLineas((prev) => [
      ...prev,
      { descripcion: '', unidad: 'ud', cantidad: 1, precioUnitario: 0 },
    ]);
  }
  function updateLinea(i: number, patch: Partial<ChangeOrderLineaInput>) {
    setLineas((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    );
  }
  function removeLinea(i: number) {
    setLineas((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nuevo contradictorio / modificado"
      wide
    >
      <div className="space-y-3">
        <div className={fieldCls}>
          <label className={labelCls}>Tipo</label>
          <select
            className={selectCls}
            value={tipo}
            onChange={(e) => setTipo(e.target.value as ChangeOrderTipo)}
          >
            {Object.entries(CHANGE_ORDER_TIPO_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className={fieldCls}>
          <label className={labelCls}>Título</label>
          <input
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
          />
        </div>
        <div className={fieldCls}>
          <label className={labelCls}>Descripción</label>
          <textarea
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            rows={2}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
          />
        </div>
        <div className={fieldCls}>
          <label className={labelCls}>Motivo (opcional)</label>
          <input
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className={labelCls}>Líneas</label>
            <button
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-amber-600 hover:bg-amber-50"
              onClick={addLinea}
            >
              <IconPlus size={12} /> Añadir línea
            </button>
          </div>
          <div className="space-y-2">
            {lineas.map((l, i) => (
              <div key={i} className="grid grid-cols-12 items-center gap-2">
                <select
                  className="col-span-3 rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
                  value={l.budgetItemId ?? ''}
                  onChange={(e) =>
                    updateLinea(i, { budgetItemId: e.target.value || null })
                  }
                >
                  <option value="">Partida nueva</option>
                  {budgetItemsQuery.data?.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code}
                    </option>
                  ))}
                </select>
                <input
                  className="col-span-4 rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
                  placeholder="Descripción"
                  value={l.descripcion}
                  onChange={(e) =>
                    updateLinea(i, { descripcion: e.target.value })
                  }
                />
                <input
                  className="col-span-1 rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
                  placeholder="Ud"
                  value={l.unidad}
                  onChange={(e) => updateLinea(i, { unidad: e.target.value })}
                />
                <input
                  type="number"
                  className="col-span-2 rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
                  placeholder="Cantidad"
                  value={l.cantidad}
                  onChange={(e) =>
                    updateLinea(i, { cantidad: Number(e.target.value) })
                  }
                />
                <input
                  type="number"
                  className="col-span-1 rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
                  placeholder="Precio"
                  value={l.precioUnitario}
                  onChange={(e) =>
                    updateLinea(i, { precioUnitario: Number(e.target.value) })
                  }
                />
                <button
                  className="col-span-1 text-gray-400 hover:text-red-600"
                  onClick={() => removeLinea(i)}
                >
                  <IconTrash size={14} />
                </button>
              </div>
            ))}
            {lineas.length === 0 && (
              <p className="text-xs text-gray-400">Sin líneas todavía.</p>
            )}
          </div>
        </div>

        <button
          className={`${btnPrimaryCls} w-full justify-center`}
          disabled={!titulo.trim() || !descripcion.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Crear
        </button>
      </div>
    </Modal>
  );
}
