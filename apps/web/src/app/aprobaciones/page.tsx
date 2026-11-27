'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  ESTADOS_SOLICITUD_APROBACION,
  ESTADO_SOLICITUD_LABELS,
  OPERACIONES_APROBACION,
  OPERACION_APROBACION_LABELS,
  PUERTA_APROBACION_LABELS,
  ROLES_APROBADOR,
  ROL_APROBADOR_LABELS,
  CONFLICTO_SOD_LABELS,
  MODOS_SOD,
  type ConflictoSod,
  type EstadoPasoAprobacion,
  type ModoSod,
  type PoliticaSodDto,
  type EstadoSolicitudAprobacion,
  type OperacionAprobacion,
  type ReglaAprobacionDto,
  type RolAprobador,
  type SolicitudAprobacionDto,
} from '@erp/shared';
import {
  aprobacionesApi,
  formatDate,
  formatEur,
  grcApi,
  usersApi,
} from '@/lib/api';
import { nuevoUuid } from '@/lib/api-error';
import { crearGuardaEnvio } from '@/lib/envio-unico';
import { useAuth } from '@/lib/auth';
import { usePermisos } from '@/lib/permisos';
import { IconCheck } from '@/components/icons';
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

type Vista = 'paraMi' | 'todas' | 'reglas' | 'delegaciones' | 'gobierno';

const COLOR_PASO: Record<EstadoPasoAprobacion, string> = {
  en_espera: 'bg-gray-100 text-gray-500',
  activo: 'bg-amber-100 text-amber-800',
  aprobado: 'bg-emerald-100 text-emerald-700',
  rechazado: 'bg-red-100 text-red-700',
  cancelado: 'bg-gray-100 text-gray-400 line-through',
};

const COLOR_ESTADO: Record<EstadoSolicitudAprobacion, string> = {
  pendiente: 'bg-amber-100 text-amber-800',
  aprobada: 'bg-emerald-100 text-emerald-700',
  rechazada: 'bg-red-100 text-red-700',
  invalidada: 'bg-gray-100 text-gray-600',
  anulada: 'bg-gray-100 text-gray-500',
};

export default function AprobacionesPage() {
  const [vista, setVista] = useState<Vista>('paraMi');
  const { user } = useAuth();
  const { can } = usePermisos();
  // Reglas: la API solo deja a admin y gerente (cosmético aquí).
  const gestionaReglas =
    can('editar', 'contabilidad') &&
    (user?.role === 'admin' || user?.role === 'gerente');

  return (
    <div>
      <PageHeader
        title="Aprobaciones"
        subtitle="Flujos de aprobación por umbral de pedidos, facturas de compra y certificaciones de subcontrata. Quien solicita no decide."
      />
      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {(
          [
            ['paraMi', 'Pendientes para mí'],
            ['todas', 'Todas las solicitudes'],
            ['reglas', 'Reglas de umbral'],
            ['delegaciones', 'Delegaciones'],
            ['gobierno', 'Segregación de funciones'],
          ] as const
        ).map(([v, t]) => (
          <button
            key={v}
            type="button"
            onClick={() => setVista(v)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              vista === v
                ? 'border-amber-500 text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {vista === 'reglas' ? (
        <Reglas editable={gestionaReglas} />
      ) : vista === 'delegaciones' ? (
        <Delegaciones />
      ) : vista === 'gobierno' ? (
        <Gobierno editable={gestionaReglas} />
      ) : (
        <Solicitudes paraMi={vista === 'paraMi'} />
      )}
    </div>
  );
}

function Solicitudes({ paraMi }: { paraMi: boolean }) {
  const [estado, setEstado] = useState('');
  const [operacion, setOperacion] = useState('');
  const { can } = usePermisos();
  const [decidiendo, setDecidiendo] = useState<{
    s: SolicitudAprobacionDto;
    accion: 'aprobar' | 'rechazar';
  } | null>(null);
  const lista = useQuery({
    queryKey: ['aprobaciones', 'solicitudes', paraMi, estado, operacion],
    queryFn: () =>
      aprobacionesApi.solicitudes({
        paraMi,
        estado: paraMi ? undefined : estado || undefined,
        operacion: operacion || undefined,
      }),
  });
  const filas = lista.data ?? [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-3">
        <select
          className={selectCls}
          value={operacion}
          onChange={(e) => setOperacion(e.target.value)}
          aria-label="Operación"
        >
          <option value="">Todas las operaciones</option>
          {OPERACIONES_APROBACION.map((o) => (
            <option key={o} value={o}>
              {OPERACION_APROBACION_LABELS[o]}
            </option>
          ))}
        </select>
        {!paraMi && (
          <select
            className={selectCls}
            value={estado}
            onChange={(e) => setEstado(e.target.value)}
            aria-label="Estado"
          >
            <option value="">Todos los estados</option>
            {ESTADOS_SOLICITUD_APROBACION.map((s) => (
              <option key={s} value={s}>
                {ESTADO_SOLICITUD_LABELS[s]}
              </option>
            ))}
          </select>
        )}
      </div>
      {lista.isError && (
        <ErrorBanner message={(lista.error as Error).message} />
      )}
      {lista.isLoading && <TableSkeleton />}
      {lista.isSuccess && filas.length === 0 && (
        <EmptyState icon={<IconCheck />} title="Nada pendiente">
          {paraMi
            ? 'No tienes aprobaciones pendientes de decidir.'
            : 'No hay solicitudes con estos filtros.'}
        </EmptyState>
      )}
      {filas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">Solicitada</th>
                <th className="px-3 py-2">Documento</th>
                <th className="px-3 py-2 text-right">Importe</th>
                <th className="px-3 py-2">Nivel</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filas.map((s) => (
                <tr key={s.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 tabular-nums">
                    {formatDate(s.solicitadaEn.slice(0, 10))}
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-xs text-gray-500">
                      {OPERACION_APROBACION_LABELS[s.operacion]}
                    </span>
                    <span className="block font-medium">{s.referencia}</span>
                    {s.comentario && (
                      <span className="block text-xs text-gray-500">
                        {s.comentario}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(s.importe)}
                  </td>
                  <td className="px-3 py-2">
                    {(s.totalNiveles ?? 1) > 1
                      ? `Nivel ${s.nivelActual}/${s.totalNiveles}`
                      : ROL_APROBADOR_LABELS[s.rolRequerido]}
                    {(s.pasos ?? []).length > 1 && (
                      <span className="mt-0.5 flex gap-1">
                        {(s.pasos ?? []).map((p) => (
                          <span
                            key={p.id}
                            title={`${ROL_APROBADOR_LABELS[p.rolRequerido]}${p.aprobadorNombre ? ` · ${p.aprobadorNombre}` : ''}${p.decididoPorNombre ? ` · decidió ${p.decididoPorNombre}` : ''}${p.enNombreDe ? ' (por delegación)' : ''}${p.escalado ? ' · escalado' : ''}`}
                            className={`rounded px-1 text-[10px] ${COLOR_PASO[p.estado]}`}
                          >
                            N{p.nivel}
                          </span>
                        ))}
                      </span>
                    )}
                    {s.avisoSod && (
                      <span className="block text-[11px] text-amber-700">
                        {s.avisoSod}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${COLOR_ESTADO[s.estado]}`}
                    >
                      {ESTADO_SOLICITUD_LABELS[s.estado]}
                    </span>
                    {s.motivoDecision && (
                      <span className="block text-xs text-gray-500">
                        {s.motivoDecision}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {s.puedoDecidir && can('cambiarEstado') && (
                      <>
                        <button
                          type="button"
                          className="mr-2 rounded-md px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                          onClick={() =>
                            setDecidiendo({ s, accion: 'aprobar' })
                          }
                        >
                          Aprobar
                        </button>
                        <button
                          type="button"
                          className="rounded-md px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                          onClick={() =>
                            setDecidiendo({ s, accion: 'rechazar' })
                          }
                        >
                          Rechazar
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <DecisionModal
        decision={decidiendo}
        onClose={() => setDecidiendo(null)}
      />
    </div>
  );
}

function DecisionModal({
  decision,
  onClose,
}: {
  decision: {
    s: SolicitudAprobacionDto;
    accion: 'aprobar' | 'rechazar';
  } | null;
  onClose: () => void;
}) {
  const [texto, setTexto] = useState('');
  const [justificacion, setJustificacion] = useState('');
  const clave = useRef(nuevoUuid());
  const qc = useQueryClient();
  const toast = useToast();
  const avisarError = useAvisarError();
  const refrescar = () =>
    void qc.invalidateQueries({ queryKey: ['aprobaciones'] });
  const m = useMutation({
    mutationFn: () => {
      const d = decision!;
      return aprobacionesApi.decidir(
        d.s.id,
        d.accion,
        d.accion === 'aprobar'
          ? {
              comentario: texto.trim() || null,
              justificacionSod: justificacion.trim() || null,
            }
          : { motivo: texto.trim() },
        d.s.version,
        clave.current,
      );
    },
    onSuccess: (r) => {
      clave.current = nuevoUuid();
      toast(
        `${r.referencia}: ${
          r.estado === 'aprobada'
            ? 'aprobada'
            : r.estado === 'pendiente'
              ? `nivel aprobado, pasa al nivel ${r.nivelActual}`
              : 'rechazada'
        }`,
      );
      setTexto('');
      setJustificacion('');
      refrescar();
      onClose();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const d = decision;
  const rechazo = d?.accion === 'rechazar';
  return (
    <Modal
      open={d !== null}
      title={d ? `${rechazo ? 'Rechazar' : 'Aprobar'} · ${d.s.referencia}` : ''}
      onClose={onClose}
    >
      {d && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!m.isPending) m.mutate();
          }}
        >
          <p className="text-sm text-gray-600">
            {OPERACION_APROBACION_LABELS[d.s.operacion]} por{' '}
            {formatEur(d.s.importe)}. Al aprobar se podrá{' '}
            {PUERTA_APROBACION_LABELS[d.s.operacion]}.
          </p>
          <div>
            <label className={labelCls} htmlFor="dec-texto">
              {rechazo ? 'Motivo del rechazo' : 'Comentario (opcional)'}
            </label>
            <textarea
              id="dec-texto"
              className={fieldCls}
              rows={3}
              maxLength={500}
              minLength={rechazo ? 3 : undefined}
              required={rechazo}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
            />
          </div>
          {!rechazo && d.s.avisoSod && (
            <div>
              <p className="mb-1 text-xs text-amber-700">{d.s.avisoSod}</p>
              <label className={labelCls} htmlFor="dec-sod">
                Justificación de la excepción (segregación de funciones)
              </label>
              <textarea
                id="dec-sod"
                className={fieldCls}
                rows={2}
                maxLength={500}
                value={justificacion}
                onChange={(e) => setJustificacion(e.target.value)}
              />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className={btnGhostCls} onClick={onClose}>
              Cancelar
            </button>
            <button
              type="submit"
              className={btnPrimaryCls}
              disabled={m.isPending}
            >
              {m.isPending ? 'Guardando…' : rechazo ? 'Rechazar' : 'Aprobar'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function Reglas({ editable }: { editable: boolean }) {
  const [nueva, setNueva] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const avisarError = useAvisarError();
  const reglas = useQuery({
    queryKey: ['aprobaciones', 'reglas'],
    queryFn: () => aprobacionesApi.reglas(),
  });
  const refrescar = () =>
    void qc.invalidateQueries({ queryKey: ['aprobaciones'] });
  const activar = useMutation({
    mutationFn: (r: ReglaAprobacionDto) =>
      aprobacionesApi.actualizarRegla(r.id, { activa: !r.activa }, r.version),
    onSuccess: (r) => {
      toast(`Regla «${r.nombre}» ${r.activa ? 'activada' : 'desactivada'}`);
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const filas = reglas.data ?? [];

  return (
    <div>
      {editable && (
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            className={btnPrimaryCls}
            onClick={() => setNueva(true)}
          >
            Nueva regla
          </button>
        </div>
      )}
      {reglas.isError && (
        <ErrorBanner message={(reglas.error as Error).message} />
      )}
      {reglas.isLoading && <TableSkeleton />}
      {reglas.isSuccess && filas.length === 0 && (
        <EmptyState icon={<IconCheck />} title="Sin reglas">
          Sin reglas, ningún documento requiere aprobación previa.
        </EmptyState>
      )}
      {filas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">Regla</th>
                <th className="px-3 py-2">Operación</th>
                <th className="px-3 py-2 text-right">Desde</th>
                <th className="px-3 py-2">Aprueba</th>
                <th className="px-3 py-2">Alcance</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filas.map((r) => (
                <tr
                  key={r.id}
                  className={`border-t border-gray-100 ${r.activa ? '' : 'text-gray-400'}`}
                >
                  <td className="px-3 py-2 font-medium">
                    {r.nombre}
                    {(r.niveles ?? []).length > 0 && (
                      <span className="block text-xs font-normal text-gray-500">
                        {(r.niveles ?? [])
                          .map(
                            (n) =>
                              `N${n.nivel} ≥ ${formatEur(n.importeMinimo)}: ${n.aprobadorNombre ?? ROL_APROBADOR_LABELS[n.rolRequerido]}${n.plazoHoras ? ` (${n.plazoHoras} h)` : ''}`,
                          )
                          .join(' → ')}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {OPERACION_APROBACION_LABELS[r.operacion]}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(r.importeMinimo)}
                  </td>
                  <td className="px-3 py-2">
                    {ROL_APROBADOR_LABELS[r.rolRequerido]}
                  </td>
                  <td className="px-3 py-2">
                    {r.projectCodigo ?? 'Todas las obras'}
                  </td>
                  <td className="px-3 py-2">
                    {r.activa ? 'Activa' : 'Inactiva'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {editable && (
                      <button
                        type="button"
                        className="text-xs text-gray-600 hover:underline"
                        disabled={activar.isPending}
                        onClick={() => activar.mutate(r)}
                      >
                        {r.activa ? 'Desactivar' : 'Activar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <NuevaReglaModal open={nueva} onClose={() => setNueva(false)} />
    </div>
  );
}

function NuevaReglaModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [f, setF] = useState({
    nombre: '',
    operacion: 'pedido_compra' as OperacionAprobacion,
    importeMinimo: '',
    rolRequerido: 'gerente' as RolAprobador,
  });
  // Cadena multinivel opcional: cada nivel desde un importe, con su rol y plazo.
  const [niveles, setNiveles] = useState<
    { importe: string; rol: RolAprobador; plazo: string }[]
  >([]);
  const clave = useRef(nuevoUuid());
  const qc = useQueryClient();
  const toast = useToast();
  const avisarError = useAvisarError();
  const m = useMutation({
    mutationFn: () =>
      aprobacionesApi.crearRegla(
        {
          nombre: f.nombre.trim(),
          operacion: f.operacion,
          importeMinimo: Number(f.importeMinimo.replace(',', '.')),
          rolRequerido: f.rolRequerido,
          ...(niveles.length > 0 && {
            niveles: niveles.map((n) => ({
              importeMinimo: Number(n.importe.replace(',', '.') || 0),
              rolRequerido: n.rol,
              plazoHoras: n.plazo ? Number(n.plazo) : null,
            })),
          }),
        },
        clave.current,
      ),
    onSuccess: (r) => {
      clave.current = nuevoUuid();
      toast(`Regla «${r.nombre}» creada`);
      void qc.invalidateQueries({ queryKey: ['aprobaciones'] });
      onClose();
    },
    onError: (e) => avisarError(e),
  });
  return (
    <Modal open={open} title="Nueva regla de umbral" onClose={onClose}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!m.isPending) m.mutate();
        }}
      >
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="rg-nombre">
            Nombre
          </label>
          <input
            id="rg-nombre"
            className={fieldCls}
            value={f.nombre}
            maxLength={120}
            required
            onChange={(e) => setF({ ...f, nombre: e.target.value })}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="rg-op">
            Operación
          </label>
          <select
            id="rg-op"
            className={fieldCls}
            value={f.operacion}
            onChange={(e) =>
              setF({ ...f, operacion: e.target.value as OperacionAprobacion })
            }
          >
            {OPERACIONES_APROBACION.map((o) => (
              <option key={o} value={o}>
                {OPERACION_APROBACION_LABELS[o]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="rg-importe">
            Desde (€, inclusive)
          </label>
          <input
            id="rg-importe"
            className={fieldCls}
            inputMode="decimal"
            value={f.importeMinimo}
            required
            onChange={(e) => setF({ ...f, importeMinimo: e.target.value })}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="rg-rol">
            Aprueba (o un nivel superior)
          </label>
          <select
            id="rg-rol"
            className={fieldCls}
            value={f.rolRequerido}
            onChange={(e) =>
              setF({ ...f, rolRequerido: e.target.value as RolAprobador })
            }
          >
            {ROLES_APROBADOR.map((r) => (
              <option key={r} value={r}>
                {ROL_APROBADOR_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <p className={labelCls}>
            Cadena de niveles (opcional: sin niveles, aprueba un solo nivel)
          </p>
          {niveles.map((n, i) => (
            <div
              key={i}
              className="mb-1 flex flex-wrap items-center gap-1 text-xs"
            >
              <span className="w-14">Nivel {i + 1}</span>
              <input
                className={`${fieldCls} w-28`}
                inputMode="decimal"
                placeholder="Desde €"
                value={n.importe}
                aria-label={`Importe del nivel ${i + 1}`}
                onChange={(e) =>
                  setNiveles(
                    niveles.map((x, j) =>
                      j === i ? { ...x, importe: e.target.value } : x,
                    ),
                  )
                }
              />
              <select
                className={`${fieldCls} w-36`}
                value={n.rol}
                aria-label={`Rol del nivel ${i + 1}`}
                onChange={(e) =>
                  setNiveles(
                    niveles.map((x, j) =>
                      j === i
                        ? { ...x, rol: e.target.value as RolAprobador }
                        : x,
                    ),
                  )
                }
              >
                {ROLES_APROBADOR.map((r) => (
                  <option key={r} value={r}>
                    {ROL_APROBADOR_LABELS[r]}
                  </option>
                ))}
              </select>
              <input
                className={`${fieldCls} w-24`}
                inputMode="numeric"
                placeholder="Plazo h"
                value={n.plazo}
                aria-label={`Plazo del nivel ${i + 1}`}
                onChange={(e) =>
                  setNiveles(
                    niveles.map((x, j) =>
                      j === i ? { ...x, plazo: e.target.value } : x,
                    ),
                  )
                }
              />
              <button
                type="button"
                className={btnGhostCls}
                onClick={() => setNiveles(niveles.filter((_, j) => j !== i))}
              >
                Quitar
              </button>
            </div>
          ))}
          {niveles.length < 9 && (
            <button
              type="button"
              className={btnGhostCls}
              onClick={() =>
                setNiveles([
                  ...niveles,
                  {
                    importe: '',
                    rol: niveles[niveles.length - 1]?.rol ?? 'administracion',
                    plazo: '',
                  },
                ])
              }
            >
              Añadir nivel
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500 sm:col-span-2">
          Sin aprobación no se podrá {PUERTA_APROBACION_LABELS[f.operacion]}.
        </p>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" className={btnGhostCls} onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            className={btnPrimaryCls}
            disabled={m.isPending}
          >
            {m.isPending ? 'Guardando…' : 'Crear regla'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Mis delegaciones de aprobación (suplencias) y alta de una nueva. */
function Delegaciones() {
  const hoy = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({
    delegadoId: '',
    desde: hoy,
    hasta: hoy,
    motivo: '',
  });
  const [guarda] = useState(crearGuardaEnvio);
  const clave = useRef(nuevoUuid());
  const { user } = useAuth();
  const { can } = usePermisos();
  const qc = useQueryClient();
  const toast = useToast();
  const avisarError = useAvisarError();
  const refrescar = () => void qc.invalidateQueries({ queryKey: ['grc'] });
  const lista = useQuery({
    queryKey: ['grc', 'delegaciones'],
    queryFn: () => grcApi.delegaciones(),
  });
  const usuarios = useQuery({
    queryKey: ['users', 'delegables'],
    queryFn: () => usersApi.list(),
    retry: false,
  });
  const crear = useMutation({
    mutationFn: () => grcApi.crearDelegacion(f, clave.current),
    onSuccess: () => {
      clave.current = nuevoUuid();
      setF({ ...f, delegadoId: '', motivo: '' });
      toast(
        'Delegación creada: el delegado decide en tu nombre en esas fechas',
      );
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
    onSettled: () => guarda.liberar(),
  });
  const revocar = useMutation({
    mutationFn: (d: { id: string; version: number }) =>
      grcApi.revocarDelegacion(d.id, d.version),
    onSuccess: () => {
      toast('Delegación revocada');
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const aprueba =
    user?.role === 'admin' ||
    user?.role === 'gerente' ||
    user?.role === 'administracion';
  const candidatos = (usuarios.data ?? []).filter(
    (x) =>
      x.id !== user?.id &&
      ['admin', 'gerente', 'administracion'].includes(x.role),
  );
  const valido =
    f.delegadoId !== '' && f.hasta >= f.desde && f.motivo.trim().length >= 3;
  return (
    <div>
      {aprueba && can('crear') && (
        <form
          className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border bg-white p-3 shadow-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valido || crear.isPending || !guarda.intentar()) return;
            crear.mutate();
          }}
        >
          {candidatos.length > 0 ? (
            <select
              className={selectCls}
              value={f.delegadoId}
              onChange={(e) => setF({ ...f, delegadoId: e.target.value })}
              aria-label="Delegado"
            >
              <option value="">Delegar en…</option>
              {candidatos.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.fullName} ({x.role})
                </option>
              ))}
            </select>
          ) : (
            <input
              className={fieldCls}
              placeholder="Id del delegado"
              value={f.delegadoId}
              onChange={(e) => setF({ ...f, delegadoId: e.target.value })}
              aria-label="Delegado"
            />
          )}
          <input
            type="date"
            className={selectCls}
            value={f.desde}
            min={hoy}
            onChange={(e) => setF({ ...f, desde: e.target.value })}
            aria-label="Desde"
          />
          <input
            type="date"
            className={selectCls}
            value={f.hasta}
            min={f.desde}
            onChange={(e) => setF({ ...f, hasta: e.target.value })}
            aria-label="Hasta"
          />
          <input
            className={`${fieldCls} flex-1`}
            placeholder="Motivo (vacaciones, baja…)"
            value={f.motivo}
            onChange={(e) => setF({ ...f, motivo: e.target.value })}
            aria-label="Motivo"
          />
          <button
            type="submit"
            className={btnPrimaryCls}
            disabled={!valido || crear.isPending}
          >
            Delegar
          </button>
        </form>
      )}
      {lista.isError && (
        <ErrorBanner message={(lista.error as Error).message} />
      )}
      <ul className="space-y-1 text-sm">
        {(lista.data ?? []).map((d) => (
          <li
            key={d.id}
            className="flex items-center justify-between rounded border border-gray-100 bg-white px-3 py-2"
          >
            <span>
              {d.deleganteNombre} → {d.delegadoNombre} · {formatDate(d.desde)} –{' '}
              {formatDate(d.hasta)} · {d.motivo}
              {!d.activa && (
                <span className="ml-2 text-xs text-gray-400">revocada</span>
              )}
            </span>
            {d.activa && d.deleganteId === user?.id && can('anular') && (
              <button
                type="button"
                className={btnGhostCls}
                disabled={revocar.isPending}
                onClick={() =>
                  !revocar.isPending &&
                  revocar.mutate({ id: d.id, version: d.version })
                }
              >
                Revocar
              </button>
            )}
          </li>
        ))}
        {lista.data?.length === 0 && (
          <li className="text-gray-500">Sin delegaciones.</li>
        )}
      </ul>
    </div>
  );
}

/** Políticas de segregación de funciones e informe de eventos (bloqueos y excepciones). */
function Gobierno({ editable }: { editable: boolean }) {
  const [guarda] = useState(crearGuardaEnvio);
  const clave = useRef(nuevoUuid());
  const { can } = usePermisos();
  const qc = useQueryClient();
  const toast = useToast();
  const avisarError = useAvisarError();
  const refrescar = () => void qc.invalidateQueries({ queryKey: ['grc'] });
  const politicas = useQuery({
    queryKey: ['grc', 'politicas'],
    queryFn: () => grcApi.politicas(),
  });
  const eventos = useQuery({
    queryKey: ['grc', 'eventos'],
    queryFn: () => grcApi.eventos(),
    retry: false,
  });
  const cambiar = useMutation({
    mutationFn: (p: { politica: PoliticaSodDto; modo: ModoSod }) =>
      grcApi.actualizarPolitica(
        p.politica.conflicto,
        p.modo,
        p.politica.version,
        clave.current,
      ),
    onSuccess: () => {
      clave.current = nuevoUuid();
      toast('Política de segregación actualizada');
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
    onSettled: () => guarda.liberar(),
  });
  const escalar = useMutation({
    mutationFn: () => aprobacionesApi.escalar(nuevoUuid()),
    onSuccess: (r) => {
      toast(
        r.length
          ? `${r.length} solicitud(es) escaladas al nivel superior`
          : 'Nada vencido que escalar',
      );
      void qc.invalidateQueries({ queryKey: ['aprobaciones'] });
    },
    onError: (e) => avisarError(e),
  });
  const MODO_LABEL: Record<ModoSod, string> = {
    bloquear: 'Bloquear',
    justificar: 'Permitir con justificación',
    auditar: 'Permitir y auditar',
  };
  return (
    <div className="space-y-6">
      <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2">Conflicto</th>
              <th className="px-3 py-2">Política</th>
            </tr>
          </thead>
          <tbody>
            {(politicas.data ?? []).map((p) => (
              <tr key={p.conflicto} className="border-t border-gray-100">
                <td className="px-3 py-2">{p.descripcion}</td>
                <td className="px-3 py-2">
                  {editable && !p.fija && can('editar', 'gobierno') ? (
                    <select
                      className={selectCls}
                      value={p.modo}
                      disabled={cambiar.isPending}
                      aria-label={`Política: ${p.descripcion}`}
                      onChange={(e) => {
                        if (!guarda.intentar()) return;
                        cambiar.mutate({
                          politica: p,
                          modo: e.target.value as ModoSod,
                        });
                      }}
                    >
                      {MODOS_SOD.map((m) => (
                        <option key={m} value={m}>
                          {MODO_LABEL[m]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span>
                      {MODO_LABEL[p.modo]}
                      {p.fija && (
                        <span className="ml-2 text-xs text-gray-500">
                          (siempre)
                        </span>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {can('editar', 'gobierno') && (
        <button
          type="button"
          className={btnGhostCls}
          disabled={escalar.isPending}
          onClick={() => !escalar.isPending && escalar.mutate()}
        >
          Escalar aprobaciones con el plazo vencido
        </button>
      )}
      <div>
        <h3 className="mb-2 text-sm font-semibold">
          Eventos de segregación de funciones
        </h3>
        {eventos.isError && (
          <p className="text-xs text-gray-500">
            Sin acceso al informe de eventos.
          </p>
        )}
        <ul className="space-y-1 text-xs">
          {(eventos.data ?? []).map((e) => (
            <li
              key={e.id}
              className="rounded border border-gray-100 bg-white px-3 py-1.5"
            >
              <span
                className={
                  e.datos.resultado === 'bloqueado'
                    ? 'font-semibold text-red-700'
                    : 'text-amber-700'
                }
              >
                {e.datos.resultado === 'bloqueado' ? 'Bloqueado' : 'Permitido'}
              </span>{' '}
              · {formatDate(e.fecha.slice(0, 10))} · {e.usuario ?? '—'} ·{' '}
              {e.datos.operacion} {e.datos.referencia} ·{' '}
              {(e.datos.conflictos ?? e.datos.excepciones ?? [])
                .map((c) => CONFLICTO_SOD_LABELS[c.conflicto as ConflictoSod])
                .join('; ')}
              {(e.datos.excepciones ?? []).some((x) => x.justificacion) &&
                ` · «${(e.datos.excepciones ?? [])
                  .map((x) => x.justificacion)
                  .filter(Boolean)
                  .join(' / ')}»`}
            </li>
          ))}
          {eventos.data?.length === 0 && (
            <li className="text-gray-500">Sin eventos.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
