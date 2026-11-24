'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRef, useState } from 'react';
import {
  ESTADOS_SOLICITUD_MATERIAL,
  ESTADO_SOLICITUD_MATERIAL_LABELS,
  type EstadoSolicitudMaterial,
  type SolicitudMaterialDto,
} from '@erp/shared';
import {
  almacenApi,
  contactsApi,
  formatDate,
  projectsApi,
  solicitudesMaterialApi,
} from '@/lib/api';
import { nuevoUuid } from '@/lib/api-error';
import { usePermisos } from '@/lib/permisos';
import { IconCube } from '@/components/icons';
import { useAvisarError, useToast } from '@/components/toast';
import {
  EmptyState,
  ErrorBanner,
  Modal,
  PageHeader,
  TableSkeleton,
  btnGhostCls,
  btnPrimaryCls,
  fieldCls,
  labelCls,
  selectCls,
} from '@/components/ui';

const COLOR: Record<EstadoSolicitudMaterial, string> = {
  abierta: 'bg-sky-100 text-sky-700',
  servida_parcial: 'bg-amber-100 text-amber-800',
  servida: 'bg-emerald-100 text-emerald-700',
  cancelada: 'bg-gray-100 text-gray-500',
};

const hoy = () => new Date().toISOString().slice(0, 10);
const num = (v: string) => Number(v.trim().replace(',', '.'));
const cant = (n: number, u?: string) =>
  `${n.toLocaleString('es-ES', { maximumFractionDigits: 3 })}${u ? ` ${u}` : ''}`;

/** Mutación con guarda de envío único e Idempotency-Key estable. */
function useEnvio<T>(fn: (clave: string) => Promise<T>, ok: (r: T) => void) {
  const clave = useRef(nuevoUuid());
  const qc = useQueryClient();
  const avisarError = useAvisarError();
  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: ['solicitudes-material'] });
    void qc.invalidateQueries({ queryKey: ['almacen'] });
  };
  const m = useMutation({
    mutationFn: () => fn(clave.current),
    onSuccess: (r) => {
      clave.current = nuevoUuid();
      refrescar();
      ok(r);
    },
    onError: (e) => avisarError(e, refrescar),
  });
  return {
    pendiente: m.isPending,
    enviar: () => {
      if (!m.isPending) m.mutate();
    },
  };
}

export default function SolicitudesMaterialPage() {
  const [estado, setEstado] = useState('');
  const [soloFaltante, setSoloFaltante] = useState(false);
  const [nueva, setNueva] = useState(false);
  const [accion, setAccion] = useState<{
    s: SolicitudMaterialDto;
    tipo: 'servir' | 'cancelar' | 'pedido';
  } | null>(null);
  const { can } = usePermisos();
  const opera = can('crear');
  const compra = can('editar', 'contabilidad');
  const toast = useToast();
  const avisarError = useAvisarError();
  const qc = useQueryClient();

  const lista = useQuery({
    queryKey: ['solicitudes-material', estado, soloFaltante],
    queryFn: () =>
      solicitudesMaterialApi.listar({
        estado: estado || undefined,
        conFaltante: soloFaltante,
      }),
  });
  const reservar = useMutation({
    mutationFn: (s: SolicitudMaterialDto) =>
      solicitudesMaterialApi.reservar(s.id, s.version),
    onSuccess: (s) => {
      toast(
        s.conFaltante
          ? `${s.numero}: sigue habiendo faltante`
          : `${s.numero}: faltante cubierto con stock`,
      );
      void qc.invalidateQueries({ queryKey: ['solicitudes-material'] });
      void qc.invalidateQueries({ queryKey: ['almacen'] });
    },
    onError: (e) => avisarError(e),
  });
  const filas = lista.data ?? [];

  return (
    <div>
      <PageHeader
        title="Solicitudes de material"
        subtitle="La obra pide material: lo disponible se reserva, lo que falta se compra y servir lo imputa a la obra a su precio medio."
        count={filas.length}
      >
        <Link href="/almacen" className={btnGhostCls}>
          Volver al almacén
        </Link>
        {opera && (
          <button
            type="button"
            className={btnPrimaryCls}
            onClick={() => setNueva(true)}
          >
            Nueva solicitud
          </button>
        )}
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          className={selectCls}
          value={estado}
          onChange={(e) => setEstado(e.target.value)}
          aria-label="Estado"
        >
          <option value="">Todos los estados</option>
          {ESTADOS_SOLICITUD_MATERIAL.map((e) => (
            <option key={e} value={e}>
              {ESTADO_SOLICITUD_MATERIAL_LABELS[e]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={soloFaltante}
            onChange={(e) => setSoloFaltante(e.target.checked)}
          />
          Solo con faltante sin pedido
        </label>
      </div>

      {lista.isError && (
        <ErrorBanner message={(lista.error as Error).message} />
      )}
      {lista.isLoading && <TableSkeleton />}
      {lista.isSuccess && filas.length === 0 && (
        <EmptyState icon={<IconCube />} title="Sin solicitudes">
          Las obras piden aquí el material que necesitan del almacén.
        </EmptyState>
      )}

      <div className="space-y-3">
        {filas.map((s) => {
          const abierta =
            s.estado === 'abierta' || s.estado === 'servida_parcial';
          const hayReserva = s.lineas.some((l) => l.reservada > 0);
          return (
            <div
              key={s.id}
              className="rounded-xl border bg-white p-4 shadow-sm"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-semibold">{s.numero}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${COLOR[s.estado]}`}
                >
                  {ESTADO_SOLICITUD_MATERIAL_LABELS[s.estado]}
                </span>
                <span className="text-sm text-gray-600">
                  Obra {s.projectCodigo} · {s.almacenCodigo}
                  {s.fechaNecesidad &&
                    ` · necesaria el ${formatDate(s.fechaNecesidad)}`}
                </span>
                {s.conFaltante && (
                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">
                    Faltante sin pedido
                  </span>
                )}
                <div className="ml-auto flex flex-wrap gap-2">
                  {abierta && opera && (
                    <>
                      <button
                        type="button"
                        className={btnGhostCls}
                        disabled={reservar.isPending}
                        onClick={() => reservar.mutate(s)}
                      >
                        Reservar faltante
                      </button>
                      <button
                        type="button"
                        className={btnGhostCls}
                        disabled={!hayReserva}
                        onClick={() => setAccion({ s, tipo: 'servir' })}
                      >
                        Servir
                      </button>
                      <button
                        type="button"
                        className={btnGhostCls}
                        onClick={() => setAccion({ s, tipo: 'cancelar' })}
                      >
                        Cancelar
                      </button>
                    </>
                  )}
                  {s.conFaltante && compra && (
                    <button
                      type="button"
                      className={btnPrimaryCls}
                      onClick={() => setAccion({ s, tipo: 'pedido' })}
                    >
                      Pedir faltante
                    </button>
                  )}
                </div>
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-gray-500">
                  <tr>
                    <th className="py-1">Artículo</th>
                    <th className="py-1 text-right">Solicitada</th>
                    <th className="py-1 text-right">Reservada</th>
                    <th className="py-1 text-right">Servida</th>
                    <th className="py-1 text-right">Faltante</th>
                    <th className="py-1">Pedido</th>
                  </tr>
                </thead>
                <tbody>
                  {s.lineas.map((l) => (
                    <tr key={l.id} className="border-t border-gray-100">
                      <td className="py-1">
                        <span className="font-medium">{l.articuloCodigo}</span>{' '}
                        {l.articuloNombre}
                      </td>
                      <td className="py-1 text-right tabular-nums">
                        {cant(l.solicitada, l.unidad)}
                      </td>
                      <td className="py-1 text-right tabular-nums">
                        {cant(l.reservada)}
                      </td>
                      <td className="py-1 text-right tabular-nums">
                        {cant(l.servida)}
                      </td>
                      <td
                        className={`py-1 text-right tabular-nums ${l.faltante > 0 ? 'font-semibold text-red-700' : ''}`}
                      >
                        {cant(l.faltante)}
                      </td>
                      <td className="py-1 text-gray-600">
                        {l.pedidoNumero ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {s.motivoCancelacion && (
                <p className="mt-2 text-xs text-gray-500">
                  Cancelada: {s.motivoCancelacion}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <NuevaSolicitudModal open={nueva} onClose={() => setNueva(false)} />
      <ServirModal
        s={accion?.tipo === 'servir' ? accion.s : null}
        onClose={() => setAccion(null)}
      />
      <CancelarModal
        s={accion?.tipo === 'cancelar' ? accion.s : null}
        onClose={() => setAccion(null)}
      />
      <PedidoModal
        s={accion?.tipo === 'pedido' ? accion.s : null}
        onClose={() => setAccion(null)}
      />
    </div>
  );
}

function Pie({
  pendiente,
  onClose,
  texto,
}: {
  pendiente: boolean;
  onClose: () => void;
  texto: string;
}) {
  return (
    <div className="flex justify-end gap-2 sm:col-span-2">
      <button type="button" className={btnGhostCls} onClick={onClose}>
        Cerrar
      </button>
      <button type="submit" className={btnPrimaryCls} disabled={pendiente}>
        {pendiente ? 'Guardando…' : texto}
      </button>
    </div>
  );
}

function NuevaSolicitudModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [almacenId, setAlmacenId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [fecha, setFecha] = useState('');
  const [lineas, setLineas] = useState([{ articuloId: '', cantidad: '' }]);
  const toast = useToast();
  const { can } = usePermisos();
  const almacenes = useQuery({
    queryKey: ['almacen', 'almacenes'],
    queryFn: almacenApi.almacenes,
    enabled: open,
  });
  const articulos = useQuery({
    queryKey: ['almacen', 'articulos'],
    queryFn: () => almacenApi.articulos(),
    enabled: open,
  });
  const obras = useQuery({
    queryKey: ['projects', 'solicitudes'],
    queryFn: () => projectsApi.list('', ''),
    enabled: open,
  });
  const op = useEnvio(
    (clave) =>
      solicitudesMaterialApi.crear(
        {
          almacenId,
          projectId,
          fechaNecesidad: fecha || null,
          lineas: lineas.map((l) => ({
            articuloId: l.articuloId,
            cantidad: num(l.cantidad),
          })),
        },
        clave,
      ),
    (s) => {
      toast(
        s.conFaltante
          ? `${s.numero} creada: parte del material falta y hay que comprarlo`
          : `${s.numero} creada: todo el material queda reservado`,
      );
      setLineas([{ articuloId: '', cantidad: '' }]);
      onClose();
    },
  );
  return (
    <Modal
      open={open}
      wide
      title="Nueva solicitud de material"
      onClose={onClose}
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (can('crear')) op.enviar();
        }}
      >
        <div>
          <label className={labelCls} htmlFor="sm-almacen">
            Almacén
          </label>
          <select
            id="sm-almacen"
            className={fieldCls}
            value={almacenId}
            required
            onChange={(e) => setAlmacenId(e.target.value)}
          >
            <option value="">Selecciona el almacén</option>
            {(almacenes.data ?? [])
              .filter((a) => a.activo)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.codigo} · {a.nombre}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="sm-obra">
            Obra
          </label>
          <select
            id="sm-obra"
            className={fieldCls}
            value={projectId}
            required
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">Selecciona la obra</option>
            {(obras.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.code} · {o.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="sm-fecha">
            Necesaria el
          </label>
          <input
            id="sm-fecha"
            type="date"
            className={fieldCls}
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2 space-y-2">
          <p className={labelCls}>Material</p>
          {lineas.map((l, i) => (
            <div key={i} className="flex gap-2">
              <select
                aria-label="Artículo"
                className={`${fieldCls} flex-1`}
                value={l.articuloId}
                required
                onChange={(e) =>
                  setLineas(
                    lineas.map((x, j) =>
                      j === i ? { ...x, articuloId: e.target.value } : x,
                    ),
                  )
                }
              >
                <option value="">Artículo…</option>
                {(articulos.data ?? [])
                  .filter((a) => a.activo)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.codigo} · {a.nombre} ({a.unidad})
                    </option>
                  ))}
              </select>
              <input
                aria-label="Cantidad"
                className={`${fieldCls} w-28`}
                inputMode="decimal"
                placeholder="Cantidad"
                value={l.cantidad}
                required
                onChange={(e) =>
                  setLineas(
                    lineas.map((x, j) =>
                      j === i ? { ...x, cantidad: e.target.value } : x,
                    ),
                  )
                }
              />
              {lineas.length > 1 && (
                <button
                  type="button"
                  aria-label="Quitar línea"
                  className="px-2 text-gray-400 hover:text-red-600"
                  onClick={() => setLineas(lineas.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className="text-xs font-medium text-amber-700 hover:underline"
            onClick={() =>
              setLineas([...lineas, { articuloId: '', cantidad: '' }])
            }
          >
            + Añadir línea
          </button>
        </div>
        <Pie pendiente={op.pendiente} onClose={onClose} texto="Solicitar" />
      </form>
    </Modal>
  );
}

function ServirModal({
  s,
  onClose,
}: {
  s: SolicitudMaterialDto | null;
  onClose: () => void;
}) {
  const [fecha, setFecha] = useState(hoy);
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const toast = useToast();
  const { can } = usePermisos();
  const op = useEnvio(
    (clave) => {
      const lineas = Object.entries(cantidades)
        .filter(([, v]) => v.trim() !== '' && num(v) > 0)
        .map(([lineaId, v]) => ({ lineaId, cantidad: num(v) }));
      return solicitudesMaterialApi.servir(
        s!.id,
        { fecha, ...(lineas.length > 0 && { lineas }) },
        s!.version,
        clave,
      );
    },
    (r) => {
      toast(`${r.solicitud.numero}: servida e imputada a la obra`);
      setCantidades({});
      onClose();
    },
  );
  return (
    <Modal
      open={s !== null}
      title={s ? `Servir ${s.numero}` : ''}
      onClose={onClose}
    >
      {s && (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (can('crear')) op.enviar();
          }}
        >
          <p className="text-sm text-gray-600">
            Deja las cantidades vacías para servir todo lo reservado. Se imputa
            a la obra a precio medio.
          </p>
          {s.lineas.map((l) => (
            <div key={l.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1">
                {l.articuloCodigo} · reservado {cant(l.reservada, l.unidad)} ·
                pendiente {cant(l.solicitada - l.servida)}
              </span>
              <input
                aria-label={`Cantidad de ${l.articuloCodigo}`}
                className={`${fieldCls} w-28`}
                inputMode="decimal"
                value={cantidades[l.id] ?? ''}
                onChange={(e) =>
                  setCantidades({ ...cantidades, [l.id]: e.target.value })
                }
              />
            </div>
          ))}
          <div>
            <label className={labelCls} htmlFor="sv-fecha">
              Fecha
            </label>
            <input
              id="sv-fecha"
              type="date"
              className={fieldCls}
              value={fecha}
              required
              onChange={(e) => setFecha(e.target.value)}
            />
          </div>
          <Pie pendiente={op.pendiente} onClose={onClose} texto="Servir" />
        </form>
      )}
    </Modal>
  );
}

function CancelarModal({
  s,
  onClose,
}: {
  s: SolicitudMaterialDto | null;
  onClose: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const toast = useToast();
  const { can } = usePermisos();
  const op = useEnvio(
    (clave) =>
      solicitudesMaterialApi.cancelar(s!.id, motivo.trim(), s!.version, clave),
    (r) => {
      toast(`${r.numero} cancelada: reserva liberada`);
      setMotivo('');
      onClose();
    },
  );
  return (
    <Modal
      open={s !== null}
      title={s ? `Cancelar ${s.numero}` : ''}
      onClose={onClose}
    >
      {s && (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (can('crear')) op.enviar();
          }}
        >
          <label className={labelCls} htmlFor="cn-motivo">
            Motivo
          </label>
          <input
            id="cn-motivo"
            className={fieldCls}
            value={motivo}
            minLength={3}
            maxLength={240}
            required
            onChange={(e) => setMotivo(e.target.value)}
          />
          <Pie
            pendiente={op.pendiente}
            onClose={onClose}
            texto="Cancelar solicitud"
          />
        </form>
      )}
    </Modal>
  );
}

function PedidoModal({
  s,
  onClose,
}: {
  s: SolicitudMaterialDto | null;
  onClose: () => void;
}) {
  const [contactId, setContactId] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [costes, setCostes] = useState<Record<string, string>>({});
  const toast = useToast();
  const { can } = usePermisos();
  const proveedores = useQuery({
    queryKey: ['contacts', 'proveedores'],
    queryFn: () => contactsApi.list('', 'proveedor'),
    enabled: s !== null,
  });
  const pendientes = (s?.lineas ?? []).filter(
    (l) => l.faltante > 0 && !l.pedidoId,
  );
  const op = useEnvio(
    (clave) =>
      solicitudesMaterialApi.pedido(
        s!.id,
        {
          contactId,
          fecha,
          lineas: pendientes.map((l) => ({
            lineaId: l.id,
            costeUnitario: num(costes[l.id] ?? '0'),
          })),
        },
        clave,
      ),
    (r) => {
      toast(
        `Pedido ${r.pedido.orderNumber} emitido por el faltante de ${r.solicitud.numero}`,
      );
      setCostes({});
      onClose();
    },
  );
  return (
    <Modal
      open={s !== null}
      title={s ? `Pedir el faltante de ${s.numero}` : ''}
      onClose={onClose}
    >
      {s && (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (can('editar', 'contabilidad')) op.enviar();
          }}
        >
          <div>
            <label className={labelCls} htmlFor="pd-prov">
              Proveedor
            </label>
            <select
              id="pd-prov"
              className={fieldCls}
              value={contactId}
              required
              onChange={(e) => setContactId(e.target.value)}
            >
              <option value="">Selecciona el proveedor</option>
              {(proveedores.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.legalName}
                </option>
              ))}
            </select>
          </div>
          {pendientes.map((l) => (
            <div key={l.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1">
                {l.articuloCodigo} · faltan {cant(l.faltante, l.unidad)}
              </span>
              <input
                aria-label={`Coste unitario de ${l.articuloCodigo}`}
                className={`${fieldCls} w-28`}
                inputMode="decimal"
                placeholder="€/ud"
                value={costes[l.id] ?? ''}
                required
                onChange={(e) =>
                  setCostes({ ...costes, [l.id]: e.target.value })
                }
              />
            </div>
          ))}
          <div>
            <label className={labelCls} htmlFor="pd-fecha">
              Fecha del pedido
            </label>
            <input
              id="pd-fecha"
              type="date"
              className={fieldCls}
              value={fecha}
              required
              onChange={(e) => setFecha(e.target.value)}
            />
          </div>
          <p className="text-xs text-gray-500">
            El pedido pasa por el control presupuestario de la obra y por las
            aprobaciones de compras.
          </p>
          <Pie
            pendiente={op.pendiente}
            onClose={onClose}
            texto="Emitir pedido"
          />
        </form>
      )}
    </Modal>
  );
}
