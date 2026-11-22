'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  PAYMENT_INSTRUMENTS,
  PAYMENT_INSTRUMENT_LABELS,
  SETTLEMENT_STATE_LABELS,
  motivoLiquidacionInvalida,
  type MilestoneDto,
  type PaymentInstrument,
  type SettlementDto,
} from '@erp/shared';
import { formatDate, formatEur, treasuryApi } from '@/lib/api';
import { nuevoUuid } from '@/lib/api-error';
import { Autorizado } from '@/components/autorizado';
import { useAvisarError, useToast } from '@/components/toast';
import {
  ErrorBanner,
  Modal,
  TableSkeleton,
  btnGhostCls,
  btnPrimaryCls,
  fieldCls,
  labelCls,
} from '@/components/ui';

function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function aNumero(v: string): number {
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Cobros y pagos (totales o parciales) de un vencimiento: totales, historial
 * con anulación y alta de una liquidación. Envía la versión leída en
 * `If-Match` y una `Idempotency-Key` por intento de envío.
 */
export function LiquidacionesModal({
  vencimiento,
  onClose,
}: {
  vencimiento: MilestoneDto | null;
  onClose: () => void;
}) {
  const id = vencimiento?.id ?? null;
  const qc = useQueryClient();
  const toast = useToast();
  const avisarError = useAvisarError();
  const [importe, setImporte] = useState('');
  const [fecha, setFecha] = useState(hoyIso);
  const [cuenta, setCuenta] = useState('');
  const [instrumento, setInstrumento] = useState<PaymentInstrument | ''>('');
  const [referencia, setReferencia] = useState('');
  const [anulando, setAnulando] = useState<SettlementDto | null>(null);
  const [motivo, setMotivo] = useState('');
  const clave = useRef<string>(nuevoUuid());

  const detalle = useQuery({
    queryKey: ['milestone', id],
    queryFn: () => treasuryApi.milestoneDetail(id!),
    enabled: id !== null,
  });
  const cuentas = useQuery({
    queryKey: ['bank-accounts', 'activas'],
    queryFn: () => treasuryApi.listBankAccounts(true),
    enabled: id !== null,
  });

  const d = detalle.data;
  const pendiente = d ? Math.abs(d.pendingAmount) : 0;

  // Al abrir un vencimiento (o cambiar su saldo) se propone liquidar todo
  // el saldo vivo. Ajuste de estado durante el render, sin efecto.
  const firma = d ? `${d.id}:${d.pendingAmount}` : null;
  const [firmaPropuesta, setFirmaPropuesta] = useState<string | null>(null);
  if (firma !== null && firma !== firmaPropuesta) {
    setFirmaPropuesta(firma);
    setImporte(Math.abs(d!.pendingAmount).toFixed(2));
  }

  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: ['milestone', id] });
    void qc.invalidateQueries({ queryKey: ['milestones'] });
    void qc.invalidateQueries({ queryKey: ['cashflow'] });
    void qc.invalidateQueries({ queryKey: ['crossed-maturities'] });
    void qc.invalidateQueries({ queryKey: ['invoices'] });
  };

  const registrar = useMutation({
    mutationFn: () =>
      treasuryApi.settle(
        id!,
        {
          importe: aNumero(importe),
          fecha,
          bankAccountId: cuenta || null,
          paymentInstrument: instrumento || undefined,
          referencia: referencia.trim() || null,
        },
        d!.version,
        clave.current,
      ),
    onSuccess: (nuevo) => {
      clave.current = nuevoUuid();
      setReferencia('');
      toast(
        nuevo.settlementState === 'liquidado'
          ? 'Vencimiento liquidado del todo'
          : `Registrado. Pendiente: ${formatEur(Math.abs(nuevo.pendingAmount))}`,
      );
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });

  const anular = useMutation({
    mutationFn: (s: SettlementDto) =>
      treasuryApi.cancelSettlement(s.id, motivo.trim(), s.version),
    onSuccess: () => {
      toast('Liquidación anulada');
      setAnulando(null);
      setMotivo('');
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });

  const error =
    d && importe !== ''
      ? motivoLiquidacionInvalida({
          importe: d.amount,
          liquidado: d.settledAmount,
          cantidad: aNumero(importe),
          fecha,
          hoy: hoyIso(),
        })
      : null;
  const verbo = vencimiento?.direction === 'pago' ? 'pago' : 'cobro';

  return (
    <Modal
      open={vencimiento !== null}
      wide
      title={
        vencimiento
          ? `${verbo === 'cobro' ? 'Cobros' : 'Pagos'} · ${vencimiento.invoiceNumber} · ${vencimiento.contactName}`
          : ''
      }
      onClose={onClose}
    >
      {detalle.isError && (
        <ErrorBanner message={(detalle.error as Error).message} />
      )}
      {detalle.isLoading && <TableSkeleton rows={3} />}
      {d && (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-gray-500">Importe</dt>
              <dd className="font-semibold tabular-nums">
                {formatEur(d.amount)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Liquidado</dt>
              <dd className="font-semibold tabular-nums text-emerald-700">
                {formatEur(d.settledAmount)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Pendiente</dt>
              <dd className="font-semibold tabular-nums text-amber-700">
                {formatEur(d.pendingAmount)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Estado</dt>
              <dd className="font-semibold">
                {SETTLEMENT_STATE_LABELS[d.settlementState]}
              </dd>
            </div>
          </dl>

          <h3 className="mb-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
            Historial
          </h3>
          {d.settlements.length === 0 ? (
            <p className="mb-4 text-sm text-gray-500">
              Sin {verbo}s registrados.
            </p>
          ) : (
            <table className="mb-4 w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr>
                  <th className="py-1">Fecha</th>
                  <th className="py-1">Instrumento</th>
                  <th className="py-1">Cuenta / referencia</th>
                  <th className="py-1 text-right">Importe</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.settlements.map((s) => (
                  <tr
                    key={s.id}
                    className={`border-t border-gray-100 ${s.status === 'anulada' ? 'text-gray-400 line-through' : ''}`}
                  >
                    <td className="py-1.5">{formatDate(s.settledOn)}</td>
                    <td className="py-1.5">
                      {PAYMENT_INSTRUMENT_LABELS[s.paymentInstrument]}
                    </td>
                    <td className="py-1.5 text-gray-600">
                      {[s.bankAccountName, s.reference]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                      {s.status === 'anulada' && s.reversalReason && (
                        <span className="ml-1 no-underline">
                          (anulada: {s.reversalReason})
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatEur(s.amount)}
                    </td>
                    <td className="py-1.5 text-right">
                      {s.status === 'vigente' && (
                        <Autorizado accion="anular">
                          <button
                            type="button"
                            className={`${btnGhostCls} text-xs`}
                            onClick={() => {
                              setAnulando(s);
                              setMotivo('');
                            }}
                          >
                            Anular
                          </button>
                        </Autorizado>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {anulando && (
            <form
              className="mb-4 flex flex-wrap items-end gap-2 rounded-lg bg-red-50 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (anular.isPending || motivo.trim().length < 3) return;
                anular.mutate(anulando);
              }}
            >
              <div className="min-w-48 flex-1">
                <label className={labelCls} htmlFor="motivo-anular-liq">
                  Motivo de la anulación de {formatEur(anulando.amount)}
                </label>
                <input
                  id="motivo-anular-liq"
                  className={fieldCls}
                  value={motivo}
                  maxLength={240}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="p. ej. transferencia devuelta"
                  required
                />
              </div>
              <button
                type="button"
                className={btnGhostCls}
                onClick={() => setAnulando(null)}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className={btnPrimaryCls}
                disabled={anular.isPending || motivo.trim().length < 3}
              >
                {anular.isPending ? 'Anulando…' : 'Anular'}
              </button>
            </form>
          )}

          {pendiente > 0 && (
            <Autorizado accion="cambiarEstado">
              <form
                className="rounded-lg border border-gray-200 p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (registrar.isPending || error) return;
                  registrar.mutate();
                }}
              >
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
                  Registrar {verbo}
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelCls} htmlFor="liq-importe">
                      Importe (máx. {formatEur(pendiente)})
                    </label>
                    <input
                      id="liq-importe"
                      className={`${fieldCls} text-right tabular-nums`}
                      inputMode="decimal"
                      value={importe}
                      onChange={(e) => setImporte(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="liq-fecha">
                      Fecha
                    </label>
                    <input
                      id="liq-fecha"
                      type="date"
                      className={fieldCls}
                      value={fecha}
                      max={hoyIso()}
                      onChange={(e) => setFecha(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="liq-cuenta">
                      Cuenta bancaria
                    </label>
                    <select
                      id="liq-cuenta"
                      className={fieldCls}
                      value={cuenta}
                      onChange={(e) => setCuenta(e.target.value)}
                    >
                      <option value="">Sin indicar</option>
                      {cuentas.data?.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="liq-instrumento">
                      Instrumento
                    </label>
                    <select
                      id="liq-instrumento"
                      className={fieldCls}
                      value={instrumento}
                      onChange={(e) =>
                        setInstrumento(e.target.value as PaymentInstrument | '')
                      }
                    >
                      <option value="">
                        El del vencimiento (
                        {PAYMENT_INSTRUMENT_LABELS[d.paymentInstrument]})
                      </option>
                      {PAYMENT_INSTRUMENTS.map((pi) => (
                        <option key={pi} value={pi}>
                          {PAYMENT_INSTRUMENT_LABELS[pi]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelCls} htmlFor="liq-referencia">
                      Referencia (opcional)
                    </label>
                    <input
                      id="liq-referencia"
                      className={fieldCls}
                      value={referencia}
                      maxLength={80}
                      onChange={(e) => setReferencia(e.target.value)}
                      placeholder="Nº de transferencia, pagaré…"
                    />
                  </div>
                </div>
                {error && (
                  <p className="mt-2 text-xs text-red-700">{error.message}</p>
                )}
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    className={btnGhostCls}
                    onClick={onClose}
                  >
                    Cerrar
                  </button>
                  <button
                    type="submit"
                    className={btnPrimaryCls}
                    disabled={
                      registrar.isPending || error !== null || importe === ''
                    }
                  >
                    {registrar.isPending
                      ? 'Registrando…'
                      : `Registrar ${verbo}`}
                  </button>
                </div>
              </form>
            </Autorizado>
          )}
        </>
      )}
    </Modal>
  );
}
