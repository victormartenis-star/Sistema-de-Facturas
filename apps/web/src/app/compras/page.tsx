'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  ESTADO_PETICION_OFERTA_LABELS,
  ESTADO_SOLICITUD_COMPRA_LABELS,
  TIPOS_LINEA_COMPRA,
  TIPO_LINEA_COMPRA_LABELS,
  type CuadreFacturaDto,
  type PedidoCompraDetalleDto,
  type PeticionOfertaDto,
  type SolicitudCompraDto,
  type TipoLineaCompra,
} from '@erp/shared';
import {
  almacenApi,
  comprasApi,
  contactsApi,
  formatDate,
  formatEur,
  invoicesApi,
  projectsApi,
} from '@/lib/api';
import { nuevoUuid } from '@/lib/api-error';
import { crearGuardaEnvio } from '@/lib/envio-unico';
import { parseLotes } from '@/lib/lotes';
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
type Pestana = 'solicitudes' | 'peticiones' | 'pedidos';

function useRefrescar() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['compras'] });
    void qc.invalidateQueries({ queryKey: ['almacen'] });
    void qc.invalidateQueries({ queryKey: ['invoices'] });
  };
}

/** Guarda de envío único compartida por los formularios de un panel. */
function useGuarda(ocupado: boolean) {
  const [guarda] = useState(crearGuardaEnvio);
  useEffect(() => {
    if (!ocupado) guarda.liberar();
  }, [ocupado, guarda]);
  return guarda;
}

function useProveedores() {
  return useQuery({
    queryKey: ['contacts', 'proveedores', 'compras'],
    queryFn: () => contactsApi.list('', 'proveedor'),
  });
}

export default function ComprasPage() {
  const [pestana, setPestana] = useState<Pestana>('solicitudes');
  return (
    <div>
      <PageHeader
        title="Compras"
        subtitle="Solicitud de compra → petición de ofertas → pedido → recepción → factura con cuadre a tres bandas por línea."
      />
      <div className="mb-4 flex gap-2">
        {(
          [
            ['solicitudes', 'Solicitudes de compra'],
            ['peticiones', 'Peticiones de ofertas'],
            ['pedidos', 'Pedidos, recepciones y facturas'],
          ] as const
        ).map(([k, t]) => (
          <button
            key={k}
            type="button"
            className={pestana === k ? btnPrimaryCls : btnGhostCls}
            onClick={() => setPestana(k)}
          >
            {t}
          </button>
        ))}
      </div>
      {pestana === 'solicitudes' && <Solicitudes />}
      {pestana === 'peticiones' && <Peticiones />}
      {pestana === 'pedidos' && <Pedidos />}
    </div>
  );
}

/* ─────────────────────────── solicitudes ─────────────────────────── */

interface LineaForm {
  tipo: TipoLineaCompra;
  descripcion: string;
  cantidad: string;
  precio: string;
}
const lineaVacia = (): LineaForm => ({
  tipo: 'material',
  descripcion: '',
  cantidad: '',
  precio: '',
});

function Solicitudes() {
  const [projectId, setProjectId] = useState('');
  const [titulo, setTitulo] = useState('');
  const [lineas, setLineas] = useState<LineaForm[]>([lineaVacia()]);
  const [motivo, setMotivo] = useState('');
  const [proveedor, setProveedor] = useState('');
  const [invitados, setInvitados] = useState<string[]>([]);
  const clave = useRef(nuevoUuid());
  const { can } = usePermisos();
  const toast = useToast();
  const avisarError = useAvisarError();
  const refrescar = useRefrescar();
  const obras = useQuery({
    queryKey: ['projects', 'compras'],
    queryFn: () => projectsApi.list('', ''),
  });
  const proveedores = useProveedores();
  const lista = useQuery({
    queryKey: ['compras', 'solicitudes'],
    queryFn: () => comprasApi.solicitudes(),
  });
  const crear = useMutation({
    mutationFn: () =>
      comprasApi.crearSolicitud(
        {
          projectId,
          titulo,
          enviar: true,
          lineas: lineas.map((l) => ({
            tipo: l.tipo,
            descripcion: l.descripcion,
            cantidad: num(l.cantidad),
            precioEstimado: l.precio.trim() ? num(l.precio) : null,
          })),
        },
        clave.current,
      ),
    onSuccess: (s) => {
      clave.current = nuevoUuid();
      setTitulo('');
      setLineas([lineaVacia()]);
      toast(`Solicitud ${s.numero} enviada a aprobación`);
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const accion = useMutation({
    mutationFn: ({
      s,
      que,
    }: {
      s: SolicitudCompraDto;
      que: 'aprobar' | 'rechazar' | 'enviar' | 'pedido' | 'peticion';
    }) =>
      que === 'pedido'
        ? comprasApi
            .aPedido(
              s.id,
              { contactId: proveedor, fecha: hoy() },
              s.version,
              nuevoUuid(),
            )
            .then(() => s)
        : que === 'peticion'
          ? comprasApi
              .aPeticion(
                s.id,
                { proveedores: invitados },
                s.version,
                nuevoUuid(),
              )
              .then(() => s)
          : comprasApi.accionSolicitud(s.id, que, s.version, motivo),
    onSuccess: (_s, v) => {
      setMotivo('');
      toast(
        v.que === 'pedido'
          ? 'Pedido emitido desde la solicitud'
          : v.que === 'peticion'
            ? 'Petición de ofertas enviada'
            : `Solicitud ${v.que === 'aprobar' ? 'aprobada' : v.que === 'rechazar' ? 'rechazada' : 'enviada'}`,
      );
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const ocupado = crear.isPending || accion.isPending;
  const guarda = useGuarda(ocupado);
  const valida =
    projectId !== '' &&
    titulo.trim().length >= 3 &&
    lineas.every((l) => l.descripcion.trim() && num(l.cantidad) > 0);
  const lanzar = (
    s: SolicitudCompraDto,
    que: Parameters<typeof accion.mutate>[0]['que'],
    permitido: boolean,
  ) => {
    if (!permitido || ocupado || !guarda.intentar()) return;
    accion.mutate({ s, que });
  };
  const filas = lista.data ?? [];
  const cambiar = (i: number, k: keyof LineaForm, v: string) =>
    setLineas(lineas.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  return (
    <section>
      <Autorizado accion="crear" recurso="solicitud_compra">
        <form
          className="mb-4 space-y-2 rounded-lg bg-gray-50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              !can('crear', 'solicitud_compra') ||
              !valida ||
              ocupado ||
              !guarda.intentar()
            )
              return;
            crear.mutate();
          }}
        >
          <div className="flex flex-wrap gap-2">
            <select
              className={selectCls}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              aria-label="Obra"
            >
              <option value="">Obra…</option>
              {(obras.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.name}
                </option>
              ))}
            </select>
            <input
              className={`${inputCls} flex-1`}
              placeholder="Qué se necesita"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              aria-label="Título"
            />
          </div>
          {lineas.map((l, i) => (
            <div key={i} className="flex flex-wrap gap-2">
              <select
                className={selectCls}
                value={l.tipo}
                onChange={(e) => cambiar(i, 'tipo', e.target.value)}
                aria-label="Tipo de línea"
              >
                {TIPOS_LINEA_COMPRA.map((t) => (
                  <option key={t} value={t}>
                    {TIPO_LINEA_COMPRA_LABELS[t]}
                  </option>
                ))}
              </select>
              <input
                className={`${inputCls} flex-1`}
                placeholder="Descripción"
                value={l.descripcion}
                onChange={(e) => cambiar(i, 'descripcion', e.target.value)}
                aria-label="Descripción"
              />
              <input
                className={`${inputCls} w-24`}
                placeholder="Cantidad"
                inputMode="decimal"
                value={l.cantidad}
                onChange={(e) => cambiar(i, 'cantidad', e.target.value)}
                aria-label="Cantidad"
              />
              <input
                className={`${inputCls} w-28`}
                placeholder="Precio est."
                inputMode="decimal"
                value={l.precio}
                onChange={(e) => cambiar(i, 'precio', e.target.value)}
                aria-label="Precio estimado"
              />
            </div>
          ))}
          <div className="flex gap-2">
            <button
              type="button"
              className={btnGhostCls}
              onClick={() => setLineas([...lineas, lineaVacia()])}
            >
              + Línea
            </button>
            <button
              type="submit"
              className={btnPrimaryCls}
              disabled={!valida || ocupado}
            >
              {crear.isPending ? 'Enviando…' : 'Enviar solicitud'}
            </button>
          </div>
        </form>
      </Autorizado>
      {lista.isError && (
        <ErrorBanner message={(lista.error as Error).message} />
      )}
      <Autorizado accion="cambiarEstado" recurso="compra">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <input
            className={inputCls}
            placeholder="Motivo del rechazo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            aria-label="Motivo del rechazo"
          />
          <select
            className={selectCls}
            value={proveedor}
            onChange={(e) => setProveedor(e.target.value)}
            aria-label="Proveedor del pedido"
          >
            <option value="">Proveedor para el pedido…</option>
            {(proveedores.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.legalName}
              </option>
            ))}
          </select>
          <select
            multiple
            className={`${selectCls} h-16`}
            value={invitados}
            onChange={(e) =>
              setInvitados([...e.target.selectedOptions].map((o) => o.value))
            }
            aria-label="Proveedores invitados a ofertar"
          >
            {(proveedores.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.legalName}
              </option>
            ))}
          </select>
        </div>
      </Autorizado>
      <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2">Número</th>
              <th className="px-3 py-2">Obra</th>
              <th className="px-3 py-2">Título</th>
              <th className="px-3 py-2 text-right">Estimado</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {filas.map((s) => (
              <tr key={s.id} className="border-t border-gray-100">
                <td className="px-3 py-1.5 font-medium">{s.numero}</td>
                <td className="px-3 py-1.5">{s.projectCode}</td>
                <td className="px-3 py-1.5">
                  {s.titulo}
                  <span className="block text-[11px] text-gray-500">
                    {s.lineas
                      .map((l) => `${l.cantidad} ${l.unidad} ${l.descripcion}`)
                      .join(' · ')}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {formatEur(s.importeEstimado)}
                </td>
                <td className="px-3 py-1.5 text-xs">
                  {ESTADO_SOLICITUD_COMPRA_LABELS[s.estado]}
                  {s.motivoRechazo && (
                    <span className="block text-red-700">
                      {s.motivoRechazo}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right">
                  <span className="flex flex-wrap justify-end gap-1">
                    {s.estado === 'borrador' && (
                      <button
                        type="button"
                        className={btnGhostCls}
                        disabled={ocupado}
                        onClick={() =>
                          lanzar(
                            s,
                            'enviar',
                            can('cambiarEstado', 'solicitud_compra'),
                          )
                        }
                      >
                        Enviar
                      </button>
                    )}
                    {s.estado === 'solicitada' &&
                      can('cambiarEstado', 'compra') && (
                        <>
                          <button
                            type="button"
                            className={btnGhostCls}
                            disabled={ocupado}
                            onClick={() =>
                              lanzar(
                                s,
                                'aprobar',
                                can('cambiarEstado', 'compra'),
                              )
                            }
                          >
                            Aprobar
                          </button>
                          <button
                            type="button"
                            className={btnGhostCls}
                            disabled={ocupado || motivo.trim().length < 3}
                            onClick={() =>
                              lanzar(
                                s,
                                'rechazar',
                                can('cambiarEstado', 'compra'),
                              )
                            }
                          >
                            Rechazar
                          </button>
                        </>
                      )}
                    {s.estado === 'aprobada' && can('crear', 'compra') && (
                      <>
                        <button
                          type="button"
                          className={btnGhostCls}
                          disabled={ocupado || !proveedor}
                          onClick={() =>
                            lanzar(s, 'pedido', can('crear', 'compra'))
                          }
                        >
                          → Pedido
                        </button>
                        <button
                          type="button"
                          className={btnGhostCls}
                          disabled={ocupado || invitados.length === 0}
                          onClick={() =>
                            lanzar(s, 'peticion', can('crear', 'compra'))
                          }
                        >
                          → Petición de ofertas
                        </button>
                      </>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ─────────────────────── peticiones de ofertas ─────────────────────── */

function Peticiones() {
  const lista = useQuery({
    queryKey: ['compras', 'peticiones'],
    queryFn: () => comprasApi.peticiones(),
  });
  return (
    <section className="space-y-6">
      {lista.isError && (
        <ErrorBanner message={(lista.error as Error).message} />
      )}
      {(lista.data ?? []).length === 0 && (
        <p className="text-sm text-gray-500">
          Sin peticiones de ofertas. Se crean desde una solicitud aprobada.
        </p>
      )}
      {(lista.data ?? []).map((p) => (
        <Peticion key={p.id} p={p} />
      ))}
    </section>
  );
}

function Peticion({ p }: { p: PeticionOfertaDto }) {
  const [proveedor, setProveedor] = useState('');
  const [precios, setPrecios] = useState<Record<string, string>>({});
  const [plazo, setPlazo] = useState('');
  const { can } = usePermisos();
  const toast = useToast();
  const avisarError = useAvisarError();
  const refrescar = useRefrescar();
  const oferta = useMutation({
    mutationFn: () =>
      comprasApi.registrarOferta(p.id, {
        contactId: proveedor,
        plazoDias: plazo.trim() ? Number(plazo) : null,
        precios: Object.entries(precios)
          .filter(([, v]) => v.trim())
          .map(([lineaId, v]) => ({ lineaId, precioUnitario: num(v) })),
      }),
    onSuccess: () => {
      setPrecios({});
      toast('Oferta registrada');
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const adjudicar = useMutation({
    mutationFn: (modo: 'linea' | 'completa') =>
      comprasApi.adjudicar(
        p.id,
        modo === 'completa'
          ? { fecha: hoy(), contactId: p.comparativa.mejorCompleta! }
          : {
              fecha: hoy(),
              porLinea: p.comparativa.lineas
                .filter((l) => l.mejor)
                .map((l) => ({
                  lineaId: l.lineaId,
                  contactId: l.mejor!.contactId,
                })),
            },
        p.version,
        nuevoUuid(),
      ),
    onSuccess: (r) => {
      toast(`Adjudicada: ${r.pedidos.length} pedido(s) emitido(s)`);
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const ocupado = oferta.isPending || adjudicar.isPending;
  const guarda = useGuarda(ocupado);
  const nombre = (id: string) =>
    p.proveedores.find((x) => x.contactId === id)?.contactName ?? '';
  const abierta = p.estado === 'abierta';
  const todasConMejor = p.comparativa.lineas.every((l) => l.mejor);

  return (
    <div className="rounded-xl border bg-white p-3 shadow-sm">
      <p className="mb-2 text-sm font-semibold">
        {p.numero} · {p.titulo}
        <span className="ml-2 text-xs font-normal text-gray-500">
          {ESTADO_PETICION_OFERTA_LABELS[p.estado]}
          {p.fechaLimite && ` · límite ${formatDate(p.fechaLimite)}`}
        </span>
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-gray-500">
            <tr>
              <th className="py-1">Línea</th>
              <th className="py-1 text-right">Cantidad</th>
              {p.proveedores.map((x) => (
                <th key={x.contactId} className="py-1 text-right">
                  {x.contactName}
                  {x.plazoDias !== null && (
                    <span className="block font-normal">{x.plazoDias} d</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.comparativa.lineas.map((l) => (
              <tr key={l.lineaId} className="border-t border-gray-100">
                <td className="py-1">{l.descripcion}</td>
                <td className="py-1 text-right tabular-nums">
                  {Number(l.cantidad)}
                </td>
                {p.proveedores.map((x) => {
                  const o = l.ofertas.find((y) => y.contactId === x.contactId);
                  const mejor = l.mejor?.contactId === x.contactId;
                  return (
                    <td
                      key={x.contactId}
                      className={`py-1 text-right tabular-nums ${mejor ? 'font-semibold text-emerald-700' : ''}`}
                    >
                      {o
                        ? `${formatEur(o.importe)} (${Number(o.precioUnitario)})`
                        : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="border-t font-semibold">
              <td className="py-1">Total</td>
              <td />
              {p.proveedores.map((x) => {
                const o = p.comparativa.ofertas.find(
                  (y) => y.contactId === x.contactId,
                );
                return (
                  <td
                    key={x.contactId}
                    className="py-1 text-right tabular-nums"
                  >
                    {o ? formatEur(o.total) : '—'}
                    {o && !o.completa && (
                      <span className="block text-[11px] font-normal text-gray-500">
                        incompleta
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        Mejor por línea: {formatEur(p.comparativa.totalMejorPorLinea)}
        {p.comparativa.mejorCompleta &&
          ` · mejor oferta completa: ${nombre(p.comparativa.mejorCompleta)}`}
      </p>
      {abierta && (
        <Autorizado accion="cambiarEstado" recurso="compra">
          <form
            className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (
                !can('cambiarEstado', 'compra') ||
                !proveedor ||
                ocupado ||
                !guarda.intentar()
              )
                return;
              oferta.mutate();
            }}
          >
            <select
              className={selectCls}
              value={proveedor}
              onChange={(e) => setProveedor(e.target.value)}
              aria-label="Proveedor que oferta"
            >
              <option value="">Proveedor…</option>
              {p.proveedores.map((x) => (
                <option key={x.contactId} value={x.contactId}>
                  {x.contactName}
                </option>
              ))}
            </select>
            {p.lineas.map((l) => (
              <input
                key={l.id}
                className={`${inputCls} w-28`}
                placeholder={`€/${l.unidad} ${l.descripcion.slice(0, 12)}`}
                inputMode="decimal"
                value={precios[l.id] ?? ''}
                onChange={(e) =>
                  setPrecios({ ...precios, [l.id]: e.target.value })
                }
                aria-label={`Precio ${l.descripcion}`}
              />
            ))}
            <input
              className={`${inputCls} w-20`}
              placeholder="Plazo d"
              inputMode="numeric"
              value={plazo}
              onChange={(e) => setPlazo(e.target.value)}
              aria-label="Plazo en días"
            />
            <button
              type="submit"
              className={btnGhostCls}
              disabled={!proveedor || ocupado}
            >
              Registrar oferta
            </button>
            <button
              type="button"
              className={btnPrimaryCls}
              disabled={!todasConMejor || ocupado}
              onClick={() => {
                if (
                  !can('cambiarEstado', 'compra') ||
                  ocupado ||
                  !guarda.intentar()
                )
                  return;
                adjudicar.mutate('linea');
              }}
            >
              Adjudicar por línea al mejor
            </button>
            <button
              type="button"
              className={btnGhostCls}
              disabled={!p.comparativa.mejorCompleta || ocupado}
              onClick={() => {
                if (
                  !can('cambiarEstado', 'compra') ||
                  ocupado ||
                  !guarda.intentar()
                )
                  return;
                adjudicar.mutate('completa');
              }}
            >
              Todo a la mejor completa
            </button>
          </form>
        </Autorizado>
      )}
    </div>
  );
}

/* ─────────────────── pedidos, recepciones y facturas ─────────────────── */

function Pedidos() {
  const [abierto, setAbierto] = useState<string | null>(null);
  const lista = useQuery({
    queryKey: ['compras', 'pedidos'],
    queryFn: () => comprasApi.pedidos(),
  });
  const filas = lista.data ?? [];
  const actual = filas.find((p) => p.id === abierto) ?? null;
  return (
    <section>
      {lista.isError && (
        <ErrorBanner message={(lista.error as Error).message} />
      )}
      <div className="mb-4 overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2">Pedido</th>
              <th className="px-3 py-2">Proveedor</th>
              <th className="px-3 py-2 text-right">Importe</th>
              <th className="px-3 py-2 text-right">Recibido sin facturar</th>
              <th className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((p) => (
              <tr
                key={p.id}
                className={`cursor-pointer border-t border-gray-100 hover:bg-amber-50/40 ${abierto === p.id ? 'bg-amber-50' : ''}`}
                onClick={() => setAbierto(p.id)}
              >
                <td className="px-3 py-1.5 font-medium">{p.numero}</td>
                <td className="px-3 py-1.5">{p.contactName}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {formatEur(p.importe)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {formatEur(
                    p.lineas.reduce((t, l) => t + l.recibidoSinFacturar, 0),
                  )}
                </td>
                <td className="px-3 py-1.5 text-xs">{p.estado}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {actual && <DetallePedido key={actual.id} p={actual} />}
    </section>
  );
}

function DetallePedido({ p }: { p: PedidoCompraDetalleDto }) {
  const [almacenId, setAlmacenId] = useState('');
  const [albaran, setAlbaran] = useState('');
  const [recibir, setRecibir] = useState<
    Record<string, { cantidad: string; lotes: string }>
  >({});
  const [factura, setFactura] = useState('');
  const [facturar, setFacturar] = useState<
    Record<string, { cantidad: string; precio: string }>
  >({});
  const [cuadre, setCuadre] = useState<CuadreFacturaDto | null>(null);
  const claveGr = useRef(nuevoUuid());
  const claveFa = useRef(nuevoUuid());
  const { can } = usePermisos();
  const toast = useToast();
  const avisarError = useAvisarError();
  const refrescar = useRefrescar();
  const almacenes = useQuery({
    queryKey: ['almacen', 'almacenes'],
    queryFn: () => almacenApi.almacenes(),
  });
  const recepcion = useMutation({
    mutationFn: () =>
      comprasApi.recibir(
        p.id,
        {
          fecha: hoy(),
          albaranNumero: albaran,
          almacenId: almacenId || null,
          lineas: Object.entries(recibir)
            .filter(([, v]) => num(v.cantidad) > 0)
            .map(([lineaId, v]) => ({
              lineaId,
              cantidad: num(v.cantidad),
              ...(parseLotes(v.lotes) ? { lotes: parseLotes(v.lotes) } : {}),
            })),
        },
        claveGr.current,
      ),
    onSuccess: (r) => {
      claveGr.current = nuevoUuid();
      setRecibir({});
      setAlbaran('');
      toast(`Recepción registrada: pedido ${r.estado}`);
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const verificar = useMutation({
    mutationFn: () =>
      comprasApi.facturar(
        p.id,
        {
          invoiceNumber: factura,
          issueDate: hoy(),
          lineas: Object.entries(facturar)
            .filter(([, v]) => num(v.cantidad) > 0)
            .map(([lineaId, v]) => ({
              lineaId,
              cantidad: num(v.cantidad),
              precioUnitario: num(v.precio),
              vatPct: 21,
            })),
        },
        claveFa.current,
      ),
    onSuccess: (r) => {
      claveFa.current = nuevoUuid();
      setCuadre(r.cuadre);
      toast(
        r.cuadre?.bloqueada
          ? 'Factura registrada: no cuadra, queda bloqueada'
          : 'Factura registrada: cuadra con pedido y recepción',
        r.cuadre?.bloqueada ? 'error' : 'success',
      );
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const aprobar = useMutation({
    mutationFn: (invoiceId: string) => invoicesApi.approve(invoiceId),
    onSuccess: () => {
      setCuadre(null);
      toast('Factura aprobada');
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const ocupado =
    recepcion.isPending || verificar.isPending || aprobar.isPending;
  const guarda = useGuarda(ocupado);
  const recibible = ['emitido', 'servido_parcial', 'servido'].includes(
    p.estado,
  );

  return (
    <div className="rounded-xl border bg-white p-3 shadow-sm">
      <p className="mb-2 text-sm font-semibold">
        {p.numero} · {p.contactName}
        <span className="ml-2 text-xs font-normal text-gray-500">
          tolerancias: precio {p.tolerancias.precioPct} % /{' '}
          {formatEur(p.tolerancias.precioImporte)} · cantidad{' '}
          {p.tolerancias.cantidadPct} %
        </span>
      </p>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-gray-500">
          <tr>
            <th className="py-1">Línea</th>
            <th className="py-1 text-right">Pedida</th>
            <th className="py-1 text-right">Recibida</th>
            <th className="py-1 text-right">Facturada</th>
            <th className="py-1 text-right">Precio</th>
            <th className="py-1">Recibir</th>
            <th className="py-1">Facturar</th>
          </tr>
        </thead>
        <tbody>
          {p.lineas.map((l) => (
            <tr key={l.id} className="border-t border-gray-100 align-top">
              <td className="py-1">
                {l.descripcion}
                <span className="block text-[11px] text-gray-500">
                  {TIPO_LINEA_COMPRA_LABELS[l.tipo]}
                  {!l.exigeRecepcion &&
                    ' · sin recepción (factura contra pedido)'}
                </span>
              </td>
              <td className="py-1 text-right tabular-nums">
                {Number(l.pedida)}
              </td>
              <td className="py-1 text-right tabular-nums">
                {Number(l.recibida)}
              </td>
              <td className="py-1 text-right tabular-nums">
                {Number(l.facturada)}
              </td>
              <td className="py-1 text-right tabular-nums">
                {l.precioUnitario}
              </td>
              <td className="py-1">
                {l.exigeRecepcion &&
                  Number(l.pendienteRecibir) > 0 &&
                  recibible && (
                    <span className="flex gap-1">
                      <input
                        className={`${inputCls} w-20`}
                        placeholder={l.pendienteRecibir}
                        inputMode="decimal"
                        value={recibir[l.id]?.cantidad ?? ''}
                        onChange={(e) =>
                          setRecibir({
                            ...recibir,
                            [l.id]: {
                              cantidad: e.target.value,
                              lotes: recibir[l.id]?.lotes ?? '',
                            },
                          })
                        }
                        aria-label="Cantidad a recibir"
                      />
                      {l.articuloId && (
                        <input
                          className={`${inputCls} w-28`}
                          placeholder="Lotes L1:40"
                          value={recibir[l.id]?.lotes ?? ''}
                          onChange={(e) =>
                            setRecibir({
                              ...recibir,
                              [l.id]: {
                                cantidad: recibir[l.id]?.cantidad ?? '',
                                lotes: e.target.value,
                              },
                            })
                          }
                          aria-label="Lotes recibidos"
                        />
                      )}
                    </span>
                  )}
              </td>
              <td className="py-1">
                {Number(l.pendienteFacturar) > 0 && (
                  <span className="flex gap-1">
                    <input
                      className={`${inputCls} w-20`}
                      placeholder={l.pendienteFacturar}
                      inputMode="decimal"
                      value={facturar[l.id]?.cantidad ?? ''}
                      onChange={(e) =>
                        setFacturar({
                          ...facturar,
                          [l.id]: {
                            cantidad: e.target.value,
                            precio:
                              facturar[l.id]?.precio ??
                              String(l.precioUnitario),
                          },
                        })
                      }
                      aria-label="Cantidad facturada"
                    />
                    <input
                      className={`${inputCls} w-24`}
                      inputMode="decimal"
                      value={facturar[l.id]?.precio ?? String(l.precioUnitario)}
                      onChange={(e) =>
                        setFacturar({
                          ...facturar,
                          [l.id]: {
                            cantidad: facturar[l.id]?.cantidad ?? '',
                            precio: e.target.value,
                          },
                        })
                      }
                      aria-label="Precio facturado"
                    />
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Autorizado accion="crear" recurso="recepcion">
          <form
            className="flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (
                !can('crear', 'recepcion') ||
                !albaran.trim() ||
                ocupado ||
                !guarda.intentar()
              )
                return;
              recepcion.mutate();
            }}
          >
            <input
              className={inputCls}
              placeholder="Albarán del proveedor"
              value={albaran}
              onChange={(e) => setAlbaran(e.target.value)}
              aria-label="Número de albarán"
            />
            <select
              className={selectCls}
              value={almacenId}
              onChange={(e) => setAlmacenId(e.target.value)}
              aria-label="Almacén de entrada"
            >
              <option value="">Sin entrada en almacén</option>
              {(almacenes.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.codigo} · {a.nombre}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className={btnPrimaryCls}
              disabled={!albaran.trim() || ocupado}
            >
              Registrar recepción
            </button>
          </form>
        </Autorizado>
        <Autorizado accion="crear" recurso="compra">
          <form
            className="flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (
                !can('crear', 'compra') ||
                !factura.trim() ||
                ocupado ||
                !guarda.intentar()
              )
                return;
              verificar.mutate();
            }}
          >
            <input
              className={inputCls}
              placeholder="Nº de factura del proveedor"
              value={factura}
              onChange={(e) => setFactura(e.target.value)}
              aria-label="Número de factura"
            />
            <button
              type="submit"
              className={btnPrimaryCls}
              disabled={!factura.trim() || ocupado}
            >
              Verificar factura
            </button>
          </form>
        </Autorizado>
      </div>
      {cuadre && (
        <div
          className={`mt-3 rounded-lg border p-2 text-xs ${cuadre.bloqueada ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}
        >
          <p className="mb-1 font-semibold">
            Cuadre de la factura {cuadre.invoiceNumber}:{' '}
            {cuadre.bloqueada ? 'bloqueada para pago' : 'cuadra'}
          </p>
          <ul>
            {cuadre.lineas.map((l, i) => (
              <li key={i}>
                {l.estado === 'cuadra' ? '✓' : '✗'} {Number(l.cantidadFactura)}{' '}
                a {Number(l.precioFactura)} (pedido {Number(l.precioPedido)},
                recibido {Number(l.cantidadRecibida)})
                {l.motivos.map((m) => (
                  <span key={m.codigo} className="block text-red-700">
                    {m.detalle}
                  </span>
                ))}
              </li>
            ))}
          </ul>
          {!cuadre.bloqueada && (
            <Autorizado accion="cambiarEstado" recurso="factura">
              <button
                type="button"
                className={`${btnPrimaryCls} mt-2`}
                disabled={ocupado}
                onClick={() => {
                  if (
                    !can('cambiarEstado', 'factura') ||
                    ocupado ||
                    !guarda.intentar()
                  )
                    return;
                  aprobar.mutate(cuadre.invoiceId);
                }}
              >
                Aprobar factura
              </button>
            </Autorizado>
          )}
        </div>
      )}
      {p.recepciones.length > 0 && (
        <p className="mt-3 text-xs text-gray-600">
          Recepciones:{' '}
          {p.recepciones
            .map(
              (r) =>
                `${formatDate(r.fecha)} ${r.albaranNumero} ${formatEur(r.importe)}`,
            )
            .join(' · ')}
        </p>
      )}
      {p.facturas.length > 0 && (
        <p className="text-xs text-gray-600">
          Facturas:{' '}
          {p.facturas
            .map(
              (f) => `${f.invoiceNumber} (${f.estado}) ${formatEur(f.importe)}`,
            )
            .join(' · ')}
        </p>
      )}
    </div>
  );
}
