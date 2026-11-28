'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import {
  CRITERIOS_REPARTO,
  CRITERIO_REPARTO_LABELS,
  TIPOS_CENTRO_COSTE,
  TIPOS_CICLO_REPARTO,
  TIPO_CENTRO_COSTE_LABELS,
  TIPO_CICLO_LABELS,
  type CentroCosteDto,
  type CicloRepartoDto,
  type CriterioReparto,
  type EjecucionRepartoDto,
  type SimulacionRepartoDto,
  type TipoCentroCoste,
  type TipoCicloReparto,
} from '@erp/shared';
import {
  controlAnaliticoApi,
  formatDate,
  formatEur,
  projectsApi,
} from '@/lib/api';
import { nuevoUuid } from '@/lib/api-error';
import { usePermisos } from '@/lib/permisos';
import { IconAlertTriangle, IconCalculator } from '@/components/icons';
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
  inputCls,
  labelCls,
  selectCls,
} from '@/components/ui';

type Pestana = 'centros' | 'repartos' | 'coste' | 'forecast';

const ALERTA_LABELS: Record<string, string> = {
  perdida: 'Pérdida prevista',
  sobrecoste: 'Sobrecoste',
  sin_presupuesto: 'Sin presupuesto',
  plazo_vencido: 'Plazo vencido',
};

function anioActual() {
  const y = new Date().getFullYear();
  return { desde: `${y}-01-01`, hasta: `${y}-12-31` };
}

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

/** `"1.234,5"` → 1234.5, `"33.3333"` → 33.3333; vacío o inválido → null. */
function aNumero(texto: string): number | null {
  const limpio = texto.trim();
  const t = limpio.includes(',')
    ? limpio.replace(/\./g, '').replace(',', '.')
    : limpio;
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Suma de importes de la API en céntimos enteros (sin ruido de coma flotante). */
function sumar(...vs: number[]): number {
  return vs.reduce((s, v) => s + Math.round(v * 100), 0) / 100;
}

function useRefrescar() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ['control-analitico'] });
}

/** Mutación con guarda de envío único e Idempotency-Key estable entre reintentos. */
function useEnvio<T>(fn: (clave: string) => Promise<T>, ok: (r: T) => void) {
  const clave = useRef(nuevoUuid());
  const refrescar = useRefrescar();
  const avisarError = useAvisarError();
  const m = useMutation({
    mutationFn: () => fn(clave.current),
    onSuccess: (r) => {
      clave.current = nuevoUuid();
      refrescar();
      ok(r);
    },
    onError: (err) => avisarError(err, refrescar),
  });
  return { pendiente: m.isPending, enviar: () => !m.isPending && m.mutate() };
}

export default function ControlAnaliticoPage() {
  const [pestana, setPestana] = useState<Pestana>('centros');
  const [periodo, setPeriodo] = useState(anioActual);
  const { can } = usePermisos();
  const gestiona = can('editar', 'control_analitico');

  const pestanas: { id: Pestana; texto: string }[] = [
    { id: 'centros', texto: 'Centros de coste' },
    { id: 'repartos', texto: 'Ciclos de reparto' },
    { id: 'coste', texto: 'Coste completo por obra' },
    { id: 'forecast', texto: 'Rolling forecast' },
  ];

  return (
    <div>
      <PageHeader
        title="Control analítico"
        subtitle="Centros de coste, ciclos de distribución e imputación de indirectos a obras y rolling forecast por escenarios, con varianzas frente al presupuesto y a la última foto."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {pestanas.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPestana(p.id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              pestana === p.id
                ? 'bg-gray-900 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {p.texto}
          </button>
        ))}
        {(pestana === 'centros' || pestana === 'repartos') && (
          <span className="ml-auto flex items-center gap-2 text-xs text-gray-600">
            Periodo
            <input
              type="date"
              className={inputCls}
              value={periodo.desde}
              onChange={(e) =>
                setPeriodo({ ...periodo, desde: e.target.value })
              }
            />
            <input
              type="date"
              className={inputCls}
              value={periodo.hasta}
              onChange={(e) =>
                setPeriodo({ ...periodo, hasta: e.target.value })
              }
            />
          </span>
        )}
      </div>
      {pestana === 'centros' && (
        <Centros periodo={periodo} gestiona={gestiona} />
      )}
      {pestana === 'repartos' && (
        <Repartos periodo={periodo} gestiona={gestiona} />
      )}
      {pestana === 'coste' && <CosteObras />}
      {pestana === 'forecast' && <Forecast gestiona={gestiona} />}
    </div>
  );
}

function Tabla({
  cabecera,
  children,
}: {
  cabecera: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs text-gray-500">
          {cabecera}
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const th = 'px-3 py-2';
const thR = 'px-3 py-2 text-right';
const td = 'px-3 py-2';
const tdR = 'px-3 py-2 text-right tabular-nums';

function Kpi({
  titulo,
  alerta = false,
  children,
}: {
  titulo: string;
  alerta?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border bg-white px-4 py-3 shadow-sm ${alerta ? 'border-red-200' : ''}`}
    >
      <p className="text-xs text-gray-500">{titulo}</p>
      <div
        className={`mt-1 text-lg font-semibold tabular-nums ${alerta ? 'text-red-600' : 'text-gray-900'}`}
      >
        {children}
      </div>
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
        Cancelar
      </button>
      <button type="submit" className={btnPrimaryCls} disabled={pendiente}>
        {pendiente ? 'Guardando…' : texto}
      </button>
    </div>
  );
}

/* ─────────────────────────── centros de coste ─────────────────────────── */

function Centros({
  periodo,
  gestiona,
}: {
  periodo: { desde: string; hasta: string };
  gestiona: boolean;
}) {
  const [nuevo, setNuevo] = useState(false);
  const { can } = usePermisos();
  const refrescar = useRefrescar();
  const avisarError = useAvisarError();
  const toast = useToast();
  const centros = useQuery({
    queryKey: ['control-analitico', 'centros'],
    queryFn: controlAnaliticoApi.centros,
  });
  const saldos = useQuery({
    queryKey: ['control-analitico', 'saldos', periodo.desde, periodo.hasta],
    queryFn: () => controlAnaliticoApi.saldos(periodo.desde, periodo.hasta),
    retry: false,
  });
  const activar = useMutation({
    mutationFn: (c: CentroCosteDto) =>
      controlAnaliticoApi.actualizarCentro(
        c.id,
        { activo: !c.activo },
        c.version,
      ),
    onSuccess: (c) => {
      toast(`Centro ${c.codigo} ${c.activo ? 'activado' : 'desactivado'}`);
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const saldoDe = new Map((saldos.data ?? []).map((s) => [s.centroId, s]));
  const nombre = new Map((centros.data ?? []).map((c) => [c.id, c.codigo]));
  return (
    <section>
      <div className="mb-2 flex justify-between">
        <h2 className="text-sm font-semibold">
          Centros y saldo analítico del periodo
        </h2>
        {gestiona && (
          <button
            type="button"
            className={btnPrimaryCls}
            onClick={() => setNuevo(true)}
          >
            Nuevo centro
          </button>
        )}
      </div>
      {(centros.isError || saldos.isError) && (
        <ErrorBanner
          message={((centros.error ?? saldos.error) as Error).message}
        />
      )}
      {centros.isLoading && <TableSkeleton />}
      {centros.isSuccess && centros.data.length === 0 && (
        <EmptyState icon={<IconCalculator />} title="Sin centros de coste">
          Crea los centros de estructura y apoyo y asígnales sus cuentas de
          gasto: el coste general sin obra se acumula en ellos para repartirlo.
        </EmptyState>
      )}
      {centros.isSuccess && centros.data.length > 0 && (
        <Tabla
          cabecera={
            <tr>
              <th className={th}>Centro</th>
              <th className={th}>Cuentas</th>
              <th className={thR}>Primario</th>
              <th className={thR}>Recibido</th>
              <th className={thR}>Repartido</th>
              <th className={thR}>Pendiente</th>
              <th className={th} />
            </tr>
          }
        >
          {centros.data.map((c) => {
            const s = saldoDe.get(c.id);
            return (
              <tr
                key={c.id}
                className={`border-t border-gray-100 ${c.activo ? '' : 'text-gray-400'}`}
              >
                <td className={td}>
                  <span className="font-medium">{c.codigo}</span> {c.nombre}
                  <span className="block text-xs text-gray-500">
                    {TIPO_CENTRO_COSTE_LABELS[c.tipo]}
                    {c.padreId && ` · bajo ${nombre.get(c.padreId) ?? '—'}`}
                    {c.responsableNombre && ` · ${c.responsableNombre}`}
                  </span>
                </td>
                <td className={`${td} text-xs`}>
                  {c.cuentas.length ? c.cuentas.join(', ') : '—'}
                </td>
                <td className={tdR}>{formatEur(s?.primario ?? 0)}</td>
                <td className={tdR}>{formatEur(s?.recibido ?? 0)}</td>
                <td className={tdR}>{formatEur(s?.repartido ?? 0)}</td>
                <td className={`${tdR} font-semibold`}>
                  {formatEur(s?.saldo ?? 0)}
                </td>
                <td className={td}>
                  {gestiona && (
                    <button
                      type="button"
                      className="text-xs text-gray-600 hover:underline"
                      disabled={activar.isPending}
                      onClick={() => {
                        if (can('editar', 'control_analitico'))
                          activar.mutate(c);
                      }}
                    >
                      {c.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </Tabla>
      )}
      <NuevoCentroModal
        open={nuevo}
        centros={centros.data ?? []}
        onClose={() => setNuevo(false)}
      />
    </section>
  );
}

function NuevoCentroModal({
  open,
  centros,
  onClose,
}: {
  open: boolean;
  centros: CentroCosteDto[];
  onClose: () => void;
}) {
  const inicial = {
    codigo: '',
    nombre: '',
    tipo: 'general' as TipoCentroCoste,
    padreId: '',
    cuentas: '',
  };
  const [f, setF] = useState(inicial);
  const toast = useToast();
  const { can } = usePermisos();
  const op = useEnvio(
    (clave) =>
      controlAnaliticoApi.crearCentro(
        {
          codigo: f.codigo.trim(),
          nombre: f.nombre.trim(),
          tipo: f.tipo,
          padreId: f.padreId || null,
          cuentas: f.cuentas
            .split(/[\s,;]+/)
            .map((x) => x.trim())
            .filter(Boolean),
        },
        clave,
      ),
    (c) => {
      toast(`Centro ${c.codigo} creado`);
      setF(inicial);
      onClose();
    },
  );
  return (
    <Modal open={open} title="Nuevo centro de coste" onClose={onClose}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (can('crear', 'control_analitico')) op.enviar();
        }}
      >
        <div>
          <label className={labelCls} htmlFor="cc-codigo">
            Código
          </label>
          <input
            id="cc-codigo"
            className={fieldCls}
            value={f.codigo}
            maxLength={20}
            required
            onChange={(e) => setF({ ...f, codigo: e.target.value })}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="cc-tipo">
            Tipo
          </label>
          <select
            id="cc-tipo"
            className={fieldCls}
            value={f.tipo}
            onChange={(e) =>
              setF({ ...f, tipo: e.target.value as TipoCentroCoste })
            }
          >
            {TIPOS_CENTRO_COSTE.map((t) => (
              <option key={t} value={t}>
                {TIPO_CENTRO_COSTE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="cc-nombre">
            Nombre
          </label>
          <input
            id="cc-nombre"
            className={fieldCls}
            value={f.nombre}
            maxLength={160}
            required
            onChange={(e) => setF({ ...f, nombre: e.target.value })}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="cc-padre">
            Centro padre
          </label>
          <select
            id="cc-padre"
            className={fieldCls}
            value={f.padreId}
            onChange={(e) => setF({ ...f, padreId: e.target.value })}
          >
            <option value="">— Ninguno —</option>
            {centros.map((c) => (
              <option key={c.id} value={c.id}>
                {c.codigo} · {c.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="cc-cuentas">
            Cuentas de gasto (prefijos)
          </label>
          <input
            id="cc-cuentas"
            className={fieldCls}
            value={f.cuentas}
            placeholder="62, 64"
            onChange={(e) => setF({ ...f, cuentas: e.target.value })}
          />
        </div>
        <p className="text-xs text-gray-500 sm:col-span-2">
          Los apuntes sin obra de esas cuentas son coste del centro (gana el
          prefijo más largo); también se puede imputar un centro en cada línea
          de un asiento manual.
        </p>
        <Pie pendiente={op.pendiente} onClose={onClose} texto="Crear centro" />
      </form>
    </Modal>
  );
}

/* ─────────────────────────── ciclos de reparto ─────────────────────────── */

function Repartos({
  periodo,
  gestiona,
}: {
  periodo: { desde: string; hasta: string };
  gestiona: boolean;
}) {
  const [nuevo, setNuevo] = useState(false);
  const [simulacion, setSimulacion] = useState<SimulacionRepartoDto | null>(
    null,
  );
  const [revirtiendo, setRevirtiendo] = useState<EjecucionRepartoDto | null>(
    null,
  );
  const { can } = usePermisos();
  const toast = useToast();
  const refrescar = useRefrescar();
  const avisarError = useAvisarError();
  const claveEjecucion = useRef(nuevoUuid());
  const ciclos = useQuery({
    queryKey: ['control-analitico', 'ciclos'],
    queryFn: controlAnaliticoApi.ciclos,
  });
  const ejecuciones = useQuery({
    queryKey: ['control-analitico', 'ejecuciones'],
    queryFn: controlAnaliticoApi.ejecuciones,
  });
  const simular = useMutation({
    mutationFn: (c: CicloRepartoDto) =>
      controlAnaliticoApi.simular(c.id, periodo.desde, periodo.hasta),
    onSuccess: setSimulacion,
    onError: (e) => avisarError(e),
  });
  const ejecutar = useMutation({
    mutationFn: (c: CicloRepartoDto) =>
      controlAnaliticoApi.ejecutar(
        c.id,
        periodo.desde,
        periodo.hasta,
        claveEjecucion.current,
      ),
    onSuccess: (r) => {
      claveEjecucion.current = nuevoUuid();
      setSimulacion(null);
      toast(`Reparto nº ${r.seq} contabilizado: ${formatEur(r.total)}`);
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const ultimaVigente = (ejecuciones.data ?? []).find(
    (e) => e.estado === 'contabilizado',
  );
  return (
    <section className="space-y-6">
      <div>
        <div className="mb-2 flex justify-between">
          <h2 className="text-sm font-semibold">Ciclos</h2>
          {gestiona && (
            <button
              type="button"
              className={btnPrimaryCls}
              onClick={() => setNuevo(true)}
            >
              Nuevo ciclo
            </button>
          )}
        </div>
        {ciclos.isError && (
          <ErrorBanner message={(ciclos.error as Error).message} />
        )}
        {ciclos.isLoading && <TableSkeleton />}
        {ciclos.isSuccess && ciclos.data.length === 0 && (
          <EmptyState icon={<IconCalculator />} title="Sin ciclos de reparto">
            Define qué centros se reparten, a qué obras o centros y con qué
            criterio (porcentaje, presupuesto, producción u horas).
          </EmptyState>
        )}
        {ciclos.isSuccess && ciclos.data.length > 0 && (
          <ul className="divide-y rounded-xl border bg-white text-sm shadow-sm">
            {ciclos.data.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 px-3 py-2"
              >
                <div>
                  <span className="font-medium">{c.codigo}</span> {c.nombre}
                  {!c.activo && (
                    <span className="ml-2 text-xs text-gray-500">inactivo</span>
                  )}
                  <span className="block text-xs text-gray-500">
                    {TIPO_CICLO_LABELS[c.tipo]}
                    {c.cuentaImputacion && ` ${c.cuentaImputacion}`} ·{' '}
                    {CRITERIO_REPARTO_LABELS[c.criterio]} · de{' '}
                    {c.emisores.map((e) => e.codigo).join(', ')} a{' '}
                    {c.receptores
                      .map(
                        (r) =>
                          `${r.codigo}${r.pesoPct !== null ? ` ${r.pesoPct} %` : ''}`,
                      )
                      .join(', ')}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={btnGhostCls}
                    disabled={simular.isPending}
                    onClick={() => simular.mutate(c)}
                  >
                    Simular
                  </button>
                  {gestiona && c.activo && (
                    <button
                      type="button"
                      className={btnPrimaryCls}
                      disabled={ejecutar.isPending}
                      onClick={() => {
                        if (can('editar', 'control_analitico'))
                          ejecutar.mutate(c);
                      }}
                    >
                      Ejecutar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {simulacion && (
        <div className="rounded-xl border bg-white p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">
              Simulación {simulacion.codigo} · {formatDate(simulacion.desde)} –{' '}
              {formatDate(simulacion.hasta)} ·{' '}
              {formatEur(simulacion.totalRepartido)}
            </p>
            <button
              type="button"
              className="text-xs text-gray-600 hover:underline"
              onClick={() => setSimulacion(null)}
            >
              Cerrar
            </button>
          </div>
          <Tabla
            cabecera={
              <tr>
                <th className={th}>Emisor</th>
                <th className={th}>Cuenta</th>
                <th className={th}>Receptor</th>
                <th className={thR}>Peso</th>
                <th className={thR}>Importe</th>
                <th className={thR}>Resto</th>
              </tr>
            }
          >
            {simulacion.lineas.map((l, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className={td}>{l.emisorCodigo}</td>
                <td className={td}>{l.cuenta}</td>
                <td className={td}>
                  {l.receptorCodigo}{' '}
                  <span className="text-xs text-gray-500">
                    {l.receptorTipo === 'obra' ? 'obra' : 'centro'}
                  </span>
                </td>
                <td className={tdR}>{l.peso}</td>
                <td className={tdR}>{formatEur(l.importe)}</td>
                <td className={tdR}>
                  {l.residuo === 0
                    ? '—'
                    : `${l.residuo > 0 ? '+' : ''}${l.residuo} cént.`}
                </td>
              </tr>
            ))}
          </Tabla>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold">Ejecuciones</h2>
        {(ejecuciones.data ?? []).length === 0 ? (
          <p className="rounded-xl border bg-white p-3 text-sm text-gray-500">
            Sin ejecuciones. Los repartos se anotan en el mayor analítico (no
            generan asientos) y se revierten en orden inverso.
          </p>
        ) : (
          <ul className="divide-y rounded-xl border bg-white text-sm shadow-sm">
            {(ejecuciones.data ?? []).map((e) => (
              <li
                key={e.id}
                className={`flex items-center justify-between px-3 py-2 ${e.estado === 'revertido' ? 'text-gray-400 line-through' : ''}`}
              >
                <span>
                  nº {e.seq} · {e.cicloCodigo} · {formatDate(e.desde)} –{' '}
                  {formatDate(e.hasta)}
                  {e.motivoReversion && ` · ${e.motivoReversion}`}
                </span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums">{formatEur(e.total)}</span>
                  {gestiona && e.id === ultimaVigente?.id && (
                    <button
                      type="button"
                      className="text-xs text-red-700 hover:underline"
                      onClick={() => setRevirtiendo(e)}
                    >
                      Revertir
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <NuevoCicloModal open={nuevo} onClose={() => setNuevo(false)} />
      <RevertirModal
        ejecucion={revirtiendo}
        onClose={() => setRevirtiendo(null)}
      />
    </section>
  );
}

function RevertirModal({
  ejecucion,
  onClose,
}: {
  ejecucion: EjecucionRepartoDto | null;
  onClose: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const toast = useToast();
  const { can } = usePermisos();
  const op = useEnvio(
    (clave) =>
      controlAnaliticoApi.revertir(
        ejecucion!.id,
        motivo.trim(),
        ejecucion!.version,
        clave,
      ),
    () => {
      toast('Reparto revertido');
      setMotivo('');
      onClose();
    },
  );
  return (
    <Modal
      open={ejecucion !== null}
      title={ejecucion ? `Revertir reparto nº ${ejecucion.seq}` : ''}
      onClose={onClose}
    >
      {ejecucion && (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (can('editar', 'control_analitico')) op.enviar();
          }}
        >
          <div>
            <label className={labelCls} htmlFor="rv-motivo">
              Motivo
            </label>
            <input
              id="rv-motivo"
              className={fieldCls}
              value={motivo}
              minLength={3}
              maxLength={240}
              required
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
          <Pie pendiente={op.pendiente} onClose={onClose} texto="Revertir" />
        </form>
      )}
    </Modal>
  );
}

function NuevoCicloModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const inicial = {
    codigo: '',
    nombre: '',
    tipo: 'distribucion' as TipoCicloReparto,
    criterio: 'porcentaje' as CriterioReparto,
    cuenta: '',
    emisores: [] as string[],
    /** clave `obra:<id>` | `centro:<id>` → peso (texto). */
    receptores: {} as Record<string, string>,
  };
  const [f, setF] = useState(inicial);
  const toast = useToast();
  const { can } = usePermisos();
  const centros = useQuery({
    queryKey: ['control-analitico', 'centros'],
    queryFn: controlAnaliticoApi.centros,
    enabled: open,
  });
  const obras = useQuery({
    queryKey: ['control-analitico', 'obras'],
    queryFn: () => projectsApi.list('', ''),
    enabled: open,
  });
  const porcentaje = f.criterio === 'porcentaje';
  const op = useEnvio(
    (clave) =>
      controlAnaliticoApi.crearCiclo(
        {
          codigo: f.codigo.trim(),
          nombre: f.nombre.trim(),
          tipo: f.tipo,
          criterio: f.criterio,
          cuentaImputacion: f.tipo === 'imputacion' ? f.cuenta.trim() : null,
          emisores: f.emisores,
          receptores: Object.entries(f.receptores).map(([k, peso]) => {
            const [tipo, id] = k.split(':');
            return {
              ...(tipo === 'obra' ? { projectId: id } : { costCenterId: id }),
              ...(porcentaje ? { pesoPct: aNumero(peso) ?? 0 } : {}),
            };
          }),
        },
        clave,
      ),
    (c) => {
      toast(`Ciclo ${c.codigo} creado`);
      setF(inicial);
      onClose();
    },
  );
  const alternar = (clave: string) => {
    const r = { ...f.receptores };
    if (clave in r) delete r[clave];
    else r[clave] = '';
    setF({ ...f, receptores: r });
  };
  const sumaPct = Object.values(f.receptores).reduce(
    (s, v) => s + Math.round((aNumero(v) ?? 0) * 10_000),
    0,
  );
  const receptor = (clave: string, etiqueta: string) => (
    <label key={clave} className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={clave in f.receptores}
        onChange={() => alternar(clave)}
      />
      <span className="flex-1">{etiqueta}</span>
      {porcentaje && clave in f.receptores && (
        <input
          className={`${inputCls} w-24`}
          inputMode="decimal"
          aria-label={`Peso de ${etiqueta}`}
          value={f.receptores[clave]}
          onChange={(e) =>
            setF({
              ...f,
              receptores: { ...f.receptores, [clave]: e.target.value },
            })
          }
        />
      )}
    </label>
  );
  return (
    <Modal open={open} title="Nuevo ciclo de reparto" onClose={onClose}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (can('crear', 'control_analitico')) op.enviar();
        }}
      >
        <div>
          <label className={labelCls} htmlFor="ci-codigo">
            Código
          </label>
          <input
            id="ci-codigo"
            className={fieldCls}
            value={f.codigo}
            maxLength={20}
            required
            onChange={(e) => setF({ ...f, codigo: e.target.value })}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="ci-nombre">
            Nombre
          </label>
          <input
            id="ci-nombre"
            className={fieldCls}
            value={f.nombre}
            required
            onChange={(e) => setF({ ...f, nombre: e.target.value })}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="ci-tipo">
            Tipo
          </label>
          <select
            id="ci-tipo"
            className={fieldCls}
            value={f.tipo}
            onChange={(e) =>
              setF({ ...f, tipo: e.target.value as TipoCicloReparto })
            }
          >
            {TIPOS_CICLO_REPARTO.map((t) => (
              <option key={t} value={t}>
                {TIPO_CICLO_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="ci-criterio">
            Criterio
          </label>
          <select
            id="ci-criterio"
            className={fieldCls}
            value={f.criterio}
            onChange={(e) => {
              const criterio = e.target.value as CriterioReparto;
              // Fuera de porcentaje solo se reparte a obras.
              const receptores =
                criterio === 'porcentaje'
                  ? f.receptores
                  : Object.fromEntries(
                      Object.keys(f.receptores)
                        .filter((k) => k.startsWith('obra:'))
                        .map((k) => [k, '']),
                    );
              setF({ ...f, criterio, receptores });
            }}
          >
            {CRITERIOS_REPARTO.map((c) => (
              <option key={c} value={c}>
                {CRITERIO_REPARTO_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        {f.tipo === 'imputacion' && (
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="ci-cuenta">
              Cuenta secundaria de imputación
            </label>
            <input
              id="ci-cuenta"
              className={fieldCls}
              value={f.cuenta}
              pattern="6[0-9]{2,9}"
              placeholder="6290"
              required
              onChange={(e) => setF({ ...f, cuenta: e.target.value })}
            />
          </div>
        )}
        <fieldset className="sm:col-span-2">
          <legend className={labelCls}>Centros emisores</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {(centros.data ?? []).map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={f.emisores.includes(c.id)}
                  onChange={() => {
                    const emisores = f.emisores.includes(c.id)
                      ? f.emisores.filter((x) => x !== c.id)
                      : [...f.emisores, c.id];
                    const receptores = { ...f.receptores };
                    delete receptores[`centro:${c.id}`];
                    setF({ ...f, emisores, receptores });
                  }}
                />
                {c.codigo} · {c.nombre}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="sm:col-span-2">
          <legend className={labelCls}>
            Receptores
            {porcentaje && ` (suma ${(sumaPct / 10_000).toFixed(4)} %)`}
          </legend>
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {(obras.data ?? []).map((o) =>
              receptor(`obra:${o.id}`, `Obra ${o.code} · ${o.name}`),
            )}
            {porcentaje &&
              (centros.data ?? [])
                .filter((c) => !f.emisores.includes(c.id))
                .map((c) => receptor(`centro:${c.id}`, `Centro ${c.codigo}`))}
          </div>
          {porcentaje && sumaPct !== 1_000_000 && (
            <p className="mt-1 flex items-center gap-1 text-xs text-amber-700">
              <IconAlertTriangle size={12} /> Los porcentajes deben sumar 100.
            </p>
          )}
        </fieldset>
        <Pie pendiente={op.pendiente} onClose={onClose} texto="Crear ciclo" />
      </form>
    </Modal>
  );
}

/* ─────────────────────────── coste completo ─────────────────────────── */

function CosteObras() {
  const [hasta, setHasta] = useState(hoy);
  const coste = useQuery({
    queryKey: ['control-analitico', 'coste', hasta],
    queryFn: () => controlAnaliticoApi.costeObras(hasta),
  });
  return (
    <section>
      <div className="mb-2 flex items-center gap-2 text-xs text-gray-600">
        Hasta
        <input
          type="date"
          className={inputCls}
          value={hasta}
          onChange={(e) => setHasta(e.target.value)}
        />
      </div>
      {coste.isError && (
        <ErrorBanner message={(coste.error as Error).message} />
      )}
      {coste.isLoading && <TableSkeleton />}
      {coste.data && (
        <Tabla
          cabecera={
            <tr>
              <th className={th}>Obra</th>
              <th className={thR}>Coste directo</th>
              <th className={thR}>Indirectos</th>
              <th className={thR}>Coste completo</th>
              <th className={th}>Por centro</th>
            </tr>
          }
        >
          {coste.data.map((o) => (
            <tr key={o.projectId} className="border-t border-gray-100">
              <td className={td}>
                <span className="font-medium">{o.codigo}</span> {o.nombre}
              </td>
              <td className={tdR}>{formatEur(o.costeDirecto)}</td>
              <td className={tdR}>{formatEur(o.indirectos)}</td>
              <td className={`${tdR} font-semibold`}>
                {formatEur(o.costeCompleto)}
              </td>
              <td className={`${td} text-xs text-gray-500`}>
                {o.porCentro
                  .map((c) => `${c.codigo} ${formatEur(c.importe)}`)
                  .join(' · ') || '—'}
              </td>
            </tr>
          ))}
        </Tabla>
      )}
    </section>
  );
}

/* ─────────────────────────── rolling forecast ─────────────────────────── */

function Forecast({ gestiona }: { gestiona: boolean }) {
  const [escenarioId, setEscenarioId] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [etiqueta, setEtiqueta] = useState('');
  const { can } = usePermisos();
  const toast = useToast();
  const refrescar = useRefrescar();
  const avisarError = useAvisarError();
  const escenarios = useQuery({
    queryKey: ['control-analitico', 'escenarios'],
    queryFn: controlAnaliticoApi.escenarios,
  });
  const esc =
    escenarios.data?.find((e) => e.id === escenarioId) ?? escenarios.data?.[0];
  const prevision = useQuery({
    queryKey: ['control-analitico', 'forecast', esc?.id, fecha],
    queryFn: () => controlAnaliticoApi.forecast(esc!.id, fecha),
    enabled: Boolean(esc),
    retry: false,
  });
  const predeterminados = useMutation({
    mutationFn: controlAnaliticoApi.escenariosPredeterminados,
    onSuccess: () => {
      toast('Escenarios base, optimista y tensionado creados');
      refrescar();
    },
    onError: (e) => avisarError(e),
  });
  const foto = useEnvio(
    (clave) =>
      controlAnaliticoApi.crearFoto(
        {
          escenarioId: esc!.id,
          fecha,
          etiqueta: etiqueta.trim() || `Foto ${fecha}`,
        },
        clave,
      ),
    () => {
      toast('Foto guardada: será la línea base de las varianzas');
      setEtiqueta('');
    },
  );
  const p = prevision.data;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {escenarios.isSuccess && escenarios.data.length === 0 && (
          <span className="text-sm text-gray-600">Sin escenarios.</span>
        )}
        {(escenarios.data ?? []).length > 0 && (
          <select
            className={selectCls}
            aria-label="Escenario"
            value={esc?.id ?? ''}
            onChange={(e) => setEscenarioId(e.target.value)}
          >
            {escenarios.data!.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre} · coste {e.ajusteCostePct > 0 ? '+' : ''}
                {e.ajusteCostePct} % · ingresos{' '}
                {e.ajusteIngresoPct > 0 ? '+' : ''}
                {e.ajusteIngresoPct} %
                {e.retrasoMeses ? ` · +${e.retrasoMeses} meses` : ''}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-1 text-xs text-gray-600">
          Corte
          <input
            type="date"
            className={inputCls}
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </label>
        {gestiona && (escenarios.data ?? []).length < 3 && (
          <button
            type="button"
            className={btnGhostCls}
            disabled={predeterminados.isPending}
            onClick={() => {
              if (can('crear', 'control_analitico')) predeterminados.mutate();
            }}
          >
            Crear escenarios predeterminados
          </button>
        )}
        {esc && can('crear', 'contabilidad') && (
          <form
            className="ml-auto flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (can('crear', 'contabilidad')) foto.enviar();
            }}
          >
            <input
              className={inputCls}
              placeholder="Etiqueta de la foto"
              maxLength={120}
              value={etiqueta}
              onChange={(e) => setEtiqueta(e.target.value)}
            />
            <button
              type="submit"
              className={btnPrimaryCls}
              disabled={foto.pendiente}
            >
              Guardar foto
            </button>
          </form>
        )}
      </div>

      {prevision.isError && (
        <ErrorBanner message={(prevision.error as Error).message} />
      )}
      {prevision.isLoading && <TableSkeleton />}
      {p && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Kpi titulo="Presupuesto de coste">
              {formatEur(p.totales.presupuestado)}
            </Kpi>
            <Kpi titulo="Real + indirectos">
              {formatEur(sumar(p.totales.costeReal, p.totales.indirectos))}
            </Kpi>
            <Kpi titulo="EAC del escenario">{formatEur(p.totales.eac)}</Kpi>
            <Kpi titulo="Ingresos previstos">
              {formatEur(p.totales.ingresosPrevistos)}
            </Kpi>
            <Kpi titulo="Margen previsto" alerta={p.totales.margen < 0}>
              {formatEur(p.totales.margen)}
              {p.totales.margenPct !== null && (
                <span className="block text-xs font-normal text-gray-500">
                  {p.totales.margenPct} %
                </span>
              )}
            </Kpi>
          </div>
          {p.baseline && p.varianza && (
            <p className="text-sm text-gray-700">
              Frente a la foto «{p.baseline.etiqueta}» (
              {formatDate(p.baseline.fecha)}): EAC{' '}
              {p.varianza.eac >= 0 ? '+' : ''}
              {formatEur(p.varianza.eac)} · margen{' '}
              <span className={p.varianza.margen < 0 ? 'text-red-700' : ''}>
                {p.varianza.margen >= 0 ? '+' : ''}
                {formatEur(p.varianza.margen)}
              </span>
            </p>
          )}
          <Tabla
            cabecera={
              <tr>
                <th className={th}>Obra</th>
                <th className={thR}>Presupuesto</th>
                <th className={thR}>Real</th>
                <th className={thR}>Indirectos</th>
                <th className={thR}>Pendiente</th>
                <th className={thR}>EAC</th>
                <th className={thR}>Ingresos</th>
                <th className={thR}>Margen</th>
                <th className={thR}>Δ EAC</th>
                <th className={th}>Alertas</th>
              </tr>
            }
          >
            {p.obras.map((o) => (
              <tr key={o.projectId} className="border-t border-gray-100">
                <td className={td}>
                  <span className="font-medium">{o.codigo}</span> {o.nombre}
                  <span className="block text-xs text-gray-500">
                    {o.mesesRestantes} meses restantes
                    {o.finPrevista && ` · fin ${formatDate(o.finPrevista)}`}
                  </span>
                </td>
                <td className={tdR}>{formatEur(o.presupuestado)}</td>
                <td className={tdR}>{formatEur(o.costeReal)}</td>
                <td className={tdR}>{formatEur(o.indirectos)}</td>
                <td className={tdR}>
                  {formatEur(sumar(o.costePendiente, o.indirectosPendientes))}
                </td>
                <td className={`${tdR} font-semibold`}>{formatEur(o.eac)}</td>
                <td className={tdR}>{formatEur(o.ingresosPrevistos)}</td>
                <td className={`${tdR} ${o.margen < 0 ? 'text-red-700' : ''}`}>
                  {formatEur(o.margen)}
                </td>
                <td className={tdR}>
                  {o.varianza ? formatEur(o.varianza.eac) : '—'}
                </td>
                <td className={`${td} text-xs`}>
                  {o.alertas.map((a) => (
                    <span
                      key={a}
                      className="mr-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-amber-800"
                    >
                      {ALERTA_LABELS[a] ?? a}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </Tabla>
          {p.serie.length > 0 && (
            <Tabla
              cabecera={
                <tr>
                  <th className={th}>Mes</th>
                  <th className={thR}>Coste previsto</th>
                  <th className={thR}>Ingreso previsto</th>
                  <th className={thR}>Neto</th>
                </tr>
              }
            >
              {p.serie.map((s) => (
                <tr key={s.mes} className="border-t border-gray-100">
                  <td className={td}>{s.mes}</td>
                  <td className={tdR}>{formatEur(s.coste)}</td>
                  <td className={tdR}>{formatEur(s.ingreso)}</td>
                  <td className={tdR}>
                    {formatEur(sumar(s.ingreso, -s.coste))}
                  </td>
                </tr>
              ))}
            </Tabla>
          )}
        </>
      )}
    </section>
  );
}
