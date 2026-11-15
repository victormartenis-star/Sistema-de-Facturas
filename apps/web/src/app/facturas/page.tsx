'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  INVOICE_STATUSES,
  INVOICE_STATUS_LABELS,
  ISP_LEGEND,
  type InvoiceCreateInput,
  type InvoiceDto,
  type InvoiceKind,
  type InvoiceRectifyInput,
  type InvoiceStatus,
} from '@erp/shared';
import {
  ApiError,
  categoriesApi,
  exportsApi,
  formatDate,
  formatEur,
  invoicesApi,
  projectsApi,
} from '@/lib/api';
import { useListadoPaginado } from '@/lib/use-listado-paginado';
import { usePermisos } from '@/lib/permisos';
import { textoDeError } from '@/lib/errores';
import {
  BarraFiltros,
  DataTable,
  FiltroEstado,
  FiltroObra,
  type ColumnaDef,
} from '@/components/data-table';
import { Autorizado } from '@/components/autorizado';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useAvisarError, useToast } from '@/components/toast';
import { InvoiceFormModal } from '@/components/invoice-form-modal';
import { InvoiceRectifyModal } from '@/components/invoice-rectify-modal';
import { ReasonDialog } from '@/components/reason-dialog';
import {
  IconCheck,
  IconPencil,
  IconPlus,
  IconReceipt,
  IconTrash,
  IconX,
} from '@/components/icons';
import {
  PageHeader,
  SearchInput,
  btnGhostCls,
  btnPrimaryCls,
} from '@/components/ui';

const STATUS_STYLES: Record<InvoiceStatus, string> = {
  borrador: 'bg-gray-200 text-gray-700',
  aprobada: 'bg-sky-100 text-sky-700',
  pagada: 'bg-emerald-100 text-emerald-700',
  rectificada: 'bg-amber-100 text-amber-700',
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

const errText = textoDeError;

function DetalleFactura({ inv, kind }: { inv: InvoiceDto; kind: InvoiceKind }) {
  return (
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
                      <IconCheck size={13} className="text-emerald-700" />
                      {n.noteNumber}
                    </span>
                    <span className="tabular-nums">{formatEur(n.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <p className="mt-3 text-xs text-gray-500">
          Vencimiento:{' '}
          {inv.dueDate ? formatDate(inv.dueDate) : 'según plazo del contacto'}
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
  );
}

export default function FacturasPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const avisarError = useAvisarError();
  const { can } = usePermisos();
  const [kind, setKind] = useState<InvoiceKind>('compra');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<InvoiceDto | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InvoiceDto | null>(null);
  const [cancelTarget, setCancelTarget] = useState<InvoiceDto | null>(null);
  const [rectifyTarget, setRectifyTarget] = useState<InvoiceDto | null>(null);

  const listado = useListadoPaginado({
    clave: 'invoices',
    filtrosIniciales: { kind: 'compra', status: '', search: '', projectId: '' },
    camposConRetardo: ['search'],
    consulta: (p) => invoicesApi.listPaginado(p),
  });
  const { filtros, setFiltro } = listado;
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
    qc.invalidateQueries({ queryKey: ['economics'] });
  };

  const saveMutation = useMutation({
    mutationFn: (values: InvoiceCreateInput) =>
      editing
        ? invoicesApi.update(editing.id, values, editing.version)
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
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) =>
      invoicesApi.cancel(id, motivo),
    onSuccess: () => {
      toast('Factura anulada');
      invalidate();
      setCancelTarget(null);
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const rectifyMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: InvoiceRectifyInput }) =>
      invoicesApi.rectify(id, input),
    onSuccess: (rect) => {
      toast(
        `Rectificativa ${rect.invoiceNumber} creada en borrador: apruébala para aplicarla`,
      );
      invalidate();
      setRectifyTarget(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (inv: InvoiceDto) => invoicesApi.remove(inv.id, inv.version),
    onSuccess: () => {
      toast('Borrador eliminado');
      invalidate();
      setDeleteTarget(null);
    },
    onError: (e) => {
      avisarError(e, invalidate);
      setDeleteTarget(null);
    },
  });

  /** Refresca la factura en edición con su versión vigente. */
  const recargarEditing = async () => {
    if (!editing) return;
    const fresca = await invoicesApi.get(editing.id);
    saveMutation.reset();
    setEditing(fresca);
    invalidate();
  };

  const abrirNueva = () => {
    setEditing(null);
    saveMutation.reset();
    setModalOpen(true);
  };

  const columnas: ColumnaDef<InvoiceDto>[] = [
    {
      id: 'numero',
      cabecera: 'Número',
      celda: (inv) => (
        <>
          <span className="font-medium">{inv.invoiceNumber}</span>
          {inv.isp && (
            <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
              ISP
            </span>
          )}
          {inv.rectifiesInvoiceNumber && (
            <span
              className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
              title={inv.rectificationReason ?? undefined}
            >
              Rectifica a {inv.rectifiesInvoiceNumber}
            </span>
          )}
        </>
      ),
    },
    {
      id: 'contacto',
      cabecera: kind === 'compra' ? 'Proveedor' : 'Cliente',
      celda: (inv) => inv.contactName,
    },
    {
      id: 'emision',
      cabecera: 'Emisión',
      celda: (inv) => (
        <span className="text-gray-600">{formatDate(inv.issueDate)}</span>
      ),
    },
    {
      id: 'base',
      cabecera: 'Base',
      alineacion: 'derecha',
      ocultaEnMovil: true,
      celda: (inv) => formatEur(inv.baseAmount),
    },
    {
      id: 'total',
      cabecera: 'Total',
      alineacion: 'derecha',
      celda: (inv) => (
        <span className="font-medium">{formatEur(inv.totalAmount)}</span>
      ),
    },
    {
      id: 'retencion',
      cabecera: 'Retención',
      alineacion: 'derecha',
      ocultaEnMovil: true,
      celda: (inv) => (
        <span className="text-gray-600">
          {inv.retentionAmount > 0 ? formatEur(inv.retentionAmount) : '—'}
        </span>
      ),
    },
    {
      id: 'estado',
      cabecera: 'Estado',
      celda: (inv) => <InvoiceStatusBadge status={inv.status} />,
    },
  ];

  return (
    <div className="animate-fade-in-up">
      <PageHeader title="Facturas" count={listado.total}>
        <SearchInput
          value={filtros.search}
          onChange={(v) => setFiltro('search', v)}
          placeholder="Buscar por número o contacto…"
        />
        <button
          onClick={() =>
            exportsApi
              .download('facturas', { kind, status: filtros.status })
              .catch((e) => toast(errText(e), 'error'))
          }
          className={btnGhostCls}
        >
          Exportar CSV
        </button>
        <Autorizado accion="crear" recurso="factura">
          <button onClick={abrirNueva} className={btnPrimaryCls}>
            <IconPlus size={15} />
            Nueva factura
          </button>
        </Autorizado>
      </PageHeader>

      {/* Pestañas compra / venta */}
      <div className="mb-4 inline-flex rounded-lg border border-gray-200 bg-white p-1">
        {(['compra', 'venta'] as const).map((k) => (
          <button
            key={k}
            onClick={() => {
              setKind(k);
              setFiltro('kind', k);
              setExpanded(null);
            }}
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

      <BarraFiltros
        hayFiltros={listado.hayFiltros}
        onLimpiar={() => {
          listado.limpiarFiltros();
          setKind('compra');
        }}
      >
        <FiltroObra
          value={filtros.projectId}
          onChange={(v) => setFiltro('projectId', v)}
        />
        <FiltroEstado<InvoiceStatus>
          value={filtros.status as InvoiceStatus | ''}
          onChange={(v) => setFiltro('status', v)}
          estados={INVOICE_STATUSES}
          etiquetas={INVOICE_STATUS_LABELS}
        />
      </BarraFiltros>

      <DataTable
        etiqueta="Facturas"
        columnas={columnas}
        filas={listado.filas}
        idFila={(inv) => inv.id}
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
          icono: <IconReceipt size={26} />,
          titulo:
            kind === 'compra'
              ? 'Todavía no hay facturas de compra'
              : 'Todavía no hay facturas de venta',
        }}
        vacioConFiltros={{
          titulo: 'Ninguna factura coincide con el filtro',
          onLimpiar: listado.limpiarFiltros,
        }}
        idExpandida={expanded}
        onExpandir={setExpanded}
        filaExpandida={(inv) => <DetalleFactura inv={inv} kind={kind} />}
        acciones={(inv) => (
          <>
            {inv.status === 'borrador' && (
              <>
                {can('cambiarEstado', 'factura') && (
                  <button
                    onClick={() => approveMutation.mutate(inv.id)}
                    className="rounded-md px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                  >
                    Aprobar
                  </button>
                )}
                {can('editar', 'factura') && (
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
                )}
                {can('borrar', 'factura') && (
                  <button
                    onClick={() => setDeleteTarget(inv)}
                    title="Eliminar borrador"
                    className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <IconTrash size={14} />
                  </button>
                )}
              </>
            )}
            {inv.status === 'aprobada' && (
              <>
                {can('cambiarEstado', 'factura') && (
                  <button
                    onClick={() => payMutation.mutate(inv.id)}
                    className="rounded-md px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                  >
                    {kind === 'compra' ? 'Pagar' : 'Cobrar'}
                  </button>
                )}
                {/* Una venta aprobada no se anula: se rectifica. */}
                {kind === 'compra' && can('anular', 'factura') && (
                  <button
                    onClick={() => setCancelTarget(inv)}
                    className="rounded-md px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-50"
                  >
                    Anular
                  </button>
                )}
              </>
            )}
            {(inv.status === 'aprobada' || inv.status === 'pagada') &&
              inv.rectifiesInvoiceId === null &&
              can('rectificar', 'factura') && (
                <button
                  onClick={() => {
                    rectifyMutation.reset();
                    setRectifyTarget(inv);
                  }}
                  className="rounded-md px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50"
                >
                  Rectificar
                </button>
              )}
          </>
        )}
      />

      <InvoiceFormModal
        open={modalOpen}
        kind={kind}
        invoice={editing}
        projects={projectsQuery.data ?? []}
        categories={categoriesQuery.data ?? []}
        saving={saveMutation.isPending}
        error={(saveMutation.error as ApiError | null) ?? null}
        onSave={(values) => saveMutation.mutate(values)}
        onReload={editing ? recargarEditing : undefined}
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
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
      <ReasonDialog
        open={cancelTarget !== null}
        title={`¿Anular la factura "${cancelTarget?.invoiceNumber ?? ''}"?`}
        description="Se liberarán sus albaranes y se eliminarán los vencimientos previstos. Queda anulada para conservar la trazabilidad."
        confirmLabel="Anular"
        required={cancelTarget?.status !== 'borrador'}
        loading={cancelMutation.isPending}
        onConfirm={(motivo) =>
          cancelTarget && cancelMutation.mutate({ id: cancelTarget.id, motivo })
        }
        onCancel={() => setCancelTarget(null)}
      />
      <InvoiceRectifyModal
        open={rectifyTarget !== null}
        invoice={rectifyTarget}
        saving={rectifyMutation.isPending}
        error={rectifyMutation.error ? errText(rectifyMutation.error) : null}
        onSave={(input) =>
          rectifyTarget &&
          rectifyMutation.mutate({ id: rectifyTarget.id, input })
        }
        onClose={() => setRectifyTarget(null)}
      />
    </div>
  );
}
