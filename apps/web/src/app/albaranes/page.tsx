'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  DELIVERY_NOTE_STATUSES,
  DELIVERY_NOTE_STATUS_LABELS,
  type DeliveryNoteCreateInput,
  type DeliveryNoteDto,
  type DeliveryNoteStatus,
} from '@erp/shared';
import {
  ApiError,
  contactsApi,
  deliveryNotesApi,
  formatDate,
  formatEur,
  projectsApi,
} from '@/lib/api';
import { useDebouncedValue } from '@/lib/hooks';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import {
  IconCheck,
  IconInbox,
  IconPencil,
  IconPlus,
  IconTrash,
} from '@/components/icons';
import {
  EmptyState,
  ErrorBanner,
  Modal,
  PageHeader,
  SearchInput,
  TableSkeleton,
  btnPrimaryCls,
  fieldCls,
  labelCls,
  selectCls,
} from '@/components/ui';

const STATUS_STYLES: Record<DeliveryNoteStatus, string> = {
  pendiente: 'bg-amber-100 text-amber-700',
  validado: 'bg-sky-100 text-sky-700',
  facturado: 'bg-emerald-100 text-emerald-700',
};

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

function NoteFormModal({
  open,
  note,
  saving,
  error,
  onSave,
  onClose,
}: {
  open: boolean;
  note: DeliveryNoteDto | null;
  saving: boolean;
  error: Error | null;
  onSave: (v: DeliveryNoteCreateInput) => void;
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
        {error && (
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
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [status, setStatus] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DeliveryNoteDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeliveryNoteDto | null>(
    null,
  );

  const query = useQuery({
    queryKey: ['delivery-notes', debouncedSearch, status],
    queryFn: () =>
      deliveryNotesApi.list({
        search: debouncedSearch,
        status: (status || undefined) as DeliveryNoteStatus | undefined,
      }),
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['delivery-notes'] });

  const saveMutation = useMutation({
    mutationFn: (v: DeliveryNoteCreateInput) =>
      editing
        ? deliveryNotesApi.update(editing.id, v)
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

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deliveryNotesApi.remove(id),
    onSuccess: () => {
      toast('Albarán eliminado');
      invalidate();
      setDeleteTarget(null);
    },
    onError: (e) => {
      toast(errText(e), 'error');
      setDeleteTarget(null);
    },
  });

  const notes = query.data ?? [];

  return (
    <div className="animate-fade-in-up">
      <PageHeader
        title="Albaranes y partes"
        count={notes.length}
        subtitle="Circuito: pendiente → validado por jefe de obra → facturado"
      >
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar por número o proveedor…"
        />
        <select
          className={selectCls}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Todos los estados</option>
          {DELIVERY_NOTE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {DELIVERY_NOTE_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            setEditing(null);
            saveMutation.reset();
            setModalOpen(true);
          }}
          className={btnPrimaryCls}
        >
          <IconPlus size={15} />
          Nuevo albarán
        </button>
      </PageHeader>

      {query.isLoading && <TableSkeleton />}
      {query.isError && <ErrorBanner message={errText(query.error)} />}

      {query.isSuccess && notes.length === 0 && (
        <EmptyState
          icon={<IconInbox size={26} />}
          title={
            search || status
              ? 'Ningún albarán coincide con el filtro'
              : 'Todavía no hay albaranes ni partes de trabajo'
          }
        />
      )}

      {notes.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60 text-left text-xs tracking-wide text-gray-500 uppercase">
                <th className="px-4 py-3 font-medium">Número</th>
                <th className="px-4 py-3 font-medium">Proveedor</th>
                <th className="px-4 py-3 font-medium">Obra</th>
                <th className="px-4 py-3 font-medium">Fecha</th>
                <th className="px-4 py-3 text-right font-medium">Importe</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {notes.map((n) => (
                <tr
                  key={n.id}
                  className="border-b border-gray-100 transition-colors last:border-0 hover:bg-amber-50/40"
                >
                  <td className="px-4 py-3 font-medium">
                    {n.noteNumber}
                    {n.description && (
                      <span
                        className="block max-w-52 truncate text-xs font-normal text-gray-500"
                        title={n.description}
                      >
                        {n.description}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{n.contactName}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">
                    {n.projectCode ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {formatDate(n.noteDate)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">
                    {formatEur(n.amount)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[n.status]}`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                      {DELIVERY_NOTE_STATUS_LABELS[n.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                      {n.status === 'pendiente' && (
                        <button
                          onClick={() => validateMutation.mutate(n.id)}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-sky-600 hover:bg-sky-50"
                        >
                          <IconCheck size={13} />
                          Validar
                        </button>
                      )}
                      {n.status !== 'facturado' && (
                        <>
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
                          <button
                            onClick={() => setDeleteTarget(n)}
                            title="Eliminar"
                            className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <IconTrash size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NoteFormModal
        open={modalOpen}
        note={editing}
        saving={saveMutation.isPending}
        error={(saveMutation.error as ApiError | null) ?? null}
        onSave={(v) => saveMutation.mutate(v)}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title={`¿Eliminar el albarán "${deleteTarget?.noteNumber ?? ''}"?`}
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
