'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  TIPO_CONCILIACION_LABELS,
  type BankTransactionDto,
  type ConciliacionInput,
  type SugerenciaConciliacion,
  type SugerenciasMovimientoDto,
} from '@erp/shared';
import {
  bancaApi,
  bankReconciliationApi,
  formatDate,
  formatEur,
  treasuryApi,
} from '@/lib/api';
import { nuevoUuid } from '@/lib/api-error';
import { crearGuardaEnvio } from '@/lib/envio-unico';
import { usePermisos } from '@/lib/permisos';
import { Autorizado } from '@/components/autorizado';
import { useAvisarError, useToast } from '@/components/toast';
import {
  ErrorBanner,
  PageHeader,
  btnGhostCls,
  btnPrimaryCls,
  inputCls,
  selectCls,
} from '@/components/ui';

const CONFIANZA_CLS: Record<SugerenciaConciliacion['confianza'], string> = {
  alta: 'bg-emerald-50 text-emerald-700',
  media: 'bg-amber-50 text-amber-700',
  baja: 'bg-gray-100 text-gray-600',
};

function useRefrescar() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['conciliacion-asistida'] });
    void qc.invalidateQueries({ queryKey: ['treasury'] });
    void qc.invalidateQueries({ queryKey: ['remesas'] });
    void qc.invalidateQueries({ queryKey: ['talones'] });
  };
}

/**
 * Conciliación asistida: sugerencias puntuadas contra vencimientos, cobros y
 * pagos ya registrados, remesas SEPA, devoluciones y talones; comisión
 * bancaria (6260 a 5720) y desconciliación con If-Match.
 */
export default function ConciliacionAsistidaPage() {
  const [cuentaId, setCuentaId] = useState('');
  const cuentas = useQuery({
    queryKey: ['treasury', 'cuentas', 'activas'],
    queryFn: () => treasuryApi.listBankAccounts(true),
  });
  return (
    <div>
      <PageHeader
        title="Conciliación asistida"
        subtitle="Cada movimiento del extracto con sus candidatos puntuados por importe, fecha, referencia y tercero. La comisión que retiene el banco se contabiliza aparte."
      >
        <select
          className={selectCls}
          value={cuentaId}
          onChange={(e) => setCuentaId(e.target.value)}
          aria-label="Cuenta bancaria"
        >
          <option value="">Cuenta…</option>
          {(cuentas.data ?? [])
            .filter((c) => c.kind === 'banco')
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </PageHeader>
      {cuentaId ? (
        <>
          <Pendientes key={`p-${cuentaId}`} cuentaId={cuentaId} />
          <Conciliados key={`c-${cuentaId}`} cuentaId={cuentaId} />
        </>
      ) : (
        <p className="text-sm text-gray-500">
          Elige una cuenta. El extracto se importa en Conciliación bancaria.
        </p>
      )}
    </div>
  );
}

function Pendientes({ cuentaId }: { cuentaId: string }) {
  const datos = useQuery({
    queryKey: ['conciliacion-asistida', 'sugerencias', cuentaId],
    queryFn: () => bancaApi.sugerencias(cuentaId),
  });
  const movimientos = useQuery({
    queryKey: ['conciliacion-asistida', 'pendientes', cuentaId],
    queryFn: () => bankReconciliationApi.list(cuentaId, false),
  });
  const version = (id: string) =>
    movimientos.data?.find((m) => m.id === id)?.version;
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-semibold">Movimientos pendientes</h2>
      {datos.isError && (
        <ErrorBanner message={(datos.error as Error).message} />
      )}
      <div className="space-y-2">
        {(datos.data ?? []).map((m) => (
          <Movimiento
            key={m.transactionId}
            m={m}
            version={version(m.transactionId)}
          />
        ))}
        {datos.data?.length === 0 && (
          <p className="text-sm text-gray-500">
            No hay movimientos pendientes.
          </p>
        )}
      </div>
    </section>
  );
}

function Movimiento({
  m,
  version,
}: {
  m: SugerenciasMovimientoDto;
  version: number | undefined;
}) {
  const [comision, setComision] = useState('');
  const clave = useRef(nuevoUuid());
  const [guarda] = useState(crearGuardaEnvio);
  const { can } = usePermisos();
  const toast = useToast();
  const avisarError = useAvisarError();
  const refrescar = useRefrescar();
  const conciliar = useMutation({
    mutationFn: (input: ConciliacionInput) =>
      bancaApi.conciliar(m.transactionId, input, version, clave.current),
    onSuccess: (r) => {
      clave.current = nuevoUuid();
      toast(
        `Conciliado (${TIPO_CONCILIACION_LABELS[r.reconciliationKind ?? 'vencimiento']})${r.feeAmount ? ` con comisión ${formatEur(r.feeAmount)}` : ''}`,
      );
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  useEffect(() => {
    if (!conciliar.isPending) guarda.liberar();
  }, [conciliar.isPending, guarda]);
  const lanzar = (input: ConciliacionInput) => {
    if (
      !can('cambiarEstado', 'banca') ||
      conciliar.isPending ||
      !guarda.intentar()
    )
      return;
    conciliar.mutate(input);
  };
  const comisionManual =
    comision.trim() === '' ? undefined : Number(comision.replace(',', '.'));

  return (
    <div className="rounded-xl border bg-white p-3 text-sm shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p>
          <span className="tabular-nums">{formatDate(m.fecha)}</span> ·{' '}
          {m.concepto} ·{' '}
          <span
            className={`font-semibold tabular-nums ${m.importe < 0 ? 'text-red-700' : 'text-emerald-700'}`}
          >
            {formatEur(m.importe)}
          </span>
        </p>
        <Autorizado accion="cambiarEstado" recurso="banca">
          <div className="flex items-center gap-2">
            <input
              className={`${inputCls} w-28`}
              placeholder="Comisión"
              inputMode="decimal"
              value={comision}
              onChange={(e) => setComision(e.target.value)}
              aria-label="Comisión bancaria"
            />
            {m.importe < 0 && (
              <button
                type="button"
                className={btnGhostCls}
                disabled={conciliar.isPending}
                onClick={() => lanzar({ tipo: 'comision' })}
              >
                Es comisión o gasto
              </button>
            )}
          </div>
        </Autorizado>
      </div>
      {m.sugerencias.length === 0 ? (
        <p className="mt-1 text-xs text-gray-500">Sin candidatos.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {m.sugerencias.map((s) => (
            <li
              key={`${s.tipo}-${s.id}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded bg-gray-50 px-2 py-1"
            >
              <span>
                <span
                  className={`mr-2 rounded px-1.5 py-0.5 text-xs ${CONFIANZA_CLS[s.confianza]}`}
                >
                  {s.puntuacion} · {s.confianza}
                </span>
                {s.descripcion} · {formatEur(s.importe)} ·{' '}
                <span className="text-xs text-gray-500">
                  {s.motivos.join(', ')}
                </span>
              </span>
              <Autorizado accion="cambiarEstado" recurso="banca">
                <button
                  type="button"
                  className={btnPrimaryCls}
                  disabled={conciliar.isPending}
                  onClick={() =>
                    lanzar({
                      tipo: s.tipo,
                      id: s.id,
                      comision:
                        comisionManual ??
                        (s.comision > 0 ? s.comision : undefined),
                    })
                  }
                >
                  Conciliar
                </button>
              </Autorizado>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Conciliados({ cuentaId }: { cuentaId: string }) {
  const lista = useQuery({
    queryKey: ['conciliacion-asistida', 'conciliados', cuentaId],
    queryFn: () => bankReconciliationApi.list(cuentaId, true),
  });
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">Conciliados</h2>
      <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Concepto</th>
              <th className="px-3 py-2 text-right">Importe</th>
              <th className="px-3 py-2">Con</th>
              <th className="px-3 py-2 text-right">Comisión</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {(lista.data ?? []).map((t) => (
              <Conciliado key={t.id} t={t} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Conciliado({ t }: { t: BankTransactionDto }) {
  const [anularLiq, setAnularLiq] = useState(false);
  const clave = useRef(nuevoUuid());
  const [guarda] = useState(crearGuardaEnvio);
  const { can } = usePermisos();
  const toast = useToast();
  const avisarError = useAvisarError();
  const refrescar = useRefrescar();
  const desconciliar = useMutation({
    mutationFn: () =>
      bancaApi.desconciliar(
        t.id,
        {
          anularLiquidacion: anularLiq,
          motivo: 'Desconciliado desde la conciliación asistida',
        },
        t.version,
        clave.current,
      ),
    onSuccess: () => {
      clave.current = nuevoUuid();
      toast(
        anularLiq ? 'Desconciliado y cobro o pago anulado' : 'Desconciliado',
      );
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  useEffect(() => {
    if (!desconciliar.isPending) guarda.liberar();
  }, [desconciliar.isPending, guarda]);
  const tipo = t.reconciliationKind ?? 'vencimiento';
  return (
    <tr className="border-t border-gray-100">
      <td className="px-3 py-1.5 tabular-nums">
        {formatDate(t.transactionDate)}
      </td>
      <td className="px-3 py-1.5">{t.concept}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">
        {formatEur(t.amount)}
      </td>
      <td className="px-3 py-1.5 text-xs">{TIPO_CONCILIACION_LABELS[tipo]}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">
        {t.feeAmount ? formatEur(t.feeAmount) : '—'}
      </td>
      <td className="px-3 py-1.5 text-right">
        <Autorizado accion="anular" recurso="banca">
          {tipo === 'vencimiento' && (
            <label className="mr-2 text-xs">
              <input
                type="checkbox"
                checked={anularLiq}
                onChange={(e) => setAnularLiq(e.target.checked)}
              />{' '}
              anular cobro/pago
            </label>
          )}
          <button
            type="button"
            className={btnGhostCls}
            disabled={desconciliar.isPending}
            onClick={() => {
              if (
                !can('anular', 'banca') ||
                desconciliar.isPending ||
                !guarda.intentar()
              )
                return;
              desconciliar.mutate();
            }}
          >
            Desconciliar
          </button>
        </Autorizado>
      </td>
    </tr>
  );
}
