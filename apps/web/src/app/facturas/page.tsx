'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import {
  INVOICE_STATUSES,
  INVOICE_STATUS_LABELS,
  ISP_LEGEND,
  type InvoiceCreateInput,
  type InvoiceDto,
  type InvoiceKind,
  type InvoiceStatus,
} from '@erp/shared';
import {
  ApiError,
  categoriesApi,
  formatDate,
  formatEur,
  invoicesApi,
  projectsApi,
} from '@/lib/api';
import { useDebouncedValue } from '@/lib/hooks';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { InvoiceFormModal } from '@/components/invoice-form-modal';
import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconPencil,
  IconPlus,
  IconReceipt,
  IconTrash,
  IconX,
} from '@/components/icons';
import {
  EmptyState,
  ErrorBanner,
  PageHeader,
  SearchInput,
  TableSkeleton,
  btnPrimaryCls,
  selectCls,
} from '@/components/ui';

const STATUS_STYLES: Record<InvoiceStatus, string> = {
  borrador: 'bg-gray-200 text-gray-700',
  aprobada: 'bg-sky-100 text-sky-700',
  pagada: 'bg-emerald-100 text-emerald-700',
  anulada: 'bg-red-100 text-red-600',
};

function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {INVOICE_STATUS_LABELS[status]}
    </span>
  );
}

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

export default function FacturasPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<InvoiceKind>('compra');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<InvoiceDto | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InvoiceDto | null>(null);
  const [cancelTarget, setCancelTarget] = useState<InvoiceDto | null>(null);

  const query = useQuery({
    queryKey: ['invoices', kind, status, debouncedSearch],
    queryFn: () => invoicesApi.list(kind, status, debouncedSearch),
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

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['invoices'] });
    qc.invalidateQueries({ queryKey: ['delivery-notes'] });
  };

  const saveMutation = useMutation({
    mutationFn: (values: InvoiceCreateInput) =>
      editing
        ? invoicesApi.update(editing.id, values)
        : invoicesApi.create(values),
    onSuccess: () => {
      toast(editing ? 'Factura actualizada' : 'Borrador de factura creado');
      invalidate();
      setModalOpen(false);
      setEditing(null);
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => invoicesApi.approve(id),
    onSuccess: () => {
      toast('Factura aprobada: vencimientos generados');
      invalidate();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const payMutation = useMutation({
    mutationFn: (id: string) => invoicesApi.markPaid(id),
    onSuccess: () => {
      toast('Factura liquidada');
      invalidate();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => invoicesApi.cancel(id),
    onSuccess: () => {
      toast('Factura anulada');
      invalidate();
      setCancelTarget(null);
    },
    onError: (e) => {
      toast(errText(e), 'error');
      setCancelTarget(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => invoicesApi.remove(id),
    onSuccess: () => {
      toast('Borrador eliminado');
      invalidate();
      setDeleteTarget(null);
    },
    onError: (e) => {
      toast(errText(e), 'error');
      setDeleteTarget(null);
    },
  });

  const invoices = query.data ?? [];

  return (
    <div className="animate-fade-in-up">
      <PageHeader title="Facturas" count={invoices.length}>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar por número o contacto…"
        />
        <select
          className={selectCls}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Todos los estados</option>
          {INVOICE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {INVOICE_STATUS_LABELS[s]}
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
          Nueva factura
        </button>
      </PageHeader>

      {/* Pestañas compra / venta */}
      <div className="mb-4 inline-flex rounded-lg border border-gray-200 bg-white p-1">
        {(['compra', 'venta'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
              kind === k
                ? 'bg-amber-500 text-white shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {k === 'compra' ? 'Recibidas (compra)' : 'Emitidas (venta)'}
          </button>
        ))}
      </div>

      {query.isLoading && <TableSkeleton />}
      {query.isError && <ErrorBanner message={errText(query.error)} />}

      {query.isSuccess && invoices.length === 0 && (
        <EmptyState
          icon={<IconReceipt size={26} />}
          title={
            search || status
              ? 'Ninguna factura coincide con el filtro'
              : kind === 'compra'
                ? 'Todavía no hay facturas de compra'
                : 'Todavía no hay facturas de venta'
          }
        />
      )}

      {invoices.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60 text-left text-xs tracking-wide text-gray-500 uppercase">
                <th className="px-4 py-3 font-medium">Número</th>
                <th className="px-4 py-3 font-medium">
                  {kind === 'compra' ? 'Proveedor' : 'Cliente'}
                </th>
                <th className="px-4 py-3 font-medium">Emisión</th>
                <th className="px-4 py-3 text-right font-medium">Base</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-4 py-3 text-right font-medium">Retención</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <Fragment key={inv.id}>
                  <tr className="border-b border-gray-100 transition-colors hover:bg-amber-50/40">
                    <td className="px-4 py-3">
                      <button
                        onClick={() =>
                          setExpanded(expanded === inv.id ? null : inv.id)
                        }
                        className="inline-flex items-center gap-1.5 font-medium hover:text-amber-700"
                      >
                        {expanded === inv.id ? (
                          <IconChevronUp size={13} />
                        ) : (
                          <IconChevronDown size={13} />
                        )}
                        {inv.invoiceNumber}
                      </button>
                      {inv.isp && (
                        <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                          ISP
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">{inv.contactName}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {formatDate(inv.issueDate)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatEur(inv.baseAmount)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">
                      {formatEur(inv.totalAmount)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600 tabular-nums">
                      {inv.retentionAmount > 0
                        ? formatEur(inv.retentionAmount)
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <InvoiceStatusBadge status={inv.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                        {inv.status === 'borrador' && (
                          <>
                            <button
                              onClick={() => approveMutation.mutate(inv.id)}
                              className="rounded-md px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50"
                            >
                              Aprobar
                            </button>
                            <button
                              onClick={() => {
                                setEditing(inv);
                                saveMutation.reset();
                                setModalOpen(true);
                              }}
                              title="Editar"
                              className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                            >
                              <IconPencil size={14} />
                            </button>
                            <button
                              onClick={() => setDeleteTarget(inv)}
                              title="Eliminar borrador"
                              className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                            >
                              <IconTrash size={14} />
                            </button>
                          </>
                        )}
                        {inv.status === 'aprobada' && (
                          <>
                            <button
                              onClick={() => payMutation.mutate(inv.id)}
                              className="rounded-md px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50"
                            >
                              {kind === 'compra' ? 'Pagar' : 'Cobrar'}
                            </button>
                            <button
                              onClick={() => setCancelTarget(inv)}
                              className="rounded-md px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-50"
                            >
                              Anular
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expanded === inv.id && (
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      <td colSpan={8} className="px-6 py-4">
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                          <div>
                            <p className="mb-2 text-xs font-semibold text-gray-600 uppercase">
                              Líneas e imputación
                            </p>
                            <ul className="space-y-1">
                              {inv.lines.map((l) => (
                                <li
                                  key={l.id}
                                  className="flex items-baseline justify-between gap-3 text-sm"
                                >
                                  <span>
                                    {l.description}
                                    {(l.projectCode || l.phaseCode) && (
                                      <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 font-mono text-[10px] text-gray-600">
                                        {l.projectCode ?? ''}
                                        {l.phaseCode ? ` · ${l.phaseCode}` : ''}
                                      </span>
                                    )}
                                  </span>
                                  <span className="tabular-nums">
                                    {formatEur(l.baseAmount)} + {l.vatPct} %
                                  </span>
                                </li>
                              ))}
                            </ul>
                            {inv.isp && (
                              <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">
                                {ISP_LEGEND}
                              </p>
                            )}
                          </div>
                          <div>
                            {kind === 'compra' && (
                              <>
                                <p className="mb-2 text-xs font-semibold text-gray-600 uppercase">
                                  Albaranes punteados
                                </p>
                                {inv.deliveryNotes.length === 0 ? (
                                  <p className="flex items-center gap-1.5 text-sm text-amber-700">
                                    <IconX size={13} />
                                    Sin albaranes: no se podrá aprobar
                                  </p>
                                ) : (
                                  <ul className="space-y-1">
                                    {inv.deliveryNotes.map((n) => (
                                      <li
                                        key={n.id}
                                        className="flex items-center justify-between text-sm"
                                      >
                                        <span className="flex items-center gap-1.5">
                                          <IconCheck
                                            size={13}
                                            className="text-emerald-600"
                                          />
                                          {n.noteNumber}
                                        </span>
                                        <span className="tabular-nums">
                                          {formatEur(n.amount)}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </>
                            )}
                            <p className="mt-3 text-xs text-gray-500">
                              Vencimiento:{' '}
                              {inv.dueDate
                                ? formatDate(inv.dueDate)
                                : 'según plazo del contacto'}
                              {inv.retentionAmount > 0 && (
                                <>
                                  {' · '}Garantía {inv.retentionPct} % (
                                  {formatEur(inv.retentionAmount)}) hasta{' '}
                                  {inv.retentionReleaseDate
                                    ? formatDate(inv.retentionReleaseDate)
                                    : '1 año tras emisión'}
                                </>
                              )}
                            </p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <InvoiceFormModal
        open={modalOpen}
        kind={kind}
        invoice={editing}
        projects={projectsQuery.data ?? []}
        categories={categoriesQuery.data ?? []}
        saving={saveMutation.isPending}
        error={(saveMutation.error as ApiError | null) ?? null}
        onSave={(values) => saveMutation.mutate(values)}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`¿Eliminar el borrador "${deleteTarget?.invoiceNumber ?? ''}"?`}
        description="Se desvincularán sus albaranes."
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
      <ConfirmDialog
        open={cancelTarget !== null}
        title={`¿Anular la factura "${cancelTarget?.invoiceNumber ?? ''}"?`}
        description="Se liberarán sus albaranes y se eliminarán los vencimientos previstos."
        confirmLabel="Anular"
        loading={cancelMutation.isPending}
        onConfirm={() => cancelTarget && cancelMutation.mutate(cancelTarget.id)}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  );
}
