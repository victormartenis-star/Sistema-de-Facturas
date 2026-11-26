'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  DIRECCION_TALON_LABELS,
  ESTADO_TALON_LABELS,
  TALON_TRANSITIONS,
  type DireccionTalon,
  type EstadoTalon,
  type TalonAccionInput,
  type TalonDto,
} from '@erp/shared';
import { formatDate, formatEur, talonesApi, treasuryApi } from '@/lib/api';
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

const hoy = () => new Date().toISOString().slice(0, 10);
const num = (s: string) => Number(s.trim().replace(',', '.'));

type Accion = TalonAccionInput['accion'];
const ACCIONES: {
  accion: Accion;
  destino: EstadoTalon;
  texto: string;
  motivo: boolean;
}[] = [
  {
    accion: 'entregar',
    destino: 'entregado',
    texto: 'Entregar',
    motivo: false,
  },
  { accion: 'cobrar', destino: 'cobrado', texto: 'Cobrado', motivo: false },
  { accion: 'anular', destino: 'anulado', texto: 'Anular', motivo: true },
  { accion: 'detener', destino: 'detenido', texto: 'Detener', motivo: true },
  { accion: 'devolver', destino: 'devuelto', texto: 'Devuelto', motivo: true },
];

function useRefrescar() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['talones'] });
    void qc.invalidateQueries({ queryKey: ['treasury'] });
    void qc.invalidateQueries({ queryKey: ['contabilidad'] });
  };
}

export default function TalonesPage() {
  return (
    <div>
      <PageHeader
        title="Talones y cheques"
        subtitle="Talonarios por cuenta, talones a proveedores y subcontratas y cheques de clientes: liquidan el vencimiento contra 5729 (en tránsito) hasta que el banco los compensa."
      />
      <Talonarios />
      <Talones />
    </div>
  );
}

function Talonarios() {
  const [cuenta, setCuenta] = useState('');
  const [prefijo, setPrefijo] = useState('');
  const [primero, setPrimero] = useState('');
  const [ultimo, setUltimo] = useState('');
  const clave = useRef(nuevoUuid());
  const [guarda] = useState(crearGuardaEnvio);
  const { can } = usePermisos();
  const toast = useToast();
  const avisarError = useAvisarError();
  const refrescar = useRefrescar();
  const cuentas = useQuery({
    queryKey: ['treasury', 'cuentas', 'talones'],
    queryFn: () => treasuryApi.listBankAccounts(true),
  });
  const lista = useQuery({
    queryKey: ['talones', 'talonarios'],
    queryFn: () => talonesApi.talonarios(),
  });
  const crear = useMutation({
    mutationFn: () =>
      talonesApi.crearTalonario(
        {
          bankAccountId: cuenta,
          prefijo,
          primero: Number(primero),
          ultimo: Number(ultimo),
        },
        clave.current,
      ),
    onSuccess: (t) => {
      clave.current = nuevoUuid();
      toast(`Talonario ${t.prefijo}${t.primero}–${t.ultimo} dado de alta`);
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const anular = useMutation({
    mutationFn: (t: { id: string; version: number }) =>
      talonesApi.anularTalonario(t.id, t.version),
    onSuccess: () => {
      toast('Talonario anulado');
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const ocupado = crear.isPending || anular.isPending;
  useEffect(() => {
    if (!ocupado) guarda.liberar();
  }, [ocupado, guarda]);
  const valido =
    cuenta && Number(primero) >= 1 && Number(ultimo) >= Number(primero);

  return (
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-semibold">Talonarios</h2>
      <Autorizado accion="crear" recurso="talon">
        <form
          className="mb-3 flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              !can('crear', 'talon') ||
              !valido ||
              ocupado ||
              !guarda.intentar()
            )
              return;
            crear.mutate();
          }}
        >
          <select
            className={selectCls}
            value={cuenta}
            onChange={(e) => setCuenta(e.target.value)}
            aria-label="Cuenta bancaria"
          >
            <option value="">Cuenta…</option>
            {(cuentas.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            className={`${inputCls} w-24`}
            placeholder="Prefijo"
            value={prefijo}
            onChange={(e) => setPrefijo(e.target.value)}
            aria-label="Prefijo"
          />
          <input
            className={`${inputCls} w-24`}
            placeholder="Del nº"
            inputMode="numeric"
            value={primero}
            onChange={(e) => setPrimero(e.target.value)}
            aria-label="Primer número"
          />
          <input
            className={`${inputCls} w-24`}
            placeholder="Al nº"
            inputMode="numeric"
            value={ultimo}
            onChange={(e) => setUltimo(e.target.value)}
            aria-label="Último número"
          />
          <button
            type="submit"
            className={btnPrimaryCls}
            disabled={!valido || ocupado}
          >
            Alta de talonario
          </button>
        </form>
      </Autorizado>
      {lista.isError && (
        <ErrorBanner message={(lista.error as Error).message} />
      )}
      <ul className="text-sm">
        {(lista.data ?? []).map((t) => (
          <li
            key={t.id}
            className="flex items-center justify-between border-b border-gray-100 py-1"
          >
            <span>
              {t.bankAccountName} · {t.prefijo}
              {t.primero}–{t.ultimo} · siguiente {t.siguiente} · {t.disponibles}{' '}
              disponibles
              <span className="ml-2 text-xs text-gray-500">{t.estado}</span>
            </span>
            {t.estado === 'activo' && (
              <Autorizado accion="anular" recurso="talon">
                <button
                  type="button"
                  className={btnGhostCls}
                  disabled={ocupado}
                  onClick={() => {
                    if (
                      !can('anular', 'talon') ||
                      ocupado ||
                      !guarda.intentar()
                    )
                      return;
                    anular.mutate(t);
                  }}
                >
                  Anular
                </button>
              </Autorizado>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Talones() {
  const [direccion, setDireccion] = useState<DireccionTalon>('emitido');
  const [vencimiento, setVencimiento] = useState('');
  const [importe, setImporte] = useState('');
  const [emision, setEmision] = useState(hoy);
  const [pago, setPago] = useState('');
  const [talonario, setTalonario] = useState('');
  const [cuenta, setCuenta] = useState('');
  const [numero, setNumero] = useState('');
  const [fechaAccion, setFechaAccion] = useState(hoy);
  const [motivo, setMotivo] = useState('');
  const clave = useRef(nuevoUuid());
  const [guarda] = useState(crearGuardaEnvio);
  const { can } = usePermisos();
  const toast = useToast();
  const avisarError = useAvisarError();
  const refrescar = useRefrescar();
  const talonarios = useQuery({
    queryKey: ['talones', 'talonarios'],
    queryFn: () => talonesApi.talonarios(),
  });
  const cuentas = useQuery({
    queryKey: ['treasury', 'cuentas', 'talones'],
    queryFn: () => treasuryApi.listBankAccounts(true),
  });
  const vencimientos = useQuery({
    queryKey: ['treasury', 'milestones', 'talones', direccion],
    queryFn: () =>
      treasuryApi.milestones({
        direction: direccion === 'emitido' ? 'pago' : 'cobro',
        liquidacion: 'pendiente',
      }),
  });
  const lista = useQuery({
    queryKey: ['talones', 'lista'],
    queryFn: () => talonesApi.talones(),
  });
  const emitir = useMutation({
    mutationFn: () =>
      talonesApi.emitir(
        {
          direccion,
          vencimientoId: vencimiento,
          importe: num(importe),
          fechaEmision: emision,
          fechaVencimiento: pago || null,
          ...(direccion === 'emitido'
            ? { talonarioId: talonario }
            : { bankAccountId: cuenta, numero }),
        },
        clave.current,
      ),
    onSuccess: (t) => {
      clave.current = nuevoUuid();
      setVencimiento('');
      setImporte('');
      setNumero('');
      toast(`Talón ${t.numero} registrado por ${formatEur(t.importe)}`);
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const accion = useMutation({
    mutationFn: ({ t, a }: { t: TalonDto; a: Accion }) =>
      talonesApi.accion(
        t.id,
        {
          accion: a,
          fecha: fechaAccion,
          ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
        },
        t.version,
        nuevoUuid(),
      ),
    onSuccess: (t) => {
      setMotivo('');
      toast(`Talón ${t.numero}: ${ESTADO_TALON_LABELS[t.estado]}`);
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const ocupado = emitir.isPending || accion.isPending;
  useEffect(() => {
    if (!ocupado) guarda.liberar();
  }, [ocupado, guarda]);
  const valido =
    vencimiento !== '' &&
    num(importe) > 0 &&
    (direccion === 'emitido'
      ? talonario !== ''
      : cuenta !== '' && numero.trim() !== '');

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">Talones</h2>
      <Autorizado accion="crear" recurso="talon">
        <form
          className="mb-3 flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              !can('crear', 'talon') ||
              !valido ||
              ocupado ||
              !guarda.intentar()
            )
              return;
            emitir.mutate();
          }}
        >
          <select
            className={selectCls}
            value={direccion}
            onChange={(e) => {
              setDireccion(e.target.value as DireccionTalon);
              setVencimiento('');
            }}
            aria-label="Dirección"
          >
            {(['emitido', 'recibido'] as const).map((d) => (
              <option key={d} value={d}>
                {DIRECCION_TALON_LABELS[d]}
              </option>
            ))}
          </select>
          <select
            className={selectCls}
            value={vencimiento}
            onChange={(e) => {
              setVencimiento(e.target.value);
              const v = (vencimientos.data ?? []).find(
                (x) => x.id === e.target.value,
              );
              if (v) setImporte(String(v.pendingAmount));
            }}
            aria-label="Vencimiento"
          >
            <option value="">Vencimiento pendiente…</option>
            {(vencimientos.data ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.contactName} · {v.invoiceNumber} · {formatDate(v.dueDate)} ·{' '}
                {formatEur(v.pendingAmount)}
              </option>
            ))}
          </select>
          <input
            className={`${inputCls} w-28`}
            placeholder="Importe"
            inputMode="decimal"
            value={importe}
            onChange={(e) => setImporte(e.target.value)}
            aria-label="Importe"
          />
          <input
            type="date"
            className={inputCls}
            value={emision}
            max={hoy()}
            onChange={(e) => setEmision(e.target.value)}
            aria-label="Fecha de emisión"
          />
          <input
            type="date"
            className={inputCls}
            value={pago}
            min={emision}
            onChange={(e) => setPago(e.target.value)}
            aria-label="Fecha de pago (diferido)"
          />
          {direccion === 'emitido' ? (
            <select
              className={selectCls}
              value={talonario}
              onChange={(e) => setTalonario(e.target.value)}
              aria-label="Talonario"
            >
              <option value="">Talonario…</option>
              {(talonarios.data ?? [])
                .filter((t) => t.estado === 'activo')
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.bankAccountName} · {t.prefijo}
                    {t.siguiente}
                  </option>
                ))}
            </select>
          ) : (
            <>
              <select
                className={selectCls}
                value={cuenta}
                onChange={(e) => setCuenta(e.target.value)}
                aria-label="Cuenta de depósito"
              >
                <option value="">Cuenta de depósito…</option>
                {(cuentas.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                className={`${inputCls} w-28`}
                placeholder="Nº de cheque"
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                aria-label="Número del cheque"
              />
            </>
          )}
          <button
            type="submit"
            className={btnPrimaryCls}
            disabled={!valido || ocupado}
          >
            {direccion === 'emitido' ? 'Emitir talón' : 'Registrar cheque'}
          </button>
        </form>
      </Autorizado>
      <Autorizado accion="cambiarEstado" recurso="talon">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1">
            Fecha de la operación
            <input
              type="date"
              className={inputCls}
              value={fechaAccion}
              max={hoy()}
              onChange={(e) => setFechaAccion(e.target.value)}
            />
          </label>
          <input
            className={`${inputCls} flex-1`}
            placeholder="Motivo (anular, detener o devolver)"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            aria-label="Motivo"
          />
        </div>
      </Autorizado>
      {lista.isError && (
        <ErrorBanner message={(lista.error as Error).message} />
      )}
      <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2">Número</th>
              <th className="px-3 py-2">Tercero</th>
              <th className="px-3 py-2">Factura</th>
              <th className="px-3 py-2 text-right">Importe</th>
              <th className="px-3 py-2">Fechas</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {(lista.data ?? []).map((t) => (
              <tr key={t.id} className="border-t border-gray-100">
                <td className="px-3 py-1.5 font-medium">
                  {t.numero}
                  <span className="block text-[11px] text-gray-500">
                    {t.direccion}
                  </span>
                </td>
                <td className="px-3 py-1.5">{t.contactName}</td>
                <td className="px-3 py-1.5">{t.invoiceNumber}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {formatEur(t.importe)}
                </td>
                <td className="px-3 py-1.5 text-xs text-gray-600">
                  emisión {formatDate(t.fechaEmision)}
                  {t.fechaVencimiento &&
                    ` · pago ${formatDate(t.fechaVencimiento)}`}
                  {t.fechaCobro && ` · cobrado ${formatDate(t.fechaCobro)}`}
                  {t.fechaBaja && ` · baja ${formatDate(t.fechaBaja)}`}
                </td>
                <td className="px-3 py-1.5 text-xs">
                  {ESTADO_TALON_LABELS[t.estado]}
                  {t.motivo && (
                    <span className="block text-red-700">{t.motivo}</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right">
                  <Autorizado accion="cambiarEstado" recurso="talon">
                    <span className="flex flex-wrap justify-end gap-1">
                      {ACCIONES.filter((x) =>
                        TALON_TRANSITIONS[t.estado].includes(x.destino),
                      ).map((x) => (
                        <button
                          key={x.accion}
                          type="button"
                          className={btnGhostCls}
                          disabled={
                            ocupado || (x.motivo && motivo.trim().length < 3)
                          }
                          onClick={() => {
                            if (
                              !can('cambiarEstado', 'talon') ||
                              ocupado ||
                              (x.motivo && motivo.trim().length < 3) ||
                              !guarda.intentar()
                            )
                              return;
                            accion.mutate({ t, a: x.accion });
                          }}
                        >
                          {x.texto}
                        </button>
                      ))}
                    </span>
                  </Autorizado>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
