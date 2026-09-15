'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { REAL_ESTATE_RESERVATION_STATUS_LABELS } from '@erp/shared';
import { contactsApi, formatDate, formatEur, realEstateApi } from '@/lib/api';
import { useToast } from '@/components/toast';
import { IconCheck, IconKey, IconPlus } from '@/components/icons';
import {
  Modal,
  btnGhostCls,
  btnPrimaryCls,
  fieldCls,
  labelCls,
  selectCls,
} from '@/components/ui';

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

export function UnitDetailPanel({ unitId }: { unitId: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [reserveOpen, setReserveOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [handoverOpen, setHandoverOpen] = useState(false);

  const unitQuery = useQuery({
    queryKey: ['real-estate-unit', unitId],
    queryFn: () => realEstateApi.getUnit(unitId),
  });
  const reservationsQuery = useQuery({
    queryKey: ['real-estate-reservations', unitId],
    queryFn: () => realEstateApi.listReservations(unitId),
  });
  const reservation = reservationsQuery.data?.find(
    (r) => r.status !== 'cancelada',
  );

  const paymentsQuery = useQuery({
    queryKey: ['real-estate-payments', reservation?.id],
    queryFn: () => realEstateApi.listPayments(reservation!.id),
    enabled: !!reservation,
  });
  const handoverQuery = useQuery({
    queryKey: ['real-estate-handover', reservation?.id],
    queryFn: () => realEstateApi.getKeyHandover(reservation!.id),
    enabled: !!reservation && reservation.status === 'escriturada',
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['real-estate-unit', unitId] });
    queryClient.invalidateQueries({ queryKey: ['real-estate-units'] });
    queryClient.invalidateQueries({
      queryKey: ['real-estate-reservations', unitId],
    });
    queryClient.invalidateQueries({
      queryKey: ['real-estate-commercialization'],
    });
    if (reservation) {
      queryClient.invalidateQueries({
        queryKey: ['real-estate-payments', reservation.id],
      });
      queryClient.invalidateQueries({
        queryKey: ['real-estate-handover', reservation.id],
      });
    }
  };

  const contractMutation = useMutation({
    mutationFn: (contractDate: string) =>
      realEstateApi.signContract(reservation!.id, { contractDate }),
    onSuccess: () => {
      toast('Contrato privado firmado', 'success');
      invalidate();
    },
    onError: (e) => toast(errText(e), 'error'),
  });
  const deedMutation = useMutation({
    mutationFn: (deedDate: string) =>
      realEstateApi.signDeed(reservation!.id, { deedDate }),
    onSuccess: () => {
      toast('Escritura registrada', 'success');
      invalidate();
    },
    onError: (e) => toast(errText(e), 'error'),
  });
  const cancelMutation = useMutation({
    mutationFn: () => realEstateApi.cancelReservation(reservation!.id, {}),
    onSuccess: () => {
      toast('Reserva cancelada', 'success');
      invalidate();
    },
    onError: (e) => toast(errText(e), 'error'),
  });
  const payMutation = useMutation({
    mutationFn: (id: string) => realEstateApi.payPayment(id),
    onSuccess: () => {
      toast('Cobro registrado', 'success');
      invalidate();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const unit = unitQuery.data;
  if (!unit) return null;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{unit.code}</h2>
            <p className="text-sm text-gray-500">{formatEur(unit.salePrice)}</p>
          </div>
          {unit.status === 'disponible' && (
            <button
              className={btnPrimaryCls}
              onClick={() => setReserveOpen(true)}
            >
              <IconPlus size={14} /> Reservar
            </button>
          )}
        </div>
      </div>

      {reservation && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              Reserva — {reservation.buyerName}
            </h3>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
              {REAL_ESTATE_RESERVATION_STATUS_LABELS[reservation.status]}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat
              label="Fecha reserva"
              value={formatDate(reservation.reservationDate)}
            />
            <Stat
              label="Precio pactado"
              value={formatEur(reservation.agreedPrice)}
            />
            <Stat label="Señal" value={formatEur(reservation.signalAmount)} />
            <Stat
              label="Contrato"
              value={
                reservation.contractDate
                  ? formatDate(reservation.contractDate)
                  : '—'
              }
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {reservation.status === 'reservada' && (
              <>
                <button
                  className={btnGhostCls}
                  onClick={() => {
                    const date = prompt(
                      'Fecha del contrato privado (AAAA-MM-DD)',
                    );
                    if (date) contractMutation.mutate(date);
                  }}
                >
                  Firmar contrato privado
                </button>
                <button
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                  onClick={() => cancelMutation.mutate()}
                >
                  Cancelar reserva
                </button>
              </>
            )}
            {reservation.status === 'contrato_firmado' && (
              <button
                className={btnPrimaryCls}
                onClick={() => {
                  const date = prompt('Fecha de escritura (AAAA-MM-DD)');
                  if (date) deedMutation.mutate(date);
                }}
              >
                Escriturar
              </button>
            )}
            {reservation.status === 'escriturada' && !handoverQuery.data && (
              <button
                className={btnPrimaryCls}
                onClick={() => setHandoverOpen(true)}
              >
                <IconKey size={14} /> Entregar llaves
              </button>
            )}
            {handoverQuery.data && (
              <p className="flex items-center gap-1.5 text-xs text-emerald-600">
                <IconCheck size={13} /> Llaves entregadas el{' '}
                {formatDate(handoverQuery.data.handoverDate)}
              </p>
            )}
          </div>

          {/* Plan de cobros */}
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs font-semibold tracking-wide text-gray-500 uppercase">
                Plan de cobros
              </h4>
              <button
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-amber-600 hover:bg-amber-50"
                onClick={() => setPaymentOpen(true)}
              >
                <IconPlus size={12} /> Hito
              </button>
            </div>
            <div className="divide-y divide-gray-100">
              {(paymentsQuery.data ?? []).map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <span>
                    {p.concept}{' '}
                    <span className="text-xs text-gray-400">
                      ({formatDate(p.dueDate)})
                    </span>
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums">{formatEur(p.amount)}</span>
                    {p.status === 'previsto' ? (
                      <button
                        className="rounded-md px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50"
                        onClick={() => payMutation.mutate(p.id)}
                      >
                        Cobrar
                      </button>
                    ) : (
                      <span className="text-xs text-emerald-600">Cobrado</span>
                    )}
                  </div>
                </div>
              ))}
              {(paymentsQuery.data ?? []).length === 0 && (
                <p className="py-2 text-sm text-gray-400">Sin hitos todavía.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {reservation && (
        <>
          <PaymentModal
            open={paymentOpen}
            onClose={() => setPaymentOpen(false)}
            reservationId={reservation.id}
            onDone={invalidate}
          />
          <HandoverModal
            open={handoverOpen}
            onClose={() => setHandoverOpen(false)}
            reservationId={reservation.id}
            onDone={invalidate}
          />
        </>
      )}
      <ReserveModal
        open={reserveOpen}
        onClose={() => setReserveOpen(false)}
        unitId={unitId}
        defaultPrice={unit.salePrice}
        onDone={invalidate}
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

function ReserveModal({
  open,
  onClose,
  unitId,
  defaultPrice,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  unitId: string;
  defaultPrice: number;
  onDone: () => void;
}) {
  const toast = useToast();
  const [buyerContactId, setBuyerContactId] = useState('');
  const [agreedPrice, setAgreedPrice] = useState(String(defaultPrice));
  const [signalAmount, setSignalAmount] = useState('0');
  const [reservationDate, setReservationDate] = useState(
    new Date().toISOString().slice(0, 10),
  );

  const contactsQuery = useQuery({
    queryKey: ['contacts-for-real-estate'],
    queryFn: () => contactsApi.list('', ''),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () =>
      realEstateApi.createReservation({
        unitId,
        buyerContactId,
        reservationDate,
        agreedPrice: Number(agreedPrice) || 0,
        signalAmount: Number(signalAmount) || 0,
      }),
    onSuccess: () => {
      toast('Unidad reservada', 'success');
      onDone();
      onClose();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Reservar unidad">
      <div className="space-y-3">
        <div className={fieldCls}>
          <label className={labelCls}>Comprador</label>
          <select
            className={selectCls}
            value={buyerContactId}
            onChange={(e) => setBuyerContactId(e.target.value)}
          >
            <option value="">Selecciona…</option>
            {contactsQuery.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.legalName}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className={fieldCls}>
            <label className={labelCls}>Precio pactado</label>
            <input
              type="number"
              step="0.01"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={agreedPrice}
              onChange={(e) => setAgreedPrice(e.target.value)}
            />
          </div>
          <div className={fieldCls}>
            <label className={labelCls}>Señal</label>
            <input
              type="number"
              step="0.01"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={signalAmount}
              onChange={(e) => setSignalAmount(e.target.value)}
            />
          </div>
        </div>
        <div className={fieldCls}>
          <label className={labelCls}>Fecha de reserva</label>
          <input
            type="date"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={reservationDate}
            onChange={(e) => setReservationDate(e.target.value)}
          />
        </div>
        <button
          className={`${btnPrimaryCls} w-full justify-center`}
          disabled={!buyerContactId || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Reservar
        </button>
      </div>
    </Modal>
  );
}

function PaymentModal({
  open,
  onClose,
  reservationId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  reservationId: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const [concept, setConcept] = useState('');
  const [amount, setAmount] = useState('0');
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));

  const mutation = useMutation({
    mutationFn: () =>
      realEstateApi.createPayment(reservationId, {
        concept: concept.trim(),
        dueDate,
        amount: Number(amount) || 0,
      }),
    onSuccess: () => {
      toast('Hito añadido', 'success');
      onDone();
      onClose();
      setConcept('');
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Nuevo hito de cobro">
      <div className="space-y-3">
        <div className={fieldCls}>
          <label className={labelCls}>Concepto</label>
          <input
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder="Contrato privado 20%, Aplazado, Escritura…"
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className={fieldCls}>
            <label className={labelCls}>Importe</label>
            <input
              type="number"
              step="0.01"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className={fieldCls}>
            <label className={labelCls}>Fecha</label>
            <input
              type="date"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
        </div>
        <button
          className={`${btnPrimaryCls} w-full justify-center`}
          disabled={!concept.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Añadir
        </button>
      </div>
    </Modal>
  );
}

function HandoverModal({
  open,
  onClose,
  reservationId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  reservationId: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const [handoverDate, setHandoverDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      realEstateApi.createKeyHandover(reservationId, {
        handoverDate,
        notes: notes || null,
      }),
    onSuccess: () => {
      toast('Llaves entregadas', 'success');
      onDone();
      onClose();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Acta de entrega de llaves">
      <div className="space-y-3">
        <div className={fieldCls}>
          <label className={labelCls}>Fecha de entrega</label>
          <input
            type="date"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={handoverDate}
            onChange={(e) => setHandoverDate(e.target.value)}
          />
        </div>
        <div className={fieldCls}>
          <label className={labelCls}>Notas</label>
          <textarea
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <button
          className={`${btnPrimaryCls} w-full justify-center`}
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Confirmar entrega
        </button>
      </div>
    </Modal>
  );
}
