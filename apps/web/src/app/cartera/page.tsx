'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  TRAMOS_ANTIGUEDAD,
  TRAMO_ANTIGUEDAD_LABELS,
  type AnticipoDto,
  type CompensacionDto,
  type TipoCartera,
} from '@erp/shared';
import { carteraApi, contactsApi, formatDate, formatEur } from '@/lib/api';
import { nuevoUuid } from '@/lib/api-error';
import { crearGuardaEnvio } from '@/lib/envio-unico';
import { usePermisos } from '@/lib/permisos';
import { Autorizado } from '@/components/autorizado';
import { IconWallet } from '@/components/icons';
import { useAvisarError, useToast } from '@/components/toast';
import {
  EmptyState,
  ErrorBanner,
  PageHeader,
  TableSkeleton,
  btnGhostCls,
  btnPrimaryCls,
  inputCls,
  selectCls,
} from '@/components/ui';

const hoy = () => new Date().toISOString().slice(0, 10);
const importe = (s: string) => Number(s.trim().replace(',', '.'));

/** Invalida la cartera, la tesorería y la contabilidad tras una operación. */
function useRefrescar() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['cartera'] });
    void qc.invalidateQueries({ queryKey: ['treasury'] });
    void qc.invalidateQueries({ queryKey: ['contabilidad'] });
  };
}

export default function CarteraPage() {
  const [tipo, setTipo] = useState<TipoCartera>('clientes');
  const [fecha, setFecha] = useState(hoy);
  const [soloVencidas, setSoloVencidas] = useState(false);
  const corte = fecha || undefined;

  const antiguedad = useQuery({
    queryKey: ['cartera', 'antiguedad', tipo, corte],
    queryFn: () => carteraApi.antiguedad(tipo, corte),
  });
  const partidas = useQuery({
    queryKey: ['cartera', 'partidas', tipo, corte, soloVencidas],
    queryFn: () => carteraApi.partidas({ tipo, fecha: corte, soloVencidas }),
  });
  const conciliacion = useQuery({
    queryKey: ['cartera', 'conciliacion', tipo, corte],
    queryFn: () => carteraApi.conciliacion(tipo, corte),
  });

  const ag = antiguedad.data;
  const c = conciliacion.data;

  return (
    <div>
      <PageHeader
        title="Cartera de clientes y proveedores"
        subtitle="Partidas abiertas por tercero y factura, antigüedad de saldos, anticipos, compensaciones y conciliación por tercero frente al mayor."
      >
        <div className="flex flex-wrap items-end gap-2">
          <select
            className={selectCls}
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoCartera)}
            aria-label="Cartera"
          >
            <option value="clientes">Clientes (cobros)</option>
            <option value="proveedores">Proveedores (pagos)</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-gray-600">
            Fecha de corte
            <input
              type="date"
              className={inputCls}
              value={fecha}
              max={hoy()}
              onChange={(e) => setFecha(e.target.value)}
            />
          </label>
        </div>
      </PageHeader>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold">Antigüedad de saldos</h2>
        {antiguedad.isError && (
          <ErrorBanner message={(antiguedad.error as Error).message} />
        )}
        {antiguedad.isLoading && <TableSkeleton rows={3} />}
        {ag && ag.terceros.length === 0 && (
          <EmptyState
            icon={<IconWallet />}
            title="Sin partidas abiertas a la fecha"
          />
        )}
        {ag && ag.terceros.length > 0 && (
          <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2">Tercero</th>
                  {TRAMOS_ANTIGUEDAD.map((t) => (
                    <th key={t} className="px-3 py-2 text-right">
                      {TRAMO_ANTIGUEDAD_LABELS[t]}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right">Retención</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ...ag.terceros,
                  { contactId: 'total', contactName: 'Total', ...ag.totales },
                ].map((t) => (
                  <tr
                    key={t.contactId}
                    className={`border-t border-gray-100 ${t.contactId === 'total' ? 'font-semibold' : ''}`}
                  >
                    <td className="px-3 py-1.5">{t.contactName}</td>
                    {TRAMOS_ANTIGUEDAD.map((k) => (
                      <td
                        key={k}
                        className={`px-3 py-1.5 text-right tabular-nums ${k === 'mas_90' && t.tramos[k] !== 0 ? 'text-red-700' : ''}`}
                      >
                        {t.tramos[k] === 0 ? '—' : formatEur(t.tramos[k])}
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">
                      {t.retencion === 0 ? '—' : formatEur(t.retencion)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatEur(t.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mb-8">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            Partidas abiertas
            {partidas.data && (
              <span className="ml-2 text-xs font-normal text-gray-500">
                {partidas.data.partidas.length} ·{' '}
                {formatEur(partidas.data.total)}
              </span>
            )}
          </h2>
          <label className="flex items-center gap-1 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={soloVencidas}
              onChange={(e) => setSoloVencidas(e.target.checked)}
            />
            Solo vencidas
          </label>
        </div>
        {partidas.isError && (
          <ErrorBanner message={(partidas.error as Error).message} />
        )}
        {partidas.data && partidas.data.partidas.length > 0 && (
          <div className="max-h-80 overflow-y-auto rounded-xl border bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2">Tercero</th>
                  <th className="px-3 py-2">Factura</th>
                  <th className="px-3 py-2">Vence</th>
                  <th className="px-3 py-2 text-right">Importe</th>
                  <th className="px-3 py-2 text-right">Pendiente</th>
                  <th className="px-3 py-2">Tramo</th>
                </tr>
              </thead>
              <tbody>
                {partidas.data.partidas.map((p) => (
                  <tr key={p.id} className="border-t border-gray-100">
                    <td className="px-3 py-1.5">{p.contactName}</td>
                    <td className="px-3 py-1.5">
                      {p.invoiceNumber}
                      {p.kind === 'retencion' && (
                        <span className="ml-1 text-xs text-gray-500">
                          (retención)
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums">
                      {formatDate(p.vencimiento)}
                      {p.diasVencido > 0 && (
                        <span className="ml-1 text-xs text-red-700">
                          +{p.diasVencido} d
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatEur(p.importe)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatEur(p.pendiente)}
                    </td>
                    <td className="px-3 py-1.5 text-xs">
                      {TRAMO_ANTIGUEDAD_LABELS[p.tramo]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold">
          Conciliación por tercero ({c?.cuentas ?? '…'})
          {c && (
            <span
              className={`ml-2 text-xs ${c.cuadra ? 'text-emerald-700' : 'text-red-700'}`}
            >
              {c.cuadra ? 'cuadra' : `${c.descuadres} descuadre(s)`}
            </span>
          )}
        </h2>
        {conciliacion.isError && (
          <ErrorBanner message={(conciliacion.error as Error).message} />
        )}
        {c && c.terceros.length > 0 && (
          <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2">Tercero</th>
                  <th className="px-3 py-2 text-right">Ordinario</th>
                  <th className="px-3 py-2 text-right">Retención</th>
                  <th className="px-3 py-2 text-right">Anticipos</th>
                  <th className="px-3 py-2 text-right">Auxiliar</th>
                  <th className="px-3 py-2 text-right">Mayor</th>
                  <th className="px-3 py-2 text-right">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {c.terceros.map((t) => (
                  <tr
                    key={t.contactId ?? 'sin'}
                    className="border-t border-gray-100"
                  >
                    <td className="px-3 py-1.5">{t.contactName}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatEur(t.ordinario)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatEur(t.retencion)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatEur(t.anticipos)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatEur(t.auxiliar)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatEur(t.mayor)}
                    </td>
                    <td
                      className={`px-3 py-1.5 text-right tabular-nums ${t.cuadra ? 'text-emerald-700' : 'font-semibold text-red-700'}`}
                    >
                      {formatEur(t.diferencia)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Anticipos tipo={tipo} />
      <Compensaciones />
    </div>
  );
}

/** Anticipos de clientes (438) o a proveedores (407): alta, aplicación y anulación. */
function Anticipos({ tipo }: { tipo: TipoCartera }) {
  const [contactId, setContactId] = useState('');
  const [imp, setImp] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [motivo, setMotivo] = useState('');
  const clave = useRef(nuevoUuid());
  const [guarda] = useState(crearGuardaEnvio);
  const { can } = usePermisos();
  const toast = useToast();
  const avisarError = useAvisarError();
  const refrescar = useRefrescar();
  const contactos = useQuery({
    queryKey: ['contacts', 'cartera', tipo],
    queryFn: () =>
      contactsApi.list('', tipo === 'clientes' ? 'cliente' : 'proveedor'),
  });
  const lista = useQuery({
    queryKey: ['cartera', 'anticipos', tipo],
    queryFn: () => carteraApi.anticipos(tipo),
  });
  const crear = useMutation({
    mutationFn: () =>
      carteraApi.crearAnticipo(
        { tipo, contactId, importe: importe(imp), fecha },
        clave.current,
      ),
    onSuccess: (a) => {
      clave.current = nuevoUuid();
      setImp('');
      toast(
        `Anticipo de ${a.contactName} por ${formatEur(a.importe)} registrado`,
      );
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const accion = useMutation({
    mutationFn: ({
      a,
      que,
    }: {
      a: AnticipoDto;
      que: 'aplicar' | 'desaplicar' | 'anular';
    }) =>
      que === 'aplicar'
        ? carteraApi.aplicarAnticipo(
            a.id,
            { fecha: hoy() },
            a.version,
            nuevoUuid(),
          )
        : que === 'desaplicar'
          ? carteraApi.desaplicarAnticipo(a.id, motivo, a.version)
          : carteraApi.anularAnticipo(a.id, motivo, a.version),
    onSuccess: (a) => {
      setMotivo('');
      toast(
        `Anticipo de ${a.contactName}: aplicado ${formatEur(a.aplicado)}, disponible ${formatEur(a.disponible)}`,
      );
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const ocupado = crear.isPending || accion.isPending;
  useEffect(() => {
    if (!ocupado) guarda.liberar();
  }, [ocupado, guarda]);
  const valido = contactId !== '' && importe(imp) > 0 && fecha !== '';
  const filas = lista.data ?? [];

  return (
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-semibold">
        Anticipos{' '}
        {tipo === 'clientes' ? 'de clientes (438)' : 'a proveedores (407)'}
      </h2>
      <Autorizado accion="crear" recurso="cartera">
        <form
          className="mb-3 flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              !can('crear', 'cartera') ||
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
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            aria-label="Tercero"
          >
            <option value="">Tercero…</option>
            {(contactos.data ?? []).map((ct) => (
              <option key={ct.id} value={ct.id}>
                {ct.legalName}
              </option>
            ))}
          </select>
          <input
            className={inputCls}
            inputMode="decimal"
            placeholder="Importe"
            value={imp}
            onChange={(e) => setImp(e.target.value)}
            aria-label="Importe del anticipo"
          />
          <input
            type="date"
            className={inputCls}
            value={fecha}
            max={hoy()}
            onChange={(e) => setFecha(e.target.value)}
            aria-label="Fecha del anticipo"
          />
          <button
            type="submit"
            className={btnPrimaryCls}
            disabled={!valido || ocupado}
          >
            {crear.isPending ? 'Registrando…' : 'Registrar anticipo'}
          </button>
        </form>
      </Autorizado>
      {lista.isError && (
        <ErrorBanner message={(lista.error as Error).message} />
      )}
      {filas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Tercero</th>
                <th className="px-3 py-2 text-right">Importe</th>
                <th className="px-3 py-2 text-right">Aplicado</th>
                <th className="px-3 py-2 text-right">Disponible</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filas.map((a) => (
                <tr key={a.id} className="border-t border-gray-100">
                  <td className="px-3 py-1.5 tabular-nums">
                    {formatDate(a.fecha)}
                  </td>
                  <td className="px-3 py-1.5">{a.contactName}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {formatEur(a.importe)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {formatEur(a.aplicado)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {formatEur(a.disponible)}
                  </td>
                  <td className="px-3 py-1.5 text-xs">{a.estado}</td>
                  <td className="px-3 py-1.5 text-right">
                    {a.estado === 'vigente' && (
                      <Autorizado accion="cambiarEstado" recurso="cartera">
                        <span className="flex justify-end gap-1">
                          {a.disponible > 0 && (
                            <button
                              type="button"
                              className={btnGhostCls}
                              disabled={ocupado}
                              onClick={() => {
                                if (
                                  !can('cambiarEstado', 'cartera') ||
                                  ocupado ||
                                  !guarda.intentar()
                                )
                                  return;
                                accion.mutate({ a, que: 'aplicar' });
                              }}
                            >
                              Aplicar por antigüedad
                            </button>
                          )}
                          <button
                            type="button"
                            className={btnGhostCls}
                            disabled={ocupado || motivo.trim().length < 3}
                            title="Escribe el motivo abajo"
                            onClick={() => {
                              if (
                                !can('anular', 'cartera') ||
                                ocupado ||
                                motivo.trim().length < 3 ||
                                !guarda.intentar()
                              )
                                return;
                              accion.mutate({
                                a,
                                que: a.aplicado > 0 ? 'desaplicar' : 'anular',
                              });
                            }}
                          >
                            {a.aplicado > 0 ? 'Desaplicar' : 'Anular'}
                          </button>
                        </span>
                      </Autorizado>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Autorizado accion="anular" recurso="cartera">
            <div className="border-t p-2">
              <input
                className={`${inputCls} w-full`}
                placeholder="Motivo para desaplicar o anular (mín. 3 caracteres)"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                aria-label="Motivo"
              />
            </div>
          </Autorizado>
        </div>
      )}
    </section>
  );
}

/** Compensación cobro ↔ pago de un tercero que es cliente y proveedor. */
function Compensaciones() {
  const [contactId, setContactId] = useState('');
  const [imp, setImp] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [motivo, setMotivo] = useState('');
  const clave = useRef(nuevoUuid());
  const [guarda] = useState(crearGuardaEnvio);
  const { can } = usePermisos();
  const toast = useToast();
  const avisarError = useAvisarError();
  const refrescar = useRefrescar();
  const contactos = useQuery({
    queryKey: ['contacts', 'cartera', 'ambos'],
    queryFn: () => contactsApi.list('', 'ambos'),
  });
  const lista = useQuery({
    queryKey: ['cartera', 'compensaciones'],
    queryFn: () => carteraApi.compensaciones(),
  });
  const crear = useMutation({
    mutationFn: () =>
      carteraApi.crearCompensacion(
        { contactId, fecha, ...(imp.trim() ? { importe: importe(imp) } : {}) },
        clave.current,
      ),
    onSuccess: (n) => {
      clave.current = nuevoUuid();
      setImp('');
      toast(`Compensados ${formatEur(n.importe)} con ${n.contactName}`);
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const anular = useMutation({
    mutationFn: (n: CompensacionDto) =>
      carteraApi.anularCompensacion(n.id, motivo, n.version),
    onSuccess: () => {
      setMotivo('');
      toast('Compensación anulada');
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const ocupado = crear.isPending || anular.isPending;
  useEffect(() => {
    if (!ocupado) guarda.liberar();
  }, [ocupado, guarda]);
  const filas = lista.data ?? [];

  return (
    <section className="mb-8">
      <h2 className="mb-1 text-sm font-semibold">
        Compensaciones cobro ↔ pago
      </h2>
      <p className="mb-2 text-xs text-gray-500">
        Para terceros que son cliente y proveedor: salda lo que nos deben con lo
        que les debemos (5550 a 430x y 400x a 5550 por el mismo importe). Sin
        importe, el menor de los dos pendientes.
      </p>
      <Autorizado accion="crear" recurso="cartera">
        <form
          className="mb-3 flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              !can('crear', 'cartera') ||
              !contactId ||
              ocupado ||
              !guarda.intentar()
            )
              return;
            crear.mutate();
          }}
        >
          <select
            className={selectCls}
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            aria-label="Tercero cliente y proveedor"
          >
            <option value="">Tercero (cliente y proveedor)…</option>
            {(contactos.data ?? []).map((ct) => (
              <option key={ct.id} value={ct.id}>
                {ct.legalName}
              </option>
            ))}
          </select>
          <input
            className={inputCls}
            inputMode="decimal"
            placeholder="Importe (opcional)"
            value={imp}
            onChange={(e) => setImp(e.target.value)}
            aria-label="Importe a compensar"
          />
          <input
            type="date"
            className={inputCls}
            value={fecha}
            max={hoy()}
            onChange={(e) => setFecha(e.target.value)}
            aria-label="Fecha de la compensación"
          />
          <button
            type="submit"
            className={btnPrimaryCls}
            disabled={!contactId || ocupado}
          >
            {crear.isPending ? 'Compensando…' : 'Compensar'}
          </button>
        </form>
      </Autorizado>
      {lista.isError && (
        <ErrorBanner message={(lista.error as Error).message} />
      )}
      {filas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Tercero</th>
                <th className="px-3 py-2 text-right">Importe</th>
                <th className="px-3 py-2">Facturas</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filas.map((n) => (
                <tr key={n.id} className="border-t border-gray-100">
                  <td className="px-3 py-1.5 tabular-nums">
                    {formatDate(n.fecha)}
                  </td>
                  <td className="px-3 py-1.5">{n.contactName}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {formatEur(n.importe)}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-gray-600">
                    {n.lineas
                      .map(
                        (l) =>
                          `${l.direccion === 'cobro' ? '↓' : '↑'} ${l.invoiceNumber} ${formatEur(l.importe)}`,
                      )
                      .join(' · ')}
                  </td>
                  <td className="px-3 py-1.5 text-xs">{n.estado}</td>
                  <td className="px-3 py-1.5 text-right">
                    {n.estado === 'vigente' && (
                      <Autorizado accion="anular" recurso="cartera">
                        <button
                          type="button"
                          className={btnGhostCls}
                          disabled={ocupado || motivo.trim().length < 3}
                          onClick={() => {
                            if (
                              !can('anular', 'cartera') ||
                              ocupado ||
                              motivo.trim().length < 3 ||
                              !guarda.intentar()
                            )
                              return;
                            anular.mutate(n);
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
          <Autorizado accion="anular" recurso="cartera">
            <div className="border-t p-2">
              <input
                className={`${inputCls} w-full`}
                placeholder="Motivo de la anulación (mín. 3 caracteres)"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                aria-label="Motivo de la anulación"
              />
            </div>
          </Autorizado>
        </div>
      )}
    </section>
  );
}
