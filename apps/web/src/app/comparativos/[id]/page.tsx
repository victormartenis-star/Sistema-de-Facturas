'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  COMPARATIVO_STATUS_LABELS,
  type ComparativoMatrizOfertaDto,
  type ComparativoStatus,
} from '@erp/shared';
import { ApiError, comparativosApi, contactsApi, formatEur } from '@/lib/api';
import { useToast } from '@/components/toast';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { IconCheck, IconTrash } from '@/components/icons';
import {
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

const STATUS_TONE: Record<ComparativoStatus, string> = {
  abierto: 'bg-sky-100 text-sky-700',
  adjudicado: 'bg-emerald-100 text-emerald-700',
  cancelado: 'bg-gray-200 text-gray-600',
};

/** Alta de una oferta: proveedor + un precio unitario por cada partida de la fase. */
function NewOfertaModal({
  open,
  partidas,
  saving,
  error,
  onSave,
  onClose,
}: {
  open: boolean;
  partidas: {
    budgetItemId: string;
    code: string;
    name: string;
    unit: string;
    targetQuantity: number;
    targetUnitPrice: number;
  }[];
  saving: boolean;
  error: Error | null;
  onSave: (v: {
    contactId: string;
    leadTimeDays: number | null;
    paymentTerms: string | null;
    lineas: { budgetItemId: string; unitPrice: number; quantity: number }[];
  }) => void;
  onClose: () => void;
}) {
  const [contactId, setContactId] = useState('');
  const [leadTimeDays, setLeadTimeDays] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [quantities, setQuantities] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setContactId('');
    setLeadTimeDays('');
    setPaymentTerms('');
    setPrices({});
    setQuantities({});
  }, [open]);

  const contactsQuery = useQuery({
    queryKey: ['contacts', '', 'proveedor'],
    queryFn: () => contactsApi.list('', 'proveedor'),
    enabled: open,
  });

  const fieldErrors = error instanceof ApiError ? error.fieldErrors : [];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const lineas = partidas
      .filter((p) => prices[p.budgetItemId]?.trim())
      .map((p) => ({
        budgetItemId: p.budgetItemId,
        unitPrice: Number(prices[p.budgetItemId].replace(',', '.')),
        quantity: quantities[p.budgetItemId]?.trim()
          ? Number(quantities[p.budgetItemId].replace(',', '.'))
          : p.targetQuantity,
      }));
    onSave({
      contactId,
      leadTimeDays: leadTimeDays.trim() ? Number(leadTimeDays) : null,
      paymentTerms: paymentTerms.trim() || null,
      lineas,
    });
  };

  return (
    <Modal open={open} title="Nueva oferta" wide onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="sm:col-span-1">
            <label className={labelCls} htmlFor="of-contact">
              Proveedor *
            </label>
            <select
              id="of-contact"
              className={selectCls}
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              required
            >
              <option value="">Selecciona…</option>
              {contactsQuery.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.legalName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="of-lead">
              Plazo (días)
            </label>
            <input
              id="of-lead"
              className={fieldCls}
              inputMode="numeric"
              value={leadTimeDays}
              onChange={(e) => setLeadTimeDays(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="of-terms">
              Condiciones de pago
            </label>
            <input
              id="of-terms"
              className={fieldCls}
              placeholder="30 días fin de mes"
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
            />
          </div>
        </div>

        <div>
          <p className={labelCls}>Precio por partida</p>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Partida</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Medición objetivo
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    Precio unitario ofertado
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    Medición ofertada
                  </th>
                </tr>
              </thead>
              <tbody>
                {partidas.map((p) => (
                  <tr key={p.budgetItemId} className="border-t border-gray-100">
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs text-gray-400">
                        {p.code}
                      </span>{' '}
                      {p.name}{' '}
                      <span className="text-xs text-gray-400">({p.unit})</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                      {p.targetQuantity} {p.unit}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        className={`${fieldCls} w-28 text-right`}
                        inputMode="decimal"
                        placeholder={p.targetUnitPrice.toString()}
                        value={prices[p.budgetItemId] ?? ''}
                        onChange={(e) =>
                          setPrices((s) => ({
                            ...s,
                            [p.budgetItemId]: e.target.value,
                          }))
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        className={`${fieldCls} w-24 text-right`}
                        inputMode="decimal"
                        placeholder={p.targetQuantity.toString()}
                        value={quantities[p.budgetItemId] ?? ''}
                        onChange={(e) =>
                          setQuantities((s) => ({
                            ...s,
                            [p.budgetItemId]: e.target.value,
                          }))
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            Deja el precio en blanco si el proveedor no cubre esa partida. Sin
            medición propia, se usa la del presupuesto.
          </p>
        </div>

        {error && fieldErrors.length === 0 && (
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
            {saving ? 'Guardando…' : 'Añadir oferta'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function ComparativoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const [ofertaModalOpen, setOfertaModalOpen] = useState(false);
  const [adjudicando, setAdjudicando] =
    useState<ComparativoMatrizOfertaDto | null>(null);

  const query = useQuery({
    queryKey: ['comparativo-matriz', id],
    queryFn: () => comparativosApi.matriz(id),
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['comparativo-matriz', id] });

  const addOfertaMutation = useMutation({
    mutationFn: (input: Parameters<typeof comparativosApi.addOferta>[1]) =>
      comparativosApi.addOferta(id, input),
    onSuccess: () => {
      toast('Oferta añadida');
      setOfertaModalOpen(false);
      invalidate();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const removeOfertaMutation = useMutation({
    mutationFn: (ofertaId: string) =>
      comparativosApi.removeOferta(id, ofertaId),
    onSuccess: () => {
      toast('Oferta eliminada');
      invalidate();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const adjudicarMutation = useMutation({
    mutationFn: (ofertaId: string) =>
      comparativosApi.adjudicar(id, { ofertaId }),
    onSuccess: () => {
      toast('Comparativo adjudicado: se ha generado el pedido borrador');
      setAdjudicando(null);
      invalidate();
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
    },
    onError: (e) => {
      toast(errText(e), 'error');
      setAdjudicando(null);
    },
  });

  if (query.isLoading) return <TableSkeleton />;
  if (query.isError) return <ErrorBanner message={errText(query.error)} />;
  if (!query.data) return null;

  const matriz = query.data;
  const abierto = matriz.status === 'abierto';

  return (
    <div>
      <PageHeader
        title={matriz.title}
        subtitle={`${matriz.phaseCode} · ${matriz.phaseName} — objetivo ${formatEur(matriz.targetTotal)}`}
      >
        <span
          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_TONE[matriz.status]}`}
        >
          {COMPARATIVO_STATUS_LABELS[matriz.status]}
        </span>
        <Link
          href="/comparativos"
          className="text-xs font-medium text-gray-500 hover:text-gray-800"
        >
          ← Comparativos
        </Link>
        {abierto && (
          <button
            className={btnPrimaryCls}
            onClick={() => setOfertaModalOpen(true)}
          >
            Añadir oferta
          </button>
        )}
      </PageHeader>

      {matriz.partidas.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
          Esta fase no tiene partidas de presupuesto — añade primero un
          presupuesto con partidas ligadas a esta fase.
        </p>
      )}

      {matriz.partidas.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60 text-left text-xs tracking-wide text-gray-500 uppercase">
                <th className="sticky left-0 bg-gray-50/95 px-4 py-3 font-medium">
                  Partida
                </th>
                <th className="px-4 py-3 text-right font-medium">Objetivo</th>
                {matriz.ofertas.map((o) => (
                  <th
                    key={o.ofertaId}
                    className={`px-4 py-3 text-right font-medium ${
                      o.ofertaId === matriz.cheapestOfertaId
                        ? 'bg-emerald-50 text-emerald-700'
                        : ''
                    }`}
                  >
                    {o.contactName}
                    {o.ofertaId === matriz.cheapestOfertaId && (
                      <span className="ml-1 inline-flex items-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                        más barata
                      </span>
                    )}
                    {o.isAwarded && (
                      <span className="ml-1 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                        adjudicada
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matriz.partidas.map((partida) => (
                <tr
                  key={partida.budgetItemId}
                  className="border-b border-gray-100 last:border-0"
                >
                  <td className="sticky left-0 bg-white px-4 py-2.5">
                    <span className="font-mono text-xs text-gray-400">
                      {partida.code}
                    </span>{' '}
                    {partida.name}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                    {formatEur(partida.targetTotal)}
                  </td>
                  {matriz.ofertas.map((o) => {
                    const celda = o.celdas.find(
                      (c) => c.budgetItemId === partida.budgetItemId,
                    );
                    return (
                      <td
                        key={o.ofertaId}
                        className={`px-4 py-2.5 text-right tabular-nums ${
                          o.ofertaId === matriz.cheapestOfertaId
                            ? 'bg-emerald-50/60'
                            : ''
                        }`}
                      >
                        {celda?.totalAmount === null ||
                        celda?.totalAmount === undefined ? (
                          <span className="text-gray-300">sin precio</span>
                        ) : (
                          formatEur(celda.totalAmount)
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-gray-200 bg-gray-50/60 text-sm">
              <tr>
                <td className="sticky left-0 bg-gray-50/95 px-4 py-3 font-semibold">
                  Total
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">
                  {formatEur(matriz.targetTotal)}
                </td>
                {matriz.ofertas.map((o) => (
                  <td
                    key={o.ofertaId}
                    className={`px-4 py-3 text-right font-semibold tabular-nums ${
                      o.ofertaId === matriz.cheapestOfertaId
                        ? 'bg-emerald-50 text-emerald-700'
                        : ''
                    }`}
                  >
                    {formatEur(o.totalAmount)}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="sticky left-0 bg-gray-50/95 px-4 py-2 text-xs text-gray-500">
                  Desviación vs. objetivo
                </td>
                <td className="px-4 py-2" />
                {matriz.ofertas.map((o) => (
                  <td
                    key={o.ofertaId}
                    className={`px-4 py-2 text-right text-xs tabular-nums ${
                      o.deviationVsTarget > 0
                        ? 'text-red-600'
                        : 'text-emerald-600'
                    }`}
                  >
                    {o.deviationVsTarget > 0 ? '+' : ''}
                    {formatEur(o.deviationVsTarget)}
                    {o.deviationVsTargetPct !== null &&
                      ` (${o.deviationVsTargetPct > 0 ? '+' : ''}${o.deviationVsTargetPct.toFixed(1)}%)`}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="sticky left-0 bg-gray-50/95 px-4 py-2 text-xs text-gray-500">
                  Plazo · condiciones
                </td>
                <td className="px-4 py-2" />
                {matriz.ofertas.map((o) => (
                  <td
                    key={o.ofertaId}
                    className="px-4 py-2 text-right text-xs text-gray-500"
                  >
                    {o.leadTimeDays !== null ? `${o.leadTimeDays} d` : '—'}
                    {o.paymentTerms ? ` · ${o.paymentTerms}` : ''}
                  </td>
                ))}
              </tr>
              {abierto && (
                <tr>
                  <td className="sticky left-0 bg-gray-50/95 px-4 py-3" />
                  <td className="px-4 py-3" />
                  {matriz.ofertas.map((o) => (
                    <td key={o.ofertaId} className="px-4 py-3 text-right">
                      <button
                        className="mr-2 inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-600"
                        onClick={() => setAdjudicando(o)}
                      >
                        <IconCheck size={12} /> Adjudicar
                      </button>
                      <button
                        className="text-xs text-gray-400 hover:text-red-600"
                        onClick={() => removeOfertaMutation.mutate(o.ofertaId)}
                        title="Quitar oferta"
                      >
                        <IconTrash size={13} />
                      </button>
                    </td>
                  ))}
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      )}

      <NewOfertaModal
        open={ofertaModalOpen}
        partidas={matriz.partidas}
        saving={addOfertaMutation.isPending}
        error={(addOfertaMutation.error as ApiError | null) ?? null}
        onSave={(v) => addOfertaMutation.mutate(v)}
        onClose={() => setOfertaModalOpen(false)}
      />

      <ConfirmDialog
        open={adjudicando !== null}
        title={`Adjudicar a ${adjudicando?.contactName ?? ''}`}
        description={`Se generará automáticamente un pedido borrador por ${
          adjudicando ? formatEur(adjudicando.totalAmount) : ''
        } y el comparativo quedará cerrado. Esta acción no se puede deshacer.`}
        confirmLabel="Adjudicar"
        loading={adjudicarMutation.isPending}
        onCancel={() => setAdjudicando(null)}
        onConfirm={() =>
          adjudicando && adjudicarMutation.mutate(adjudicando.ofertaId)
        }
      />
    </div>
  );
}
