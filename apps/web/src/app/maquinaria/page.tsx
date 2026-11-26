'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  ESTADO_ORDEN_TRABAJO_LABELS,
  TIPO_ORDEN_TRABAJO_LABELS,
  type AccionOrden,
  type EquipoEamDto,
  type EstadoVencimiento,
  type OrdenTrabajoDto,
  type TipoContador,
  type TipoOrdenTrabajo,
} from '@erp/shared';
import { eamApi, formatDate, formatEur, projectsApi } from '@/lib/api';
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
const PREVENTIVO_CLS: Record<EstadoVencimiento, string> = {
  al_dia: 'bg-emerald-50 text-emerald-700',
  proximo: 'bg-amber-50 text-amber-700',
  vencido: 'bg-red-50 text-red-700',
};

function useRefrescar() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['eam'] });
    void qc.invalidateQueries({ queryKey: ['equipos'] });
  };
}

/** Hook de mutación con guarda de envío único, clave de idempotencia y avisos. */
function useAccion<T>(
  fn: (clave: string, v: T) => Promise<unknown>,
  ok: string,
) {
  const clave = useRef(nuevoUuid());
  const [guarda] = useState(crearGuardaEnvio);
  const toast = useToast();
  const avisarError = useAvisarError();
  const refrescar = useRefrescar();
  const m = useMutation({
    mutationFn: (v: T) => fn(clave.current, v),
    onSuccess: () => {
      clave.current = nuevoUuid();
      toast(ok);
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  useEffect(() => {
    if (!m.isPending) guarda.liberar();
  }, [m.isPending, guarda]);
  return {
    pendiente: m.isPending,
    lanzar: (permitido: boolean, v: T) => {
      if (!permitido || m.isPending || !guarda.intentar()) return;
      m.mutate(v);
    },
  };
}

/** Maquinaria y equipos: ficha EAM, mantenimiento y explotación. */
export default function MaquinariaPage() {
  const [seleccion, setSeleccion] = useState('');
  const { can } = usePermisos();
  const lista = useQuery({
    queryKey: ['eam', 'equipos'],
    queryFn: () => eamApi.equipos(),
  });
  const generar = useAccion(
    (clave) => eamApi.generarOrdenes(clave),
    'Órdenes preventivas generadas para los planes vencidos o próximos',
  );
  const elegido = (lista.data ?? []).find((e) => e.id === seleccion) ?? null;
  return (
    <div>
      <PageHeader
        title="Maquinaria y equipos"
        subtitle="Ficha y jerarquía, contadores, asignación a obra, planes preventivos, órdenes de trabajo y coste de explotación. El coste de las órdenes es del equipo: a la obra llega por los partes de maquinaria."
      >
        <Autorizado accion="crear" recurso="mantenimiento">
          <button
            type="button"
            className={btnGhostCls}
            disabled={generar.pendiente}
            onClick={() =>
              generar.lanzar(can('crear', 'mantenimiento'), undefined)
            }
          >
            Generar órdenes preventivas
          </button>
        </Autorizado>
      </PageHeader>
      {lista.isError && (
        <ErrorBanner message={(lista.error as Error).message} />
      )}
      <div className="mb-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <ul className="max-h-[32rem] space-y-1 overflow-y-auto rounded-xl border bg-white p-2 text-sm shadow-sm">
          {(lista.data ?? []).map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => setSeleccion(e.id)}
                className={`w-full rounded px-2 py-1.5 text-left ${e.id === seleccion ? 'bg-amber-50' : 'hover:bg-gray-50'}`}
              >
                <span className="font-medium">
                  {e.codigo ? `${e.codigo} · ` : ''}
                  {e.nombre}
                </span>
                {e.padreNombre && (
                  <span className="text-xs text-gray-500">
                    {' '}
                    (de {e.padreNombre})
                  </span>
                )}
                <span className="block text-xs text-gray-500">
                  {e.estado} · {e.contadorHoras} h · {e.contadorKm} km
                  {e.obraActual ? ` · ${e.obraActual.nombre}` : ''}
                  {e.ordenesAbiertas > 0 ? ` · ${e.ordenesAbiertas} OT` : ''}
                </span>
                {e.preventivo && (
                  <span
                    className={`mt-0.5 inline-block rounded px-1.5 text-[11px] ${PREVENTIVO_CLS[e.preventivo]}`}
                  >
                    preventivo {e.preventivo.replace('_', ' ')}
                  </span>
                )}
              </button>
            </li>
          ))}
          {lista.data?.length === 0 && (
            <li className="p-2 text-gray-500">
              Sin equipos (se dan de alta en Equipos).
            </li>
          )}
        </ul>
        {elegido ? (
          <Detalle key={elegido.id} e={elegido} todos={lista.data ?? []} />
        ) : (
          <p className="text-sm text-gray-500">Elige un equipo.</p>
        )}
      </div>
      <Explotacion />
    </div>
  );
}

function Detalle({ e, todos }: { e: EquipoEamDto; todos: EquipoEamDto[] }) {
  const { can } = usePermisos();
  const [codigo, setCodigo] = useState(e.codigo ?? '');
  const [serie, setSerie] = useState(e.numeroSerie ?? '');
  const [padre, setPadre] = useState(e.padreId ?? '');
  const [tipo, setTipo] = useState<TipoContador>('horas');
  const [valor, setValor] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [correccion, setCorreccion] = useState(false);
  const [motivo, setMotivo] = useState('');
  const obras = useQuery({
    queryKey: ['projects', 'maquinaria'],
    queryFn: () => projectsApi.list('', ''),
  });
  const [obraId, setObraId] = useState('');
  const [desde, setDesde] = useState(hoy);
  const asignaciones = useQuery({
    queryKey: ['eam', 'asignaciones', e.id],
    queryFn: () => eamApi.asignaciones(e.id),
  });
  const lecturas = useQuery({
    queryKey: ['eam', 'lecturas', e.id],
    queryFn: () => eamApi.lecturas(e.id),
  });
  const planes = useQuery({
    queryKey: ['eam', 'planes', e.id],
    queryFn: () => eamApi.planes(e.id),
  });
  const ordenes = useQuery({
    queryKey: ['eam', 'ordenes', e.id],
    queryFn: () => eamApi.ordenes({ equipoId: e.id }),
  });
  const [plan, setPlan] = useState({ nombre: '', dias: '', horas: '', km: '' });
  const [aviso, setAviso] = useState<{
    tipo: TipoOrdenTrabajo;
    descripcion: string;
    projectId: string;
  }>({
    tipo: 'correctiva',
    descripcion: '',
    projectId: '',
  });

  const guardarFicha = useAccion(
    () =>
      eamApi.ficha(
        e.id,
        {
          codigo: codigo || null,
          numeroSerie: serie || null,
          padreId: padre || null,
        },
        e.version,
      ),
    'Ficha guardada',
  );
  const leer = useAccion(
    (clave) =>
      eamApi.registrarLectura(
        e.id,
        { tipo, fecha, valor: num(valor), correccion, motivo: motivo || null },
        e.version,
        clave,
      ),
    'Lectura registrada',
  );
  const asignar = useAccion(
    (clave) => eamApi.asignar(e.id, { projectId: obraId, desde }, clave),
    'Equipo asignado a la obra',
  );
  const cerrarAsig = useAccion(
    (_c, a: { id: string; version: number }) =>
      eamApi.cerrarAsignacion(a.id, hoy(), a.version),
    'Asignación cerrada',
  );
  const crearPlan = useAccion(
    (clave) =>
      eamApi.crearPlan(
        e.id,
        {
          nombre: plan.nombre,
          periodicidadDias: plan.dias ? Number(plan.dias) : null,
          intervaloHoras: plan.horas ? num(plan.horas) : null,
          intervaloKm: plan.km ? num(plan.km) : null,
          ultimaFecha: hoy(),
          ultimaHoras: e.contadorHoras,
          ultimaKm: e.contadorKm,
        },
        clave,
      ),
    'Plan preventivo creado',
  );
  const crearOrden = useAccion(
    (clave) =>
      eamApi.crearOrden(
        {
          equipoId: e.id,
          tipo: aviso.tipo,
          descripcion: aviso.descripcion,
          projectId: aviso.projectId || e.obraActual?.projectId || null,
          fechaAviso: hoy(),
        },
        clave,
      ),
    'Orden de trabajo abierta',
  );
  const puedeFicha = can('editar', 'mantenimiento');
  const puedeAviso = can('crear', 'aviso_averia');
  const descendientes = new Set<string>([e.id]);
  let crece = true;
  while (crece) {
    crece = false;
    for (const x of todos) {
      if (
        x.padreId &&
        descendientes.has(x.padreId) &&
        !descendientes.has(x.id)
      ) {
        descendientes.add(x.id);
        crece = true;
      }
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <section className="rounded-xl border bg-white p-3 shadow-sm">
        <h2 className="mb-2 font-semibold">{e.nombre}</h2>
        <p className="mb-2 text-xs text-gray-600">
          {e.tipo} · {e.ownership} · {e.estado}
          {e.activoFijo
            ? ` · activo fijo ${e.activoFijo.codigo} (${e.activoFijo.estado})`
            : ' · sin activo fijo'}
          {e.componentes.length > 0 &&
            ` · componentes: ${e.componentes.map((c) => c.nombre).join(', ')}`}
        </p>
        <Autorizado accion="editar" recurso="mantenimiento">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(ev) => {
              ev.preventDefault();
              guardarFicha.lanzar(puedeFicha, undefined);
            }}
          >
            <input
              className={`${inputCls} w-28`}
              placeholder="Código"
              value={codigo}
              onChange={(ev) => setCodigo(ev.target.value)}
              aria-label="Código"
            />
            <input
              className={`${inputCls} w-36`}
              placeholder="Nº de serie"
              value={serie}
              onChange={(ev) => setSerie(ev.target.value)}
              aria-label="Número de serie"
            />
            <select
              className={selectCls}
              value={padre}
              onChange={(ev) => setPadre(ev.target.value)}
              aria-label="Conjunto del que es componente"
            >
              <option value="">Equipo raíz</option>
              {todos
                .filter((x) => !descendientes.has(x.id))
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    Componente de {x.nombre}
                  </option>
                ))}
            </select>
            <button
              type="submit"
              className={btnPrimaryCls}
              disabled={guardarFicha.pendiente}
            >
              Guardar ficha
            </button>
          </form>
        </Autorizado>
      </section>

      <section className="rounded-xl border bg-white p-3 shadow-sm">
        <h3 className="mb-2 font-semibold">Contadores</h3>
        <Autorizado accion="crear" recurso="aviso_averia">
          <form
            className="mb-2 flex flex-wrap items-end gap-2"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (!valor || (correccion && motivo.trim().length < 3)) return;
              leer.lanzar(puedeAviso, undefined);
            }}
          >
            <select
              className={selectCls}
              value={tipo}
              onChange={(ev) => setTipo(ev.target.value as TipoContador)}
              aria-label="Contador"
            >
              <option value="horas">Horas ({e.contadorHoras})</option>
              <option value="km">Km ({e.contadorKm})</option>
            </select>
            <input
              className={`${inputCls} w-28`}
              inputMode="decimal"
              placeholder="Lectura"
              value={valor}
              onChange={(ev) => setValor(ev.target.value)}
              aria-label="Lectura"
            />
            <input
              type="date"
              className={inputCls}
              value={fecha}
              max={hoy()}
              onChange={(ev) => setFecha(ev.target.value)}
              aria-label="Fecha"
            />
            <label className="text-xs">
              <input
                type="checkbox"
                checked={correccion}
                onChange={(ev) => setCorreccion(ev.target.checked)}
              />{' '}
              corrección
            </label>
            {correccion && (
              <input
                className={`${inputCls} flex-1`}
                placeholder="Motivo"
                value={motivo}
                onChange={(ev) => setMotivo(ev.target.value)}
                aria-label="Motivo"
              />
            )}
            <button
              type="submit"
              className={btnPrimaryCls}
              disabled={leer.pendiente}
            >
              Registrar
            </button>
          </form>
        </Autorizado>
        <ul className="max-h-32 overflow-y-auto text-xs text-gray-600">
          {(lecturas.data ?? []).slice(0, 10).map((l) => (
            <li key={l.id}>
              {formatDate(l.fecha)} · {l.tipo} {l.valor}{' '}
              {l.anterior !== null ? `(antes ${l.anterior})` : ''} · {l.origen}
              {l.motivo ? ` · ${l.motivo}` : ''}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border bg-white p-3 shadow-sm">
        <h3 className="mb-2 font-semibold">Asignación a obra</h3>
        <Autorizado accion="editar" recurso="mantenimiento">
          <form
            className="mb-2 flex flex-wrap items-end gap-2"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (!obraId) return;
              asignar.lanzar(puedeFicha, undefined);
            }}
          >
            <select
              className={selectCls}
              value={obraId}
              onChange={(ev) => setObraId(ev.target.value)}
              aria-label="Obra"
            >
              <option value="">Obra…</option>
              {(obras.data ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.code} · {o.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              className={inputCls}
              value={desde}
              onChange={(ev) => setDesde(ev.target.value)}
              aria-label="Desde"
            />
            <button
              type="submit"
              className={btnPrimaryCls}
              disabled={asignar.pendiente}
            >
              Asignar
            </button>
          </form>
        </Autorizado>
        <ul className="text-xs">
          {(asignaciones.data ?? []).map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between border-b border-gray-100 py-1"
            >
              <span>
                {a.projectNombre} · {formatDate(a.desde)} –{' '}
                {a.hasta ? formatDate(a.hasta) : 'sin fin'}
              </span>
              {!a.hasta && (
                <Autorizado accion="editar" recurso="mantenimiento">
                  <button
                    type="button"
                    className={btnGhostCls}
                    disabled={cerrarAsig.pendiente}
                    onClick={() =>
                      cerrarAsig.lanzar(puedeFicha, {
                        id: a.id,
                        version: a.version,
                      })
                    }
                  >
                    Cerrar hoy
                  </button>
                </Autorizado>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border bg-white p-3 shadow-sm">
        <h3 className="mb-2 font-semibold">Planes preventivos</h3>
        <ul className="mb-2 text-xs">
          {(planes.data ?? []).map((p) => (
            <li key={p.id} className="border-b border-gray-100 py-1">
              <span
                className={`mr-2 rounded px-1.5 ${PREVENTIVO_CLS[p.estado]}`}
              >
                {p.estado.replace('_', ' ')}
              </span>
              {p.nombre} ·{' '}
              {[
                p.periodicidadDias &&
                  `cada ${p.periodicidadDias} días (próx. ${p.fechaProxima ? formatDate(p.fechaProxima) : '—'})`,
                p.intervaloHoras &&
                  `cada ${p.intervaloHoras} h (próx. ${p.horasProximas} h)`,
                p.intervaloKm &&
                  `cada ${p.intervaloKm} km (próx. ${p.kmProximos} km)`,
              ]
                .filter(Boolean)
                .join(' · ')}
              {!p.activo && ' · inactivo'}
            </li>
          ))}
        </ul>
        <Autorizado accion="crear" recurso="mantenimiento">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (
                plan.nombre.trim().length < 3 ||
                (!plan.dias && !plan.horas && !plan.km)
              )
                return;
              crearPlan.lanzar(can('crear', 'mantenimiento'), undefined);
            }}
          >
            <input
              className={`${inputCls} flex-1`}
              placeholder="Nombre del plan"
              value={plan.nombre}
              onChange={(ev) => setPlan({ ...plan, nombre: ev.target.value })}
              aria-label="Nombre del plan"
            />
            <input
              className={`${inputCls} w-20`}
              placeholder="Días"
              inputMode="numeric"
              value={plan.dias}
              onChange={(ev) => setPlan({ ...plan, dias: ev.target.value })}
              aria-label="Cada días"
            />
            <input
              className={`${inputCls} w-20`}
              placeholder="Horas"
              inputMode="decimal"
              value={plan.horas}
              onChange={(ev) => setPlan({ ...plan, horas: ev.target.value })}
              aria-label="Cada horas"
            />
            <input
              className={`${inputCls} w-20`}
              placeholder="Km"
              inputMode="decimal"
              value={plan.km}
              onChange={(ev) => setPlan({ ...plan, km: ev.target.value })}
              aria-label="Cada km"
            />
            <button
              type="submit"
              className={btnPrimaryCls}
              disabled={crearPlan.pendiente}
            >
              Crear plan
            </button>
          </form>
        </Autorizado>
      </section>

      <section className="rounded-xl border bg-white p-3 shadow-sm">
        <h3 className="mb-2 font-semibold">Órdenes de trabajo</h3>
        <Autorizado accion="crear" recurso="aviso_averia">
          <form
            className="mb-2 flex flex-wrap items-end gap-2"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (aviso.descripcion.trim().length < 3) return;
              crearOrden.lanzar(puedeAviso, undefined);
            }}
          >
            <select
              className={selectCls}
              value={aviso.tipo}
              onChange={(ev) =>
                setAviso({
                  ...aviso,
                  tipo: ev.target.value as TipoOrdenTrabajo,
                })
              }
              aria-label="Tipo de orden"
            >
              {(
                Object.keys(TIPO_ORDEN_TRABAJO_LABELS) as TipoOrdenTrabajo[]
              ).map((t) => (
                <option key={t} value={t}>
                  {TIPO_ORDEN_TRABAJO_LABELS[t]}
                </option>
              ))}
            </select>
            <select
              className={selectCls}
              value={aviso.projectId}
              onChange={(ev) =>
                setAviso({ ...aviso, projectId: ev.target.value })
              }
              aria-label="Obra de la orden"
            >
              <option value="">
                {e.obraActual
                  ? `Obra actual (${e.obraActual.nombre})`
                  : 'Sin obra'}
              </option>
              {(obras.data ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.code} · {o.name}
                </option>
              ))}
            </select>
            <input
              className={`${inputCls} flex-1`}
              placeholder="Avería o trabajo"
              value={aviso.descripcion}
              onChange={(ev) =>
                setAviso({ ...aviso, descripcion: ev.target.value })
              }
              aria-label="Descripción"
            />
            <button
              type="submit"
              className={btnPrimaryCls}
              disabled={crearOrden.pendiente}
            >
              Abrir orden
            </button>
          </form>
        </Autorizado>
        <div className="space-y-2">
          {(ordenes.data ?? []).map((o) => (
            <Orden key={o.id} o={o} />
          ))}
        </div>
      </section>
    </div>
  );
}

const SIGUIENTES: Record<string, AccionOrden[]> = {
  abierta: ['planificar', 'iniciar', 'cancelar'],
  planificada: ['iniciar', 'cancelar'],
  en_curso: ['cerrar', 'cancelar'],
};

function Orden({ o }: { o: OrdenTrabajoDto }) {
  const { can } = usePermisos();
  const [accion, setAccion] = useState<AccionOrden | ''>('');
  const [f, setF] = useState({
    fecha: hoy(),
    planificada: '',
    parada: '',
    horas: '',
    tarifa: '',
    repuestos: '',
    externo: '',
    lectura: '',
    motivo: '',
    notas: '',
  });
  const ejecutar = useAccion(
    (clave) =>
      eamApi.accionOrden(
        o.id,
        {
          accion: accion as AccionOrden,
          fecha: f.fecha,
          ...(accion === 'planificar' && { fechaPlanificada: f.planificada }),
          ...(accion === 'cancelar' && { motivo: f.motivo }),
          ...(accion === 'cerrar' && {
            horasParada: f.parada ? num(f.parada) : 0,
            horasManoObra: f.horas ? num(f.horas) : 0,
            tarifaManoObra: f.tarifa ? num(f.tarifa) : 0,
            costeRepuestos: f.repuestos ? num(f.repuestos) : 0,
            costeExterno: f.externo ? num(f.externo) : 0,
            lecturaHoras: f.lectura ? num(f.lectura) : null,
            notas: f.notas || null,
          }),
        },
        o.version,
        clave,
      ),
    'Orden actualizada',
  );
  const set = (k: keyof typeof f) => (ev: { target: { value: string } }) =>
    setF({ ...f, [k]: ev.target.value });
  return (
    <div className="rounded border border-gray-100 p-2 text-xs">
      <p>
        <span className="font-semibold">{o.numero}</span> ·{' '}
        {TIPO_ORDEN_TRABAJO_LABELS[o.tipo]} · {o.prioridad} ·{' '}
        {ESTADO_ORDEN_TRABAJO_LABELS[o.estado]} · aviso{' '}
        {formatDate(o.fechaAviso)}
        {o.projectNombre ? ` · ${o.projectNombre}` : ''}
      </p>
      <p className="text-gray-600">
        {o.descripcion}
        {o.estado === 'cerrada' &&
          ` · parada ${o.horasParada} h · mano de obra ${formatEur(o.costeManoObra)} · repuestos ${formatEur(o.costeRepuestos)} · externo ${formatEur(o.costeExterno)} · total ${formatEur(o.costeTotal)}`}
        {o.motivoCancelacion && ` · cancelada: ${o.motivoCancelacion}`}
      </p>
      {SIGUIENTES[o.estado] && (
        <Autorizado accion="cambiarEstado" recurso="mantenimiento">
          <form
            className="mt-1 flex flex-wrap items-end gap-1"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (!accion) return;
              ejecutar.lanzar(can('cambiarEstado', 'mantenimiento'), undefined);
            }}
          >
            <select
              className={selectCls}
              value={accion}
              onChange={(ev) => setAccion(ev.target.value as AccionOrden)}
              aria-label="Acción"
            >
              <option value="">Acción…</option>
              {SIGUIENTES[o.estado].map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <input
              type="date"
              className={inputCls}
              value={f.fecha}
              max={hoy()}
              onChange={set('fecha')}
              aria-label="Fecha"
            />
            {accion === 'planificar' && (
              <input
                type="date"
                className={inputCls}
                value={f.planificada}
                onChange={set('planificada')}
                aria-label="Fecha planificada"
              />
            )}
            {accion === 'cancelar' && (
              <input
                className={inputCls}
                placeholder="Motivo"
                value={f.motivo}
                onChange={set('motivo')}
                aria-label="Motivo"
              />
            )}
            {accion === 'cerrar' && (
              <>
                <input
                  className={`${inputCls} w-20`}
                  placeholder="Parada h"
                  value={f.parada}
                  onChange={set('parada')}
                  aria-label="Horas de parada"
                />
                <input
                  className={`${inputCls} w-20`}
                  placeholder="M.O. h"
                  value={f.horas}
                  onChange={set('horas')}
                  aria-label="Horas de mano de obra"
                />
                <input
                  className={`${inputCls} w-20`}
                  placeholder="€/h"
                  value={f.tarifa}
                  onChange={set('tarifa')}
                  aria-label="Tarifa de mano de obra"
                />
                <input
                  className={`${inputCls} w-24`}
                  placeholder="Repuestos €"
                  value={f.repuestos}
                  onChange={set('repuestos')}
                  aria-label="Repuestos"
                />
                <input
                  className={`${inputCls} w-24`}
                  placeholder="Externo €"
                  value={f.externo}
                  onChange={set('externo')}
                  aria-label="Coste externo"
                />
                <input
                  className={`${inputCls} w-24`}
                  placeholder="Horómetro"
                  value={f.lectura}
                  onChange={set('lectura')}
                  aria-label="Lectura de horas"
                />
                <input
                  className={`${inputCls} flex-1`}
                  placeholder="Notas"
                  value={f.notas}
                  onChange={set('notas')}
                  aria-label="Notas de cierre"
                />
              </>
            )}
            <button
              type="submit"
              className={btnPrimaryCls}
              disabled={ejecutar.pendiente || !accion}
            >
              Aplicar
            </button>
          </form>
        </Autorizado>
      )}
    </div>
  );
}

function Explotacion() {
  const inicioMes = `${hoy().slice(0, 8)}01`;
  const [desde, setDesde] = useState(inicioMes);
  const [hasta, setHasta] = useState(hoy);
  const [projectId, setProjectId] = useState('');
  const obras = useQuery({
    queryKey: ['projects', 'maquinaria'],
    queryFn: () => projectsApi.list('', ''),
  });
  const filtros = { desde, hasta, projectId: projectId || undefined };
  const d = useQuery({
    queryKey: ['eam', 'explotacion', filtros],
    queryFn: () => eamApi.explotacion(filtros),
    enabled: desde <= hasta,
  });
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">
        Disponibilidad y coste de explotación
      </h2>
      <div className="mb-2 flex flex-wrap items-end gap-2">
        <input
          type="date"
          className={inputCls}
          value={desde}
          onChange={(ev) => setDesde(ev.target.value)}
          aria-label="Desde"
        />
        <input
          type="date"
          className={inputCls}
          value={hasta}
          onChange={(ev) => setHasta(ev.target.value)}
          aria-label="Hasta"
        />
        <select
          className={selectCls}
          value={projectId}
          onChange={(ev) => setProjectId(ev.target.value)}
          aria-label="Obra"
        >
          <option value="">Toda la flota</option>
          {(obras.data ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.code} · {o.name}
            </option>
          ))}
        </select>
      </div>
      {d.isError && <ErrorBanner message={(d.error as Error).message} />}
      {d.data && (
        <>
          <div className="mb-3 overflow-x-auto rounded-xl border bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2">Equipo</th>
                  <th className="px-3 py-2 text-right">Horas</th>
                  <th className="px-3 py-2 text-right">Disponib.</th>
                  <th className="px-3 py-2 text-right">Utiliz.</th>
                  <th className="px-3 py-2 text-right">MTBF / MTTR</th>
                  <th className="px-3 py-2 text-right">Amortización</th>
                  <th className="px-3 py-2 text-right">Mantenimiento</th>
                  <th className="px-3 py-2 text-right">Imputado a obras</th>
                  <th className="px-3 py-2 text-right">Cobertura</th>
                  <th className="px-3 py-2 text-right">€/h</th>
                </tr>
              </thead>
              <tbody>
                {d.data.equipos.map((e) => (
                  <tr key={e.equipoId} className="border-t border-gray-100">
                    <td className="px-3 py-1.5">
                      {e.codigo ? `${e.codigo} · ` : ''}
                      {e.nombre}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {e.horasTrabajadas}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {e.disponibilidadPct ?? '—'} %
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {e.utilizacionPct ?? '—'} %
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {e.mtbfHoras ?? '—'} / {e.mttrHoras ?? '—'} h
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatEur(e.coste.amortizacion)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatEur(e.coste.mantenimiento)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatEur(e.coste.imputadoObras)}
                    </td>
                    <td
                      className={`px-3 py-1.5 text-right tabular-nums ${e.coste.diferencia < 0 ? 'text-red-700' : ''}`}
                    >
                      {e.coste.coberturaPct ?? '—'} %
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {e.coste.costeHora === null
                        ? '—'
                        : formatEur(e.coste.costeHora)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2">Obra</th>
                  <th className="px-3 py-2 text-right">Equipos</th>
                  <th className="px-3 py-2 text-right">Horas</th>
                  <th className="px-3 py-2 text-right">Imputado (partes)</th>
                  <th className="px-3 py-2 text-right">
                    Mantenimiento atribuido
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.data.obras.map((o) => (
                  <tr key={o.projectId} className="border-t border-gray-100">
                    <td className="px-3 py-1.5">{o.nombre}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {o.equipos}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {o.horasTrabajadas}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatEur(o.imputado)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatEur(o.mantenimientoAtribuido)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            La amortización es la ya contabilizada del activo fijo del equipo
            (por obra, repartida por días asignados). El mantenimiento es del
            equipo: a la obra solo llega lo imputado por los partes, que ya está
            en su coste real.
          </p>
        </>
      )}
    </section>
  );
}
