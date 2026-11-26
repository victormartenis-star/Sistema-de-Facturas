'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  ESTADO_REMESA_LABELS,
  TIPO_REMESA_LABELS,
  type RemesaDto,
  type TipoRemesa,
} from '@erp/shared';
import {
  bancaApi,
  descargarRemesaXml,
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

const hoy = () => new Date().toISOString().slice(0, 10);

function useRefrescar() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['remesas'] });
    void qc.invalidateQueries({ queryKey: ['treasury'] });
    void qc.invalidateQueries({ queryKey: ['contabilidad'] });
  };
}

/** Remesas SEPA: transferencias (pain.001) y adeudos directos CORE (pain.008). */
export default function RemesasPage() {
  const lista = useQuery({
    queryKey: ['remesas', 'lista'],
    queryFn: () => bancaApi.remesas(),
  });
  return (
    <div>
      <PageHeader
        title="Remesas SEPA"
        subtitle="Agrupa pagos (transferencias) o cobros (adeudos directos con mandato) de una cuenta, genera el fichero XML para el banco, regístralo como remitido y anota las devoluciones."
      />
      <NuevaRemesa />
      {lista.isError && (
        <ErrorBanner message={(lista.error as Error).message} />
      )}
      <div className="space-y-3">
        {(lista.data ?? []).map((r) => (
          <Remesa key={r.id} r={r} />
        ))}
        {lista.data?.length === 0 && (
          <p className="text-sm text-gray-500">Aún no hay remesas.</p>
        )}
      </div>
    </div>
  );
}

function NuevaRemesa() {
  const [tipo, setTipo] = useState<TipoRemesa>('transferencia');
  const [cuentaId, setCuentaId] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [elegidos, setElegidos] = useState<string[]>([]);
  const clave = useRef(nuevoUuid());
  const [guarda] = useState(crearGuardaEnvio);
  const { can } = usePermisos();
  const toast = useToast();
  const avisarError = useAvisarError();
  const refrescar = useRefrescar();
  const cuentas = useQuery({
    queryKey: ['treasury', 'cuentas', 'activas'],
    queryFn: () => treasuryApi.listBankAccounts(true),
  });
  const vencimientos = useQuery({
    queryKey: ['treasury', 'milestones', 'remesas', tipo],
    queryFn: () =>
      treasuryApi.milestones({
        direction: tipo === 'transferencia' ? 'pago' : 'cobro',
        status: 'previsto',
      }),
  });
  const crear = useMutation({
    mutationFn: () =>
      bancaApi.crearRemesa(
        {
          bankAccountId: cuentaId,
          tipo,
          fechaEjecucion: fecha,
          vencimientoIds: elegidos,
        },
        clave.current,
      ),
    onSuccess: (r) => {
      clave.current = nuevoUuid();
      setElegidos([]);
      toast(
        `Remesa ${r.numero} creada: ${r.numPartidas} partidas, ${formatEur(r.total)}`,
      );
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  useEffect(() => {
    if (!crear.isPending) guarda.liberar();
  }, [crear.isPending, guarda]);
  const pendientes = (vencimientos.data ?? []).filter(
    (v) => v.pendingAmount > 0,
  );
  const total = pendientes
    .filter((v) => elegidos.includes(v.id))
    .reduce((s, v) => s + Math.round(v.pendingAmount * 100), 0);
  const valido = cuentaId !== '' && elegidos.length > 0 && fecha >= hoy();

  return (
    <Autorizado accion="crear" recurso="banca">
      <form
        className="mb-6 rounded-xl border bg-white p-4 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (
            !can('crear', 'banca') ||
            !valido ||
            crear.isPending ||
            !guarda.intentar()
          )
            return;
          crear.mutate();
        }}
      >
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <select
            className={selectCls}
            value={tipo}
            onChange={(e) => {
              setTipo(e.target.value as TipoRemesa);
              setElegidos([]);
            }}
            aria-label="Tipo de remesa"
          >
            {(['transferencia', 'adeudo'] as const).map((t) => (
              <option key={t} value={t}>
                {TIPO_REMESA_LABELS[t]}
              </option>
            ))}
          </select>
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
                  {c.name} {c.iban ? `· ${c.iban}` : '· sin IBAN'}
                </option>
              ))}
          </select>
          <input
            type="date"
            className={inputCls}
            value={fecha}
            min={hoy()}
            onChange={(e) => setFecha(e.target.value)}
            aria-label="Fecha de ejecución"
          />
          <button
            type="submit"
            className={btnPrimaryCls}
            disabled={!valido || crear.isPending}
          >
            Crear remesa ({elegidos.length} · {formatEur(total / 100)})
          </button>
        </div>
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr>
                <th className="py-1" />
                <th className="py-1">Tercero</th>
                <th className="py-1">Factura</th>
                <th className="py-1">Vence</th>
                <th className="py-1 text-right">Pendiente</th>
              </tr>
            </thead>
            <tbody>
              {pendientes.map((v) => (
                <tr key={v.id} className="border-t border-gray-100">
                  <td className="py-1">
                    <input
                      type="checkbox"
                      checked={elegidos.includes(v.id)}
                      onChange={(e) =>
                        setElegidos(
                          e.target.checked
                            ? [...elegidos, v.id]
                            : elegidos.filter((x) => x !== v.id),
                        )
                      }
                      aria-label={`Incluir ${v.invoiceNumber}`}
                    />
                  </td>
                  <td className="py-1">{v.contactName}</td>
                  <td className="py-1">{v.invoiceNumber}</td>
                  <td className="py-1 tabular-nums">{formatDate(v.dueDate)}</td>
                  <td className="py-1 text-right tabular-nums">
                    {formatEur(v.pendingAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pendientes.length === 0 && (
            <p className="py-2 text-xs text-gray-500">
              No hay vencimientos pendientes de este tipo.
            </p>
          )}
        </div>
      </form>
    </Autorizado>
  );
}

function Remesa({ r }: { r: RemesaDto }) {
  const [abierta, setAbierta] = useState(false);
  const [fecha, setFecha] = useState(hoy);
  const [motivo, setMotivo] = useState('');
  const clave = useRef(nuevoUuid());
  const [guarda] = useState(crearGuardaEnvio);
  const { can } = usePermisos();
  const toast = useToast();
  const avisarError = useAvisarError();
  const refrescar = useRefrescar();
  const hecho = (texto: string) => () => {
    clave.current = nuevoUuid();
    setMotivo('');
    toast(texto);
    refrescar();
  };
  const fallo = (e: unknown) => avisarError(e, refrescar);
  const generar = useMutation({
    mutationFn: () => bancaApi.generar(r.id, r.version, clave.current),
    onSuccess: hecho('Fichero SEPA generado'),
    onError: fallo,
  });
  const remitir = useMutation({
    mutationFn: () => bancaApi.remitir(r.id, fecha, r.version, clave.current),
    onSuccess: hecho('Remesa remitida: vencimientos liquidados'),
    onError: fallo,
  });
  const anular = useMutation({
    mutationFn: () =>
      bancaApi.anularRemesa(r.id, motivo, r.version, clave.current),
    onSuccess: hecho('Remesa anulada'),
    onError: fallo,
  });
  const devolver = useMutation({
    mutationFn: (partidaId: string) =>
      bancaApi.devolverPartida(
        r.id,
        partidaId,
        { fecha, motivo },
        r.version,
        clave.current,
      ),
    onSuccess: hecho(
      'Devolución registrada: el vencimiento vuelve a estar pendiente',
    ),
    onError: fallo,
  });
  const descargar = useMutation({
    mutationFn: () => descargarRemesaXml(r.id),
    onError: fallo,
  });
  const ocupado =
    generar.isPending ||
    remitir.isPending ||
    anular.isPending ||
    devolver.isPending;
  useEffect(() => {
    if (!ocupado) guarda.liberar();
  }, [ocupado, guarda]);
  const lanzar = (accion: () => void, permiso: 'cambiarEstado' | 'anular') => {
    if (!can(permiso, 'banca') || ocupado || !guarda.intentar()) return;
    accion();
  };
  const conMotivo = motivo.trim().length >= 3;

  return (
    <div className="rounded-xl border bg-white p-3 text-sm shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="text-left"
          onClick={() => setAbierta(!abierta)}
        >
          <span className="font-semibold">{r.numero}</span> ·{' '}
          {r.tipo === 'transferencia' ? 'Transferencias' : 'Adeudos'} ·{' '}
          {r.bankAccountNombre} · {formatDate(r.fechaEjecucion)} ·{' '}
          {r.numPartidas} partidas ·{' '}
          <span className="tabular-nums">{formatEur(r.total)}</span>
          <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs">
            {ESTADO_REMESA_LABELS[r.estado]}
          </span>
          {r.conciliadaCon && (
            <span className="ml-1 rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">
              conciliada
            </span>
          )}
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {r.xmlHash && (
            <button
              type="button"
              className={btnGhostCls}
              disabled={descargar.isPending}
              onClick={() => descargar.mutate()}
              title={`SHA-256 ${r.xmlHash}`}
            >
              Descargar XML
            </button>
          )}
          {r.estado === 'borrador' && (
            <Autorizado accion="cambiarEstado" recurso="banca">
              <button
                type="button"
                className={btnPrimaryCls}
                disabled={ocupado}
                onClick={() => lanzar(() => generar.mutate(), 'cambiarEstado')}
              >
                Generar fichero
              </button>
            </Autorizado>
          )}
          {r.estado === 'generada' && (
            <Autorizado accion="cambiarEstado" recurso="banca">
              <input
                type="date"
                className={inputCls}
                value={fecha}
                max={hoy()}
                onChange={(e) => setFecha(e.target.value)}
                aria-label="Fecha de envío"
              />
              <button
                type="button"
                className={btnPrimaryCls}
                disabled={ocupado}
                onClick={() => lanzar(() => remitir.mutate(), 'cambiarEstado')}
              >
                Marcar remitida
              </button>
            </Autorizado>
          )}
        </div>
      </div>
      {r.motivo && (
        <p className="mt-1 text-xs text-gray-500">Motivo: {r.motivo}</p>
      )}
      {abierta && (
        <div className="mt-2">
          <table className="w-full text-xs">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="py-1">Referencia</th>
                <th className="py-1">Tercero</th>
                <th className="py-1">IBAN</th>
                <th className="py-1">Factura</th>
                <th className="py-1 text-right">Importe</th>
                <th className="py-1">Estado</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {r.partidas.map((p) => (
                <tr key={p.id} className="border-t border-gray-100">
                  <td className="py-1 font-mono">{p.endToEndId}</td>
                  <td className="py-1">
                    {p.nombre}
                    {p.mandato && (
                      <span className="block text-gray-500">
                        Mandato {p.mandato} ({p.secuencia})
                      </span>
                    )}
                  </td>
                  <td className="py-1 font-mono">
                    {p.iban ?? <span className="text-red-600">falta</span>}
                  </td>
                  <td className="py-1">{p.invoiceNumber}</td>
                  <td className="py-1 text-right tabular-nums">
                    {formatEur(p.importe)}
                  </td>
                  <td className="py-1">
                    {p.estado}
                    {p.motivoDevolucion && ` · ${p.motivoDevolucion}`}
                  </td>
                  <td className="py-1 text-right">
                    {r.estado === 'remitida' && p.estado === 'incluida' && (
                      <Autorizado accion="anular" recurso="banca">
                        <button
                          type="button"
                          className={btnGhostCls}
                          disabled={ocupado || !conMotivo}
                          title="Indica fecha y motivo de la devolución (código R)"
                          onClick={() =>
                            lanzar(() => devolver.mutate(p.id), 'anular')
                          }
                        >
                          Devuelta
                        </button>
                      </Autorizado>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(r.estado === 'remitida' ||
            r.estado === 'borrador' ||
            r.estado === 'generada') && (
            <Autorizado accion="anular" recurso="banca">
              <div className="mt-2 flex flex-wrap items-end gap-2">
                {r.estado === 'remitida' && (
                  <input
                    type="date"
                    className={inputCls}
                    value={fecha}
                    max={hoy()}
                    onChange={(e) => setFecha(e.target.value)}
                    aria-label="Fecha de la devolución"
                  />
                )}
                <input
                  className={`${inputCls} flex-1`}
                  placeholder={
                    r.estado === 'remitida'
                      ? 'Motivo de la devolución (AC04, MD06…)'
                      : 'Motivo de la anulación'
                  }
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  aria-label="Motivo"
                />
                {r.estado !== 'remitida' && (
                  <button
                    type="button"
                    className={btnGhostCls}
                    disabled={ocupado || !conMotivo}
                    onClick={() => lanzar(() => anular.mutate(), 'anular')}
                  >
                    Anular remesa
                  </button>
                )}
              </div>
            </Autorizado>
          )}
        </div>
      )}
    </div>
  );
}
