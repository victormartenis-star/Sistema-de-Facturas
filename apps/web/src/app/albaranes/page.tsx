'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  DELIVERY_NOTE_STATUSES,
  DELIVERY_NOTE_STATUS_LABELS,
  canDeleteDeliveryNote,
  canReturnDeliveryNote,
  type DeliveryNoteCreateInput,
  type DeliveryNoteDto,
  type DeliveryNoteStatus,
} from '@erp/shared';
import {
  ApiError,
  contactsApi,
  deliveryNotesApi,
  exportsApi,
  formatDate,
  formatEur,
  projectsApi,
} from '@/lib/api';
import { useListadoPaginado } from '@/lib/use-listado-paginado';
import { usePermisos } from '@/lib/permisos';
import { esConflictoVersion } from '@/lib/api-error';
import { AvisoConflicto } from '@/components/aviso-conflicto';
import { textoDeError } from '@/lib/errores';
import {
  BarraFiltros,
  DataTable,
  type ColumnaDef,
  FiltroEstado,
  FiltroObra,
} from '@/components/data-table';
import { Autorizado } from '@/components/autorizado';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ReasonDialog } from '@/components/reason-dialog';
import { useAvisarError, useToast } from '@/components/toast';
import {
  IconCheck,
  IconInbox,
  IconPencil,
  IconPlus,
  IconTrash,
} from '@/components/icons';
import {
  Modal,
  PageHeader,
  SearchInput,
  btnGhostCls,
  btnPrimaryCls,
  fieldCls,
  labelCls,
} from '@/components/ui';

const STATUS_STYLES: Record<DeliveryNoteStatus, string> = {
  pendiente: 'bg-amber-100 text-amber-700',
  validado: 'bg-sky-100 text-sky-700',
  facturado: 'bg-emerald-100 text-emerald-700',
};

const errText = textoDeError;

function NoteFormModal({
  open,
  note,
  saving,
  error,
  onSave,
  onReload,
  onClose,
}: {
  open: boolean;
  note: DeliveryNoteDto | null;
  saving: boolean;
  error: Error | null;
  onSave: (v: DeliveryNoteCreateInput) => void;
  onReload?: () => Promise<unknown> | void;
  onClose: () => void;
}) {
  const [contactId, setContactId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [number, setNumber] = useState('');
  const [noteDate, setNoteDate] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  const contactsQuery = useQuery({
    queryKey: ['contacts', '', ''],
    queryFn: () => contactsApi.list('', ''),
    enabled: open,
    staleTime: 60_000,
  });
  const providers = (contactsQuery.data ?? []).filter(
    (c) => c.kind === 'proveedor' || c.kind === 'ambos',
  );
  const projectsQuery = useQuery({
    queryKey: ['projects', '', ''],
    queryFn: () => projectsApi.list('', ''),
    enabled: open,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!open) return;
    setContactId(note?.contactId ?? '');
    setProjectId(note?.projectId ?? '');
    setNumber(note?.noteNumber ?? '');
    setNoteDate(note?.noteDate ?? new Date().toISOString().slice(0, 10));
    setAmount(note?.amount.toString() ?? '');
    setDescription(note?.description ?? '');
  }, [open, note]);

  return (
    <Modal
      open={open}
      title={
        note
          ? `Editar albarán ${note.noteNumber}`
          : 'Nuevo albarán / parte de trabajo'
      }
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            contactId,
            projectId: projectId || null,
            noteNumber: number,
            noteDate,
            description: description || null,
            amount: Number(amount.replace(',', '.')),
          });
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Proveedor *</label>
            <select
              className={fieldCls}
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              required
            >
              <option value="">Selecciona…</option>
              {providers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.legalName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Obra</label>
            <select
              className={fieldCls}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">Sin obra</option>
              {(projectsQuery.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className={labelCls}>Nº albarán *</label>
            <input
              className={fieldCls}
              placeholder="ALB-2026-014"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              required
            />
          </div>
          <div>
            <label className={labelCls}>Fecha *</label>
            <input
              type="date"
              className={fieldCls}
              value={noteDate}
              onChange={(e) => setNoteDate(e.target.value)}
              required
            />
          </div>
          <div>
            <label className={labelCls}>Importe (€, sin IVA) *</label>
            <input
              className={fieldCls}
              inputMode="decimal"
              placeholder="1250"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
        </div>
        <div>
          <label className={labelCls}>Descripción</label>
          <textarea
            rows={2}
            className={fieldCls}
            placeholder="Material entregado, trabajos realizados…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {esConflictoVersion(error) && <AvisoConflicto onReload={onReload} />}
        {error && !esConflictoVersion(error) && (
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
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function AlbaranesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const avisarError = useAvisarError();
  const { can } = usePermisos();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DeliveryNoteDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeliveryNoteDto | null>(
    null,
  );
  const [returnTarget, setReturnTarget] = useState<DeliveryNoteDto | null>(
    null,
  );

  const listado = useListadoPaginado({
    clave: 'delivery-notes',
    filtrosIniciales: { search: '', status: '', projectId: '' },
    camposConRetardo: ['search'],
    consulta: (p) => deliveryNotesApi.listPaginado(p),
  });
  const { filtros, setFiltro } = listado;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['delivery-notes'] });
    qc.invalidateQueries({ queryKey: ['economics'] });
  };

  const saveMutation = useMutation({
    mutationFn: (v: DeliveryNoteCreateInput) =>
      editing
        ? deliveryNotesApi.update(editing.id, v, editing.version)
        : deliveryNotesApi.create(v),
    onSuccess: () => {
      toast(editing ? 'Albarán actualizado' : 'Albarán creado');
      invalidate();
      setModalOpen(false);
      setEditing(null);
    },
  });

  const validateMutation = useMutation({
    mutationFn: (id: string) => deliveryNotesApi.validate(id),
    onSuccess: () => {
      toast('Albarán validado: listo para puntear en una factura');
      invalidate();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const returnMutation = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) =>
      deliveryNotesApi.returnToPending(id, { motivo }),
    onSuccess: () => {
      toast('Albarán devuelto a pendiente: corrígelo y vuelve a validarlo');
      invalidate();
      setReturnTarget(null);
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (n: DeliveryNoteDto) =>
      deliveryNotesApi.remove(n.id, n.version),
    onSuccess: () => {
      toast('Albarán eliminado');
      invalidate();
      setDeleteTarget(null);
    },
    onError: (e) => {
      avisarError(e, invalidate);
      setDeleteTarget(null);
    },
  });

  /** Refresca el albarán en edición (no hay GET por id: se relee el listado). */
  const recargarEditing = async () => {
    if (!editing) return;
    const lista = await deliveryNotesApi.list({});
    const fresco = lista.find((n) => n.id === editing.id);
    saveMutation.reset();
    invalidate();
    if (fresco) setEditing(fresco);
    else {
      setModalOpen(false);
      setEditing(null);
    }
  };

  const abrirNuevo = () => {
    setEditing(null);
    saveMutation.reset();
    setModalOpen(true);
  };

  const columnas: ColumnaDef<DeliveryNoteDto>[] = [
    {
      id: 'numero',
      cabecera: 'Número',
      celda: (n) => (
        <span className="font-medium">
          {n.noteNumber}
          {n.description && (
            <span
              className="block max-w-52 truncate text-xs font-normal text-gray-500"
              title={n.description}
            >
              {n.description}
            </span>
          )}
        </span>
      ),
    },
    { id: 'proveedor', cabecera: 'Proveedor', celda: (n) => n.contactName },
    {
      id: 'obra',
      cabecera: 'Obra',
      ocultaEnMovil: true,
      celda: (n) => (
        <span className="font-mono text-xs text-gray-600">
          {n.projectCode ?? '—'}
        </span>
      ),
    },
    {
      id: 'fecha',
      cabecera: 'Fecha',
      celda: (n) => (
        <span className="text-gray-600">{formatDate(n.noteDate)}</span>
      ),
    },
    {
      id: 'importe',
      cabecera: 'Importe',
      alineacion: 'derecha',
      celda: (n) => <span className="font-medium">{formatEur(n.amount)}</span>,
    },
    {
      id: 'estado',
      cabecera: 'Estado',
      celda: (n) => (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[n.status]}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
          {DELIVERY_NOTE_STATUS_LABELS[n.status]}
        </span>
      ),
    },
  ];

  return (
    <div className="animate-fade-in-up">
      <PageHeader
        title="Albaranes y partes"
        count={listado.total}
        subtitle="Circuito: pendiente → validado por jefe de obra → facturado"
      >
        <SearchInput
          value={filtros.search}
          onChange={(v) => setFiltro('search', v)}
          placeholder="Buscar por número o proveedor…"
        />
        <button
          onClick={() =>
            exportsApi
              .download('albaranes', { status: filtros.status })
              .catch((e) => toast(errText(e), 'error'))
          }
          className={btnGhostCls}
        >
          Exportar CSV
        </button>
        <Autorizado accion="crear" recurso="albaran">
          <button onClick={abrirNuevo} className={btnPrimaryCls}>
            <IconPlus size={15} />
            Nuevo albarán
          </button>
        </Autorizado>
      </PageHeader>

      <BarraFiltros
        hayFiltros={listado.hayFiltros}
        onLimpiar={listado.limpiarFiltros}
      >
        <FiltroObra
          value={filtros.projectId}
          onChange={(v) => setFiltro('projectId', v)}
        />
        <FiltroEstado<DeliveryNoteStatus>
          value={filtros.status as DeliveryNoteStatus | ''}
          onChange={(v) => setFiltro('status', v)}
          estados={DELIVERY_NOTE_STATUSES}
          etiquetas={DELIVERY_NOTE_STATUS_LABELS}
        />
      </BarraFiltros>

      <DataTable
        etiqueta="Albaranes"
        columnas={columnas}
        filas={listado.filas}
        idFila={(n) => n.id}
        cargando={listado.cargando}
        actualizando={listado.actualizando}
        error={listado.error}
        onReintentar={listado.reintentar}
        hayFiltros={listado.hayFiltros}
        paginacion={{
          page: listado.page,
          pageSize: listado.pageSize,
          total: listado.total,
          onPageChange: listado.setPage,
          onPageSizeChange: listado.setPageSize,
        }}
        vacio={{
          icono: <IconInbox size={26} />,
          titulo: 'Todavía no hay albaranes ni partes de trabajo',
        }}
        vacioConFiltros={{
          titulo: 'Ningún albarán coincide con el filtro',
          onLimpiar: listado.limpiarFiltros,
        }}
        acciones={(n) => (
          <>
            {n.status === 'pendiente' && can('cambiarEstado', 'albaran') && (
              <button
                onClick={() => validateMutation.mutate(n.id)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-sky-600 hover:bg-sky-50"
              >
                <IconCheck size={13} />
                Validar
              </button>
            )}
            {canReturnDeliveryNote(n) && can('devolver', 'albaran') && (
              <button
                onClick={() => setReturnTarget(n)}
                title="Devolver a pendiente para corregirlo"
                className="rounded-md px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50"
              >
                Devolver
              </button>
            )}
            {n.status === 'pendiente' && can('editar', 'albaran') && (
              <button
                onClick={() => {
                  setEditing(n);
                  saveMutation.reset();
                  setModalOpen(true);
                }}
                title="Editar"
                className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <IconPencil size={14} />
              </button>
            )}
            {n.status === 'pendiente' &&
              canDeleteDeliveryNote(n) &&
              can('borrar', 'albaran') && (
                <button
                  onClick={() => setDeleteTarget(n)}
                  title="Eliminar"
                  className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                >
                  <IconTrash size={14} />
                </button>
              )}
          </>
        )}
      />

      <NoteFormModal
        open={modalOpen}
        note={editing}
        saving={saveMutation.isPending}
        error={(saveMutation.error as ApiError | null) ?? null}
        onSave={(v) => saveMutation.mutate(v)}
        onReload={editing ? recargarEditing : undefined}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
      />
      <ReasonDialog
        open={returnTarget !== null}
        title={`¿Devolver el albarán "${returnTarget?.noteNumber ?? ''}" a pendiente?`}
        description="Deberá revalidarse (y pasará de nuevo el cuadre con el pedido). Queda registrado en auditoría."
        confirmLabel="Devolver"
        loading={returnMutation.isPending}
        onConfirm={(motivo) =>
          returnTarget && returnMutation.mutate({ id: returnTarget.id, motivo })
        }
        onCancel={() => setReturnTarget(null)}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title={`¿Eliminar el albarán "${deleteTarget?.noteNumber ?? ''}"?`}
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
