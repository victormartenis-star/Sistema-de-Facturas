'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  PURCHASE_ORDER_STATUSES,
  PURCHASE_ORDER_STATUS_LABELS,
  type PurchaseOrderDto,
  type PurchaseOrderStatus,
} from '@erp/shared';
import {
  contactsApi,
  formatDate,
  formatEur,
  projectsApi,
  purchaseOrdersApi,
} from '@/lib/api';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { IconInbox } from '@/components/icons';
import { useToast } from '@/components/toast';
import {
  EmptyState,
  ErrorBanner,
  PageHeader,
  SearchInput,
  TableSkeleton,
  btnPrimaryCls,
  selectCls,
} from '@/components/ui';
import { OrderFormModal } from '@/components/order-form-modal';

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

const STATUS_TONE: Record<PurchaseOrderStatus, string> = {
  emitido: 'bg-sky-100 text-sky-700',
  servido_parcial: 'bg-amber-100 text-amber-700',
  servido: 'bg-emerald-100 text-emerald-700',
  facturado: 'bg-indigo-100 text-indigo-700',
  cerrado: 'bg-gray-200 text-gray-600',
  anulado: 'bg-red-100 text-red-700',
};

function StatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[status]}`}
    >
      {PURCHASE_ORDER_STATUS_LABELS[status]}
    </span>
  );
}

export default function PedidosPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PurchaseOrderStatus | ''>('');
  const [projectId, setProjectId] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PurchaseOrderDto | null>(null);
  const [closing, setClosing] = useState<PurchaseOrderDto | null>(null);

  const projectsQuery = useQuery({
    queryKey: ['projects', '', ''],
    queryFn: () => projectsApi.list('', ''),
    staleTime: 5 * 60_000,
  });
  const contactsQuery = useQuery({
    queryKey: ['contacts', '', ''],
    queryFn: () => contactsApi.list('', ''),
    staleTime: 5 * 60_000,
  });

  const query = useQuery({
    queryKey: ['purchase-orders', search, status, projectId],
    queryFn: () =>
      purchaseOrdersApi.list({
        search,
        status,
        projectId: projectId || undefined,
      }),
  });

  const traceQuery = useQuery({
    queryKey: ['trazabilidad', projectId],
    queryFn: () => purchaseOrdersApi.traceability(projectId || undefined),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['purchase-orders'] });
    qc.invalidateQueries({ queryKey: ['trazabilidad'] });
  };

  const closeMutation = useMutation({
    mutationFn: (id: string) => purchaseOrdersApi.close(id),
    onSuccess: () => {
      toast('Pedido cerrado');
      setClosing(null);
      invalidate();
    },
    onError: (e) => {
      toast(errText(e), 'error');
      setClosing(null);
    },
  });

  const orders = query.data ?? [];

  /** Lo recibido y todavía sin factura: la provisión del cierre mensual. */
  const accrual = traceQuery.data?.totalAccrual ?? 0;
  const lateOrders = useMemo(
    () => orders.filter((o) => o.daysLate > 0),
    [orders],
  );
  const urgentCount = useMemo(
    () => orders.filter((o) => o.urgent).length,
    [orders],
  );

  return (
    <div>
      <PageHeader
        title="Pedidos"
        subtitle="Sin pedido no hay compra · sin pedido no hay albarán validado"
        count={orders.length}
      >
        <button
          className={btnPrimaryCls}
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          Nuevo pedido
        </button>
      </PageHeader>

      {/* Las tres cifras que se miran en la reunión mensual */}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-[11px] font-semibold tracking-wide text-amber-700 uppercase">
            Recibido sin facturar
          </p>
          <p className="mt-1 text-2xl font-bold text-amber-900 tabular-nums">
            {formatEur(accrual)}
          </p>
          <p className="mt-1 text-[11px] text-amber-700">
            Provisión del cierre: sin ella el coste del mes sale a la baja
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
            Pedidos con retraso
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums">
            {lateOrders.length}
          </p>
          <p className="mt-1 text-[11px] text-gray-500">
            {lateOrders.length > 0
              ? `El mayor, ${Math.max(...lateOrders.map((o) => o.daysLate))} días`
              : 'Todas las entregas en fecha'}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
            Pedidos urgentes
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{urgentCount}</p>
          <p className="mt-1 text-[11px] text-gray-500">
            Autorizados verbalmente y regularizados después
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar por número, descripción o proveedor…"
        />
        <select
          className={selectCls}
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
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
          value={status}
          onChange={(e) =>
            setStatus(e.target.value as PurchaseOrderStatus | '')
          }
        >
          <option value="">Todos los estados</option>
          {PURCHASE_ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PURCHASE_ORDER_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {query.isError && <ErrorBanner message={errText(query.error)} />}
      {query.isLoading && <TableSkeleton />}

      {query.isSuccess && orders.length === 0 && (
        <EmptyState
          icon={<IconInbox size={26} />}
          title={
            search || status || projectId
              ? 'Ningún pedido coincide con el filtro'
              : 'Todavía no hay pedidos'
          }
        >
          <p className="mx-auto max-w-md text-sm text-gray-500">
            El pedido es lo que permite validar albaranes y aprobar facturas.
            Empieza por aquí.
          </p>
        </EmptyState>
      )}

      {orders.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60 text-left text-xs tracking-wide text-gray-500 uppercase">
                <th className="px-4 py-3 font-medium">Nº pedido</th>
                <th className="px-4 py-3 font-medium">Proveedor</th>
                <th className="px-4 py-3 font-medium">Descripción</th>
                <th className="px-4 py-3 text-right font-medium">Importe</th>
                <th className="px-4 py-3 text-right font-medium">Servido</th>
                <th className="px-4 py-3 text-right font-medium">
                  Pdte. facturar
                </th>
                <th className="px-4 py-3 font-medium">Entrega</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr
                  key={o.id}
                  className="border-b border-gray-100 transition-colors last:border-0 hover:bg-amber-50/40"
                >
                  <td className="px-4 py-3 font-mono text-xs font-semibold">
                    {o.orderNumber}
                    {o.urgent && (
                      <span className="ml-1.5 rounded bg-orange-100 px-1 text-[10px] font-semibold text-orange-700">
                        URGENTE
                      </span>
                    )}
                    <span className="block font-sans text-[11px] font-normal text-gray-400">
                      {o.projectCode}
                    </span>
                  </td>
                  <td className="px-4 py-3">{o.contactName}</td>
                  <td
                    className="max-w-56 truncate px-4 py-3 text-gray-600"
                    title={o.description}
                  >
                    {o.description}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatEur(o.amount)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                    {formatEur(o.deliveredAmount)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {o.pendingToInvoice > 0 ? (
                      <span className="font-semibold text-amber-700">
                        {formatEur(o.pendingToInvoice)}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {o.expectedDate ? formatDate(o.expectedDate) : '—'}
                    {o.daysLate > 0 && (
                      <span className="ml-1 font-semibold text-red-600">
                        +{o.daysLate} d
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      className="text-xs text-gray-500 hover:text-gray-900"
                      onClick={() => {
                        setEditing(o);
                        setFormOpen(true);
                      }}
                    >
                      Editar
                    </button>
                    {o.status !== 'cerrado' && o.status !== 'anulado' && (
                      <button
                        className="ml-3 text-xs text-gray-500 hover:text-gray-900"
                        onClick={() => setClosing(o)}
                      >
                        Cerrar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Cuadro de trazabilidad: la lectura de cada pedido en una frase */}
      {traceQuery.data && traceQuery.data.rows.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-1 text-sm font-semibold">
            Cuadro de trazabilidad pedido – albarán – factura
          </h2>
          <p className="mb-3 text-xs text-gray-500">
            Se entrega a Administración en cada cierre. Los pedidos con albarán
            y sin factura son la provisión del mes.
          </p>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Pedido</th>
                  <th className="px-4 py-2.5 font-medium">Proveedor</th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    Importe
                  </th>
                  <th className="px-4 py-2.5 text-center font-medium">
                    Albarán
                  </th>
                  <th className="px-4 py-2.5 text-center font-medium">
                    Factura
                  </th>
                  <th className="px-4 py-2.5 font-medium">Lectura</th>
                </tr>
              </thead>
              <tbody>
                {traceQuery.data.rows.map((r) => (
                  <tr
                    key={r.orderId}
                    className="border-b border-gray-100 last:border-0"
                  >
                    <td className="px-4 py-2.5 font-mono text-xs">
                      {r.orderNumber}
                    </td>
                    <td className="px-4 py-2.5">{r.contactName}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatEur(r.amount)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {r.hasDeliveryNote ? 'SÍ' : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {r.hasInvoice ? 'SÍ' : '—'}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-xs ${
                        r.accrualAmount > 0 ? 'text-amber-700' : 'text-gray-500'
                      }`}
                    >
                      {r.reading}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-gray-200 bg-gray-50 text-sm">
                <tr>
                  <td className="px-4 py-2.5 font-semibold" colSpan={2}>
                    Provisión de albaranes recibidos sin facturar
                  </td>
                  <td
                    className="px-4 py-2.5 text-right font-bold tabular-nums text-amber-800"
                    colSpan={4}
                  >
                    {formatEur(traceQuery.data.totalAccrual)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {formOpen && (
        <OrderFormModal
          order={editing}
          projects={projectsQuery.data ?? []}
          contacts={contactsQuery.data ?? []}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false);
            invalidate();
          }}
        />
      )}

      <ConfirmDialog
        open={closing !== null}
        title={`Cerrar el pedido ${closing?.orderNumber ?? ''}`}
        description="Al cerrar el pedido se da por liquidado. No se podrá cerrar si queda material recibido sin facturar."
        confirmLabel="Cerrar pedido"
        loading={closeMutation.isPending}
        onCancel={() => setClosing(null)}
        onConfirm={() => closing && closeMutation.mutate(closing.id)}
      />
    </div>
  );
}
