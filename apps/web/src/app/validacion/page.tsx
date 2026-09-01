'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DOC_STATUS_LABELS,
  DOC_TYPE_LABELS,
  type DocStatus,
  type DocType,
  type ExtractionConfidence,
  type ValidationItemDto,
} from '@erp/shared';
import {
  categoriesApi,
  contactsApi,
  documentFileUrl,
  formatDate,
  formatEur,
  ocrApi,
  projectsApi,
  validationApi,
} from '@/lib/api';
import { DocStatusBadge } from '@/components/doc-status-badge';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import {
  IconAlertTriangle,
  IconCheck,
  IconExternalLink,
  IconLoader,
  IconSparkles,
  IconX,
} from '@/components/icons';
import {
  EmptyState,
  ErrorBanner,
  PageHeader,
  btnPrimaryCls,
  fieldCls,
  labelCls,
  selectCls,
} from '@/components/ui';

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

/* Confianza del modelo: verde ≥85 %, ámbar ≥60 %, rojo por debajo. */
function confidenceTone(value: number): { dot: string; text: string } {
  if (value >= 0.85) return { dot: 'bg-emerald-500', text: 'text-emerald-600' };
  if (value >= 0.6) return { dot: 'bg-amber-500', text: 'text-amber-600' };
  return { dot: 'bg-red-500', text: 'text-red-600' };
}

function Confidence({ value }: { value: number | undefined }) {
  if (value === undefined) return null;
  const tone = confidenceTone(value);
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold tabular-nums ${tone.text}`}
      title={`Confianza del modelo: ${Math.round(value * 100)} %`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {Math.round(value * 100)} %
    </span>
  );
}

/** Campo que la IA leyó y el humano puede corregir. */
function EditableField({
  label,
  value,
  confidence,
  placeholder,
  type = 'text',
  onChange,
}: {
  label: string;
  value: string;
  confidence?: number;
  placeholder?: string;
  type?: 'text' | 'date';
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <label className="text-xs font-medium text-gray-600">{label}</label>
        <Confidence value={confidence} />
      </div>
      <input
        type={type}
        className={fieldCls}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Dato leído que no se edita aquí (referencia para quien valida). */
function ReadOnlyField({
  label,
  value,
  confidence,
}: {
  label: string;
  value: ReactNode;
  confidence?: number;
}) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-medium text-gray-500">{label}</p>
        <Confidence value={confidence} />
      </div>
      <p className="mt-0.5 truncate text-sm font-medium text-gray-800">
        {value || '—'}
      </p>
    </div>
  );
}

interface FormState {
  invoiceNumber: string;
  issueDate: string;
  baseAmount: string;
  vatAmount: string;
  contactId: string;
  projectId: string;
  categoryId: string;
  createInvoice: boolean;
}

const num = (s: string): number | null => {
  if (s.trim() === '') return null;
  const n = Number(s.replace(',', '.'));
  return Number.isNaN(n) ? null : n;
};

export default function ValidacionPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ValidationItemDto | null>(
    null,
  );
  const [form, setForm] = useState<FormState | null>(null);

  const statusQuery = useQuery({
    queryKey: ['ocr-status'],
    queryFn: ocrApi.status,
    staleTime: 60_000,
  });

  const query = useQuery({
    queryKey: ['validacion', status],
    queryFn: () => validationApi.list(status),
    // Mientras el worker procesa, la bandeja se refresca sola
    refetchInterval: 15_000,
  });

  const contactsQuery = useQuery({
    queryKey: ['contacts', '', ''],
    queryFn: () => contactsApi.list('', ''),
    staleTime: 5 * 60_000,
  });
  const projectsQuery = useQuery({
    queryKey: ['projects', '', ''],
    queryFn: () => projectsApi.list('', ''),
    staleTime: 5 * 60_000,
  });
  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: categoriesApi.list,
    staleTime: 5 * 60_000,
  });

  const items = query.data ?? [];
  const selected = useMemo(
    () => items.find((i) => i.documentId === selectedId) ?? items[0] ?? null,
    [items, selectedId],
  );

  /**
   * Al cambiar de documento, el formulario parte de lo que leyó la IA.
   * Se reinicia solo cuando cambia el documento: así las categorías o los
   * refrescos de la lista no borran lo que el usuario esté corrigiendo.
   */
  const [formDocId, setFormDocId] = useState<string | null>(null);
  useEffect(() => {
    if (!selected) {
      setForm(null);
      setFormDocId(null);
      return;
    }
    if (selected.documentId === formDocId) return;
    const p = selected.extraction?.payload;
    setFormDocId(selected.documentId);
    setForm({
      invoiceNumber: p?.invoiceNumber ?? '',
      issueDate: p?.issueDate ?? '',
      baseAmount: p?.baseAmount?.toString() ?? '',
      vatAmount: p?.vatAmount?.toString() ?? '',
      contactId: selected.suggestedContactId ?? '',
      projectId: selected.suggestedProjectId ?? selected.projectId ?? '',
      categoryId:
        categoriesQuery.data?.find((c) => c.slug === p?.categorySlug)?.id ?? '',
      createInvoice: p?.docType === 'factura_compra',
    });
  }, [selected, formDocId, categoriesQuery.data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['validacion'] });
    qc.invalidateQueries({ queryKey: ['documents'] });
    qc.invalidateQueries({ queryKey: ['invoices'] });
  };

  const validateMutation = useMutation({
    mutationFn: () =>
      validationApi.validate(selected!.documentId, {
        invoiceNumber: form!.invoiceNumber || null,
        issueDate: form!.issueDate || null,
        baseAmount: num(form!.baseAmount),
        vatAmount: num(form!.vatAmount),
        contactId: form!.contactId || null,
        projectId: form!.projectId || null,
        categoryId: form!.categoryId || null,
        createInvoice: form!.createInvoice,
      }),
    onSuccess: (result) => {
      toast(result.message);
      setSelectedId(null);
      invalidate();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const rejectMutation = useMutation({
    mutationFn: (documentId: string) => validationApi.reject(documentId),
    onSuccess: () => {
      toast('Documento descartado');
      setRejectTarget(null);
      setSelectedId(null);
      invalidate();
    },
    onError: (e) => {
      toast(errText(e), 'error');
      setRejectTarget(null);
    },
  });

  const reprocessMutation = useMutation({
    mutationFn: (documentId: string) => validationApi.reprocess(documentId),
    onSuccess: () => {
      toast('Documento releído por la IA');
      invalidate();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const pipelineOff = statusQuery.data?.enabled === false;
  const payload = selected?.extraction?.payload;
  const confidence: Partial<ExtractionConfidence> =
    selected?.extraction?.confidence ?? {};
  const warnings = selected?.extraction?.warnings ?? [];

  return (
    <div className="animate-fade-in-up">
      <PageHeader
        title="Bandeja de validación"
        count={items.length}
        subtitle="Confirma o corrige lo que ha leído la IA"
      >
        <select
          className={selectCls}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Pendientes de validar</option>
          {(
            [
              'extraido',
              'procesando',
              'error',
              'validado',
              'rechazado',
            ] as DocStatus[]
          ).map((s) => (
            <option key={s} value={s}>
              {DOC_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </PageHeader>

      {pipelineOff && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
          <IconAlertTriangle
            size={16}
            className="mt-0.5 shrink-0 text-amber-600"
          />
          <div className="text-amber-800">
            <p className="font-medium">
              El pipeline de lectura está desactivado
            </p>
            <p className="mt-0.5">
              Falta <code className="font-mono text-xs">ANTHROPIC_API_KEY</code>{' '}
              en el archivo <code className="font-mono text-xs">.env</code>. Los
              documentos se seguirán guardando, pero nadie los leerá hasta que
              configures la clave y reinicies la API.
            </p>
          </div>
        </div>
      )}

      {statusQuery.data?.enabled && (
        <p className="mb-4 flex items-center gap-1.5 text-xs text-gray-500">
          <IconSparkles size={13} className="text-amber-500" />
          Lectura automática activa con el modelo{' '}
          <code className="font-mono">{statusQuery.data.model}</code>
        </p>
      )}

      {query.isError && <ErrorBanner message={errText(query.error)} />}

      {query.isLoading && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,20rem)_1fr]">
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-20 rounded-xl" />
            ))}
          </div>
          <div className="skeleton h-96 rounded-2xl" />
        </div>
      )}

      {query.isSuccess && items.length === 0 && (
        <EmptyState
          icon={<IconCheck size={26} />}
          title={
            status
              ? 'Ningún documento en ese estado'
              : 'No hay nada pendiente de validar'
          }
        >
          <p className="text-sm text-gray-500">
            Sube facturas en Documentos: la IA las leerá y aparecerán aquí.
          </p>
        </EmptyState>
      )}

      {items.length > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,20rem)_1fr]">
          {/* Lista de documentos pendientes */}
          <div className="space-y-2">
            {items.map((item) => {
              const active = selected?.documentId === item.documentId;
              const p = item.extraction?.payload;
              const itemWarnings = item.extraction?.warnings.length ?? 0;
              return (
                <button
                  key={item.documentId}
                  onClick={() => setSelectedId(item.documentId)}
                  className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                    active
                      ? 'border-amber-400 bg-amber-50/60 shadow-sm'
                      : 'border-gray-200 bg-white hover:border-amber-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p
                      className="truncate text-sm font-medium text-gray-800"
                      title={item.fileName}
                    >
                      {item.fileName}
                    </p>
                    <DocStatusBadge status={item.status as DocStatus} />
                  </div>
                  <p className="mt-1 truncate text-xs text-gray-500">
                    {p?.issuerName ?? 'Emisor sin identificar'}
                    {p?.totalAmount !== null && p?.totalAmount !== undefined
                      ? ` · ${formatEur(p.totalAmount)}`
                      : ''}
                  </p>
                  {itemWarnings > 0 && (
                    <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                      <IconAlertTriangle size={10} />
                      {itemWarnings} aviso{itemWarnings > 1 ? 's' : ''}
                    </p>
                  )}
                </button>
              );
            })}
          </div>

          {/* Detalle: original + datos leídos */}
          {selected && form && (
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <h2 className="min-w-0 flex-1 truncate font-semibold">
                  {selected.fileName}
                </h2>
                <a
                  href={documentFileUrl(selected.documentId)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-100"
                >
                  <IconExternalLink size={13} />
                  Abrir original
                </a>
                <button
                  onClick={() => reprocessMutation.mutate(selected.documentId)}
                  disabled={reprocessMutation.isPending || pipelineOff}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-amber-600 transition hover:bg-amber-50 disabled:opacity-40"
                >
                  {reprocessMutation.isPending ? (
                    <IconLoader size={13} className="animate-spin" />
                  ) : (
                    <IconSparkles size={13} />
                  )}
                  Releer con IA
                </button>
              </div>

              {selected.status === 'procesando' && (
                <p className="mb-4 flex items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-700">
                  <IconLoader size={14} className="animate-spin" />
                  La IA está leyendo este documento…
                </p>
              )}

              {!selected.extraction && selected.status !== 'procesando' && (
                <p className="mb-4 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
                  Este documento todavía no tiene ninguna lectura. Pulsa «Releer
                  con IA» para procesarlo.
                </p>
              )}

              {/* Avisos del modelo y de las validaciones de negocio */}
              {warnings.length > 0 && (
                <ul className="mb-4 space-y-1.5">
                  {warnings.map((w, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800"
                    >
                      <IconAlertTriangle
                        size={14}
                        className="mt-0.5 shrink-0 text-amber-600"
                      />
                      {w}
                    </li>
                  ))}
                </ul>
              )}

              <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                {/* Vista del original */}
                <div>
                  <p className="mb-2 text-xs font-semibold text-gray-600 uppercase">
                    Original
                  </p>
                  <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                    {selected.mimeType === 'application/pdf' ? (
                      <iframe
                        src={documentFileUrl(selected.documentId)}
                        title={selected.fileName}
                        className="h-96 w-full"
                      />
                    ) : (
                      // Imagen del documento subido: no pasa por next/image
                      // porque la sirve la API con su propia autorización.
                      <img
                        src={documentFileUrl(selected.documentId)}
                        alt={selected.fileName}
                        className="max-h-96 w-full object-contain"
                      />
                    )}
                  </div>
                  {payload?.summary && (
                    <p className="mt-2 text-xs text-gray-500 italic">
                      {payload.summary}
                    </p>
                  )}
                </div>

                {/* Datos leídos */}
                <div className="space-y-4">
                  <p className="text-xs font-semibold text-gray-600 uppercase">
                    Datos leídos
                  </p>

                  <div className="grid grid-cols-2 gap-2">
                    <ReadOnlyField
                      label="Emisor"
                      value={payload?.issuerName}
                      confidence={confidence.issuerName}
                    />
                    <ReadOnlyField
                      label="NIF/CIF"
                      value={payload?.issuerTaxId}
                      confidence={confidence.issuerTaxId}
                    />
                    <ReadOnlyField
                      label="Tipo"
                      value={
                        payload?.docType
                          ? DOC_TYPE_LABELS[payload.docType as DocType]
                          : null
                      }
                      confidence={confidence.docType}
                    />
                    <ReadOnlyField
                      label="Total leído"
                      value={
                        payload?.totalAmount !== null &&
                        payload?.totalAmount !== undefined
                          ? formatEur(payload.totalAmount)
                          : null
                      }
                      confidence={confidence.totalAmount}
                    />
                    <ReadOnlyField
                      label="Forma de pago"
                      value={payload?.paymentMethod}
                      confidence={confidence.paymentMethod}
                    />
                    <ReadOnlyField
                      label="Vencimiento"
                      value={
                        payload?.dueDate ? formatDate(payload.dueDate) : null
                      }
                      confidence={confidence.dueDate}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <EditableField
                      label="Nº factura"
                      value={form.invoiceNumber}
                      confidence={confidence.invoiceNumber}
                      onChange={(v) => setForm({ ...form, invoiceNumber: v })}
                    />
                    <EditableField
                      label="Fecha de emisión"
                      type="date"
                      value={form.issueDate}
                      confidence={confidence.issueDate}
                      onChange={(v) => setForm({ ...form, issueDate: v })}
                    />
                    <EditableField
                      label="Base imponible (€)"
                      value={form.baseAmount}
                      confidence={confidence.baseAmount}
                      placeholder="0,00"
                      onChange={(v) => setForm({ ...form, baseAmount: v })}
                    />
                    <EditableField
                      label="Cuota de IVA (€)"
                      value={form.vatAmount}
                      confidence={confidence.vatAmount}
                      placeholder="0,00"
                      onChange={(v) => setForm({ ...form, vatAmount: v })}
                    />
                  </div>

                  <div>
                    <label className={labelCls}>
                      Proveedor
                      {selected.suggestedContactName && (
                        <span className="ml-1.5 font-normal text-emerald-600">
                          · sugerido por NIF: {selected.suggestedContactName}
                        </span>
                      )}
                    </label>
                    <select
                      className={fieldCls}
                      value={form.contactId}
                      onChange={(e) =>
                        setForm({ ...form, contactId: e.target.value })
                      }
                    >
                      <option value="">Sin asignar</option>
                      {(contactsQuery.data ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.legalName}
                          {c.taxId ? ` · ${c.taxId}` : ''}
                        </option>
                      ))}
                    </select>
                    {payload?.issuerTaxId && !selected.suggestedContactId && (
                      <p className="mt-1 text-xs text-amber-600">
                        Ningún contacto tiene el NIF {payload.issuerTaxId}:
                        créalo en Contactos si quieres generar la factura.
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>
                        Obra
                        {selected.suggestedProjectCode && (
                          <span className="ml-1.5 font-normal text-emerald-600">
                            · {selected.suggestedProjectCode}
                          </span>
                        )}
                      </label>
                      <select
                        className={fieldCls}
                        value={form.projectId}
                        onChange={(e) =>
                          setForm({ ...form, projectId: e.target.value })
                        }
                      >
                        <option value="">Sin obra</option>
                        {(projectsQuery.data ?? []).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.code} · {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Categoría de gasto</label>
                      <select
                        className={fieldCls}
                        value={form.categoryId}
                        onChange={(e) =>
                          setForm({ ...form, categoryId: e.target.value })
                        }
                      >
                        <option value="">Sin categoría</option>
                        {(categoriesQuery.data ?? []).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.createInvoice}
                      onChange={(e) =>
                        setForm({ ...form, createInvoice: e.target.checked })
                      }
                      className="mt-0.5 h-4 w-4 accent-amber-500"
                    />
                    <span>
                      Crear la factura en borrador al validar
                      <span className="block text-xs text-gray-500">
                        Requiere proveedor, nº de factura, fecha y base
                      </span>
                    </span>
                  </label>

                  <div className="flex flex-wrap justify-end gap-2 pt-1">
                    <button
                      onClick={() => setRejectTarget(selected)}
                      className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
                    >
                      <IconX size={14} />
                      Descartar
                    </button>
                    <button
                      onClick={() => validateMutation.mutate()}
                      disabled={
                        validateMutation.isPending || !selected.extraction
                      }
                      className={`${btnPrimaryCls} disabled:opacity-40`}
                    >
                      {validateMutation.isPending ? (
                        <IconLoader size={14} className="animate-spin" />
                      ) : (
                        <IconCheck size={14} />
                      )}
                      Validar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={rejectTarget !== null}
        title={`¿Descartar "${rejectTarget?.fileName ?? ''}"?`}
        description="El documento quedará como rechazado y saldrá de la bandeja. No se borra: podrás recuperarlo desde Documentos."
        confirmLabel="Descartar"
        loading={rejectMutation.isPending}
        onConfirm={() =>
          rejectTarget && rejectMutation.mutate(rejectTarget.documentId)
        }
        onCancel={() => setRejectTarget(null)}
      />
    </div>
  );
}
