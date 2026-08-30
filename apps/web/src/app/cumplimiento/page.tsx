'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  COMPLIANCE_DOC_STATUS_LABELS,
  COMPLIANCE_DOC_TYPES,
  COMPLIANCE_DOC_TYPE_LABELS,
  COMPLIANCE_STATUS_LABELS,
  type ComplianceDocStatus,
  type ComplianceDocType,
  type ComplianceStatus,
  type ComplianceSummaryDto,
} from '@erp/shared';
import { complianceApi, contactsApi, formatDate } from '@/lib/api';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import {
  IconAlertTriangle,
  IconCheck,
  IconLock,
  IconPlus,
  IconTrash,
  IconUsers,
} from '@/components/icons';
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

const STATUS_STYLES: Record<ComplianceStatus, string> = {
  no_aplica: 'bg-gray-100 text-gray-600',
  homologado: 'bg-emerald-100 text-emerald-700',
  con_avisos: 'bg-amber-100 text-amber-700',
  bloqueado: 'bg-red-100 text-red-700',
  bloqueado_manual: 'bg-red-100 text-red-700',
  exento: 'bg-violet-100 text-violet-700',
};

const DOC_STATUS_STYLES: Record<ComplianceDocStatus, string> = {
  vigente: 'text-emerald-600',
  proximo_vencimiento: 'text-amber-600',
  vencido: 'text-red-600',
  no_aportado: 'text-gray-400',
  rechazado: 'text-red-600',
};

function StatusBadge({ status }: { status: ComplianceStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {(status === 'bloqueado' || status === 'bloqueado_manual') && (
        <IconLock size={11} />
      )}
      {COMPLIANCE_STATUS_LABELS[status]}
    </span>
  );
}

export default function CumplimientoPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<ComplianceSummaryDto | null>(null);
  const [docModal, setDocModal] = useState(false);
  const [waiverModal, setWaiverModal] = useState(false);
  const [blockModal, setBlockModal] = useState(false);
  const [removeDocId, setRemoveDocId] = useState<string | null>(null);

  const [docForm, setDocForm] = useState({
    docType: 'seguro_rc' as ComplianceDocType,
    issuedAt: '',
    expiresAt: '',
    notes: '',
  });
  const [waiverForm, setWaiverForm] = useState({ reason: '', validUntil: '' });
  const [blockReason, setBlockReason] = useState('');

  const query = useQuery({
    queryKey: ['cumplimiento', showAll],
    queryFn: () => complianceApi.list(showAll),
  });

  const contactsQuery = useQuery({
    queryKey: ['contacts', '', ''],
    queryFn: () => contactsApi.list('', ''),
    staleTime: 5 * 60_000,
  });

  const refresh = async (contactId?: string) => {
    await qc.invalidateQueries({ queryKey: ['cumplimiento'] });
    if (contactId) {
      setSelected(await complianceApi.summary(contactId));
    }
  };

  const fail = (err: unknown) =>
    toast(err instanceof Error ? err.message : 'No se pudo completar', 'error');

  const requireMutation = useMutation({
    mutationFn: ({ id, required }: { id: string; required: boolean }) =>
      complianceApi.setRequired(id, required),
    onSuccess: (s) => {
      toast(
        s.requiresCompliance
          ? 'Contacto sujeto a homologación'
          : 'Contacto liberado del control documental',
      );
      setSelected(s);
      qc.invalidateQueries({ queryKey: ['cumplimiento'] });
    },
    onError: fail,
  });

  const addDocMutation = useMutation({
    mutationFn: (contactId: string) =>
      complianceApi.addDoc(contactId, {
        docType: docForm.docType,
        issuedAt: docForm.issuedAt || null,
        expiresAt: docForm.expiresAt || null,
        notes: docForm.notes || null,
      }),
    onSuccess: async () => {
      toast('Documento registrado');
      setDocModal(false);
      setDocForm({
        docType: 'seguro_rc',
        issuedAt: '',
        expiresAt: '',
        notes: '',
      });
      await refresh(selected?.contactId);
    },
    onError: fail,
  });

  const removeDocMutation = useMutation({
    mutationFn: (docId: string) => complianceApi.removeDoc(docId),
    onSuccess: async () => {
      toast('Documento eliminado');
      setRemoveDocId(null);
      await refresh(selected?.contactId);
    },
    onError: (e) => {
      fail(e);
      setRemoveDocId(null);
    },
  });

  const blockMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      complianceApi.block(id, reason),
    onSuccess: async (s) => {
      toast('Contacto bloqueado');
      setBlockModal(false);
      setBlockReason('');
      setSelected(s);
      await refresh();
    },
    onError: fail,
  });

  const unblockMutation = useMutation({
    mutationFn: (id: string) => complianceApi.unblock(id),
    onSuccess: async (s) => {
      toast('Bloqueo retirado');
      setSelected(s);
      await refresh();
    },
    onError: fail,
  });

  const waiverMutation = useMutation({
    mutationFn: (contactId: string) =>
      complianceApi.grantWaiver(contactId, waiverForm),
    onSuccess: async () => {
      toast('Exención concedida');
      setWaiverModal(false);
      setWaiverForm({ reason: '', validUntil: '' });
      await refresh(selected?.contactId);
    },
    onError: fail,
  });

  const revokeWaiverMutation = useMutation({
    mutationFn: (contactId: string) => complianceApi.revokeWaiver(contactId),
    onSuccess: async () => {
      toast('Exención revocada');
      await refresh(selected?.contactId);
    },
    onError: fail,
  });

  const items = query.data ?? [];
  const blocked = items.filter((i) => i.blocked).length;
  // Contactos que aún no están sujetos a control, para poder darlos de alta
  const candidates = (contactsQuery.data ?? []).filter(
    (c) => !items.some((i) => i.contactId === c.id),
  );

  return (
    <div className="animate-fade-in-up">
      <PageHeader
        title="Homologación de subcontratas"
        count={items.length}
        subtitle="Documentación de PRL, seguros y Seguridad Social al día"
      >
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-200"
          />
          Ver todos los contactos
        </label>
      </PageHeader>

      {blocked > 0 && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <IconLock size={16} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">
              {blocked}{' '}
              {blocked === 1 ? 'empresa bloqueada' : 'empresas bloqueadas'}
            </p>
            <p className="mt-0.5 text-red-600">
              No se pueden aprobar sus facturas ni liquidar sus pagos hasta que
              aporten la documentación o se conceda una exención justificada.
            </p>
          </div>
        </div>
      )}

      {query.isLoading && <TableSkeleton rows={4} />}
      {query.isError && (
        <ErrorBanner message={(query.error as Error).message} />
      )}

      {query.isSuccess && items.length === 0 && (
        <EmptyState
          icon={<IconUsers size={26} />}
          title="Ninguna empresa sujeta a homologación todavía"
        >
          <p className="text-sm text-gray-500">
            Marca en Contactos las subcontratas que deban aportar documentación
            de PRL, o activa «Ver todos los contactos» para hacerlo desde aquí.
          </p>
        </EmptyState>
      )}

      {items.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <ul className="divide-y divide-gray-100">
              {items.map((item) => (
                <li key={item.contactId}>
                  <button
                    onClick={() => setSelected(item)}
                    className={`w-full px-4 py-3 text-left transition hover:bg-gray-50 ${
                      selected?.contactId === item.contactId
                        ? 'bg-amber-50/70'
                        : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {item.legalName}
                      </span>
                      <span className="ml-auto">
                        <StatusBadge status={item.status} />
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-gray-500">
                      {item.taxId ?? 'sin NIF'}
                      {item.reasons.length > 0 && ` · ${item.reasons[0]}`}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {selected ? (
            <div className="animate-fade-in-up rounded-2xl border border-gray-200 bg-white p-5">
              <div className="mb-4 flex items-start gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-semibold">
                    {selected.legalName}
                  </h2>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {selected.taxId ?? 'sin NIF'}
                  </p>
                </div>
                <span className="ml-auto">
                  <StatusBadge status={selected.status} />
                </span>
              </div>

              {selected.reasons.length > 0 && (
                <ul
                  className={`mb-4 space-y-1.5 rounded-xl border px-4 py-3 text-sm ${
                    selected.blocked
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : 'border-amber-200 bg-amber-50 text-amber-800'
                  }`}
                >
                  {selected.reasons.map((r, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <IconAlertTriangle
                        size={14}
                        className="mt-0.5 shrink-0"
                      />
                      {r}
                    </li>
                  ))}
                </ul>
              )}

              {!selected.requiresCompliance ? (
                <div className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-center">
                  <p className="text-sm text-gray-500">
                    Este contacto no está sujeto a control documental.
                  </p>
                  <button
                    onClick={() =>
                      requireMutation.mutate({
                        id: selected.contactId,
                        required: true,
                      })
                    }
                    className={`${btnPrimaryCls} mt-3`}
                  >
                    Exigir homologación
                  </button>
                </div>
              ) : (
                <>
                  <div className="mb-2 flex items-center">
                    <h3 className="text-xs font-semibold tracking-wide text-gray-500 uppercase">
                      Documentación
                    </h3>
                    <button
                      onClick={() => setDocModal(true)}
                      className={`${btnGhostCls} ml-auto`}
                    >
                      <IconPlus size={14} />
                      Añadir
                    </button>
                  </div>

                  {selected.docs.length === 0 ? (
                    <p className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-500">
                      No ha aportado ningún documento todavía.
                    </p>
                  ) : (
                    <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                      {selected.docs.map((doc) => (
                        <li
                          key={doc.id}
                          className="flex items-center gap-3 px-3 py-2.5 text-sm"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {COMPLIANCE_DOC_TYPE_LABELS[doc.docType]}
                              {doc.blocking && (
                                <span
                                  title="Bloquea la operativa si falta o caduca"
                                  className="ml-1.5 text-[10px] font-semibold text-red-500"
                                >
                                  OBLIGATORIO
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-gray-500">
                              {doc.expiresAt
                                ? `Caduca el ${formatDate(doc.expiresAt)}`
                                : 'Sin caducidad'}
                              {doc.daysToExpiry !== null &&
                                doc.daysToExpiry >= 0 &&
                                ` · faltan ${doc.daysToExpiry} días`}
                            </p>
                          </div>
                          <span
                            className={`ml-auto shrink-0 text-xs font-medium ${DOC_STATUS_STYLES[doc.status]}`}
                          >
                            {COMPLIANCE_DOC_STATUS_LABELS[doc.status]}
                          </span>
                          <button
                            onClick={() => setRemoveDocId(doc.id)}
                            title="Eliminar documento"
                            className="shrink-0 rounded-md p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600"
                          >
                            <IconTrash size={14} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
                    {selected.status === 'bloqueado_manual' ? (
                      <button
                        onClick={() =>
                          unblockMutation.mutate(selected.contactId)
                        }
                        className={btnPrimaryCls}
                      >
                        <IconCheck size={15} />
                        Retirar bloqueo
                      </button>
                    ) : (
                      <button
                        onClick={() => setBlockModal(true)}
                        className={btnGhostCls}
                      >
                        <IconLock size={15} />
                        Bloquear
                      </button>
                    )}

                    {selected.waiver ? (
                      <button
                        onClick={() =>
                          revokeWaiverMutation.mutate(selected.contactId)
                        }
                        className={btnGhostCls}
                      >
                        Revocar exención
                      </button>
                    ) : (
                      selected.blocked && (
                        <button
                          onClick={() => setWaiverModal(true)}
                          className={btnGhostCls}
                        >
                          Conceder exención
                        </button>
                      )
                    )}

                    <button
                      onClick={() =>
                        requireMutation.mutate({
                          id: selected.contactId,
                          required: false,
                        })
                      }
                      className={`${btnGhostCls} ml-auto text-gray-400`}
                    >
                      No exigir homologación
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="hidden items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500 lg:flex">
              Selecciona una empresa para ver y gestionar su documentación
            </div>
          )}
        </div>
      )}

      {showAll && candidates.length > 0 && (
        <p className="mt-4 text-xs text-gray-400">
          {candidates.length} contactos más sin control documental. Selecciona
          uno arriba para exigirle homologación.
        </p>
      )}

      {/* Alta de documento */}
      <Modal
        open={docModal}
        title="Añadir documento de homologación"
        onClose={() => setDocModal(false)}
      >
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Tipo de documento</label>
            <select
              className={`${selectCls} w-full`}
              value={docForm.docType}
              onChange={(e) =>
                setDocForm({
                  ...docForm,
                  docType: e.target.value as ComplianceDocType,
                })
              }
            >
              {COMPLIANCE_DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {COMPLIANCE_DOC_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Fecha de emisión</label>
              <input
                type="date"
                className={fieldCls}
                value={docForm.issuedAt}
                onChange={(e) =>
                  setDocForm({ ...docForm, issuedAt: e.target.value })
                }
              />
            </div>
            <div>
              <label className={labelCls}>
                Caducidad{' '}
                <span className="font-normal text-gray-400">
                  (vacío = permanente)
                </span>
              </label>
              <input
                type="date"
                className={fieldCls}
                value={docForm.expiresAt}
                onChange={(e) =>
                  setDocForm({ ...docForm, expiresAt: e.target.value })
                }
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>Observaciones</label>
            <input
              className={fieldCls}
              value={docForm.notes}
              onChange={(e) =>
                setDocForm({ ...docForm, notes: e.target.value })
              }
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setDocModal(false)} className={btnGhostCls}>
              Cancelar
            </button>
            <button
              onClick={() =>
                selected && addDocMutation.mutate(selected.contactId)
              }
              disabled={addDocMutation.isPending}
              className={btnPrimaryCls}
            >
              {addDocMutation.isPending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Bloqueo manual */}
      <Modal
        open={blockModal}
        title="Bloquear empresa"
        onClose={() => setBlockModal(false)}
      >
        <p className="mb-3 text-sm text-gray-500">
          Mientras esté bloqueada no se podrán aprobar sus facturas ni liquidar
          sus pagos.
        </p>
        <label className={labelCls}>Motivo del bloqueo</label>
        <input
          className={fieldCls}
          value={blockReason}
          onChange={(e) => setBlockReason(e.target.value)}
          placeholder="Ej.: accidente sin parte, documentación falsa…"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setBlockModal(false)} className={btnGhostCls}>
            Cancelar
          </button>
          <button
            onClick={() =>
              selected &&
              blockMutation.mutate({
                id: selected.contactId,
                reason: blockReason,
              })
            }
            disabled={!blockReason.trim() || blockMutation.isPending}
            className={btnPrimaryCls}
          >
            Bloquear
          </button>
        </div>
      </Modal>

      {/* Exención */}
      <Modal
        open={waiverModal}
        title="Conceder exención temporal"
        onClose={() => setWaiverModal(false)}
      >
        <p className="mb-3 text-sm text-gray-500">
          Permite operar pese al bloqueo hasta la fecha indicada. Queda
          registrada con su justificación.
        </p>
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Justificación</label>
            <input
              className={fieldCls}
              value={waiverForm.reason}
              onChange={(e) =>
                setWaiverForm({ ...waiverForm, reason: e.target.value })
              }
              placeholder="Quién la autoriza y por qué"
            />
          </div>
          <div>
            <label className={labelCls}>Válida hasta</label>
            <input
              type="date"
              className={fieldCls}
              value={waiverForm.validUntil}
              onChange={(e) =>
                setWaiverForm({ ...waiverForm, validUntil: e.target.value })
              }
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setWaiverModal(false)} className={btnGhostCls}>
            Cancelar
          </button>
          <button
            onClick={() =>
              selected && waiverMutation.mutate(selected.contactId)
            }
            disabled={
              !waiverForm.reason.trim() ||
              !waiverForm.validUntil ||
              waiverMutation.isPending
            }
            className={btnPrimaryCls}
          >
            Conceder
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={removeDocId !== null}
        title="Eliminar documento"
        description="Dejará de contar para la homologación. Si era obligatorio, la empresa quedará bloqueada."
        loading={removeDocMutation.isPending}
        onConfirm={() => removeDocId && removeDocMutation.mutate(removeDocId)}
        onCancel={() => setRemoveDocId(null)}
      />
    </div>
  );
}
