'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import {
  METODOS_CONSOLIDACION,
  METODO_CONSOLIDACION_LABELS,
  TIPOS_CAMBIO_CONSOLIDACION,
  TIPO_CAMBIO_LABELS,
  type AjusteConsolidacionDto,
  type EstadosConsolidadosDto,
  type FilaConsolidacion,
  type GrupoDto,
  type MetodoConsolidacion,
  type MiembroGrupoDto,
  type TipoCambioConsolidacion,
  type TipoCambioDto,
} from '@erp/shared';
import { formatDate, formatEur, holdingApi } from '@/lib/api';
import { nuevoUuid } from '@/lib/api-error';
import { useAuth } from '@/lib/auth';
import { usePermisos } from '@/lib/permisos';
import { IconAlertTriangle, IconBuilding } from '@/components/icons';
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

const ETIQUETA_MASA: Record<string, string> = {
  activo: 'Activo',
  pasivo: 'Pasivo',
  patrimonio: 'Patrimonio neto',
  ingreso: 'Ingresos',
  gasto: 'Gastos',
};
const ETIQUETA_GRUPO: Record<string, string> = {
  '1': '1 · Financiación básica',
  '2': '2 · Activo no corriente',
  '3': '3 · Existencias',
  '4': '4 · Acreedores y deudores',
  '5': '5 · Cuentas financieras',
  '6': '6 · Compras y gastos',
  '7': '7 · Ventas e ingresos',
};

function anioActual() {
  const y = new Date().getFullYear();
  return { desde: `${y}-01-01`, hasta: `${y}-12-31` };
}

/** Invalida todo lo de consolidación tras una mutación. */
function useRefrescar() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ['holding'] });
}

export default function ConsolidacionPage() {
  const [grupoId, setGrupoId] = useState('');
  const [periodo, setPeriodo] = useState(anioActual);
  const [vista, setVista] = useState<'masa' | 'grupo'>('masa');
  const [modal, setModal] = useState<
    | 'grupo'
    | 'miembro'
    | 'ajuste'
    | 'cierre'
    | 'permisos'
    | 'sociedad'
    | 'tipo'
    | null
  >(null);
  const [editandoTipo, setEditandoTipo] = useState<TipoCambioDto | null>(null);
  const [editando, setEditando] = useState<MiembroGrupoDto | null>(null);
  const { can } = usePermisos();
  const { user } = useAuth();
  const gestiona =
    can('editar', 'contabilidad') && user?.role !== 'administracion';
  const esAdmin = can('editar', 'contabilidad') && user?.role === 'admin';

  const grupos = useQuery({
    queryKey: ['holding', 'grupos'],
    queryFn: holdingApi.grupos,
  });
  const grupo: GrupoDto | undefined =
    grupos.data?.find((g) => g.id === grupoId) ?? grupos.data?.[0];
  const gid = grupo?.id ?? '';
  const estados = useQuery({
    queryKey: ['holding', 'estados', gid, periodo.desde, periodo.hasta],
    queryFn: () => holdingApi.estados(gid, periodo.desde, periodo.hasta),
    enabled: Boolean(gid),
    retry: false,
  });
  const tesoreria = useQuery({
    queryKey: ['holding', 'tesoreria', gid, periodo.hasta],
    queryFn: () => holdingApi.tesoreria(gid, periodo.hasta),
    enabled: Boolean(gid),
    retry: false,
  });
  const ajustes = useQuery({
    queryKey: ['holding', 'ajustes', gid],
    queryFn: () => holdingApi.ajustes(gid),
    enabled: Boolean(gid),
  });
  const tiposCambio = useQuery({
    queryKey: ['holding', 'tipos-cambio', gid],
    queryFn: () => holdingApi.tiposCambio(gid),
    enabled: Boolean(gid),
  });

  const e = estados.data;
  const t = tesoreria.data;
  const monedasExtranjeras = grupo
    ? [
        ...new Set(
          grupo.miembros
            .map((m) => m.monedaFuncional)
            .filter((mo) => mo && mo !== grupo.monedaBase),
        ),
      ]
    : [];

  return (
    <div>
      <PageHeader
        title="Consolidación de grupo"
        subtitle="Balance, cuenta de resultados y tesorería consolidados del holding: eliminaciones intragrupo e inversión–patrimonio neto, socios externos, fondo de comercio y conversión de moneda extranjera."
      >
        {esAdmin && (
          <button
            type="button"
            className={btnGhostCls}
            onClick={() => setModal('permisos')}
          >
            Permisos de consolidación
          </button>
        )}
        {esAdmin && (
          <button
            type="button"
            className={btnGhostCls}
            onClick={() => setModal('sociedad')}
          >
            Alta de sociedad
          </button>
        )}
        {gestiona && (
          <button
            type="button"
            className={btnPrimaryCls}
            onClick={() => setModal('grupo')}
          >
            Nuevo grupo
          </button>
        )}
      </PageHeader>

      {grupos.isError && (
        <ErrorBanner message={(grupos.error as Error).message} />
      )}
      {grupos.isLoading && <TableSkeleton />}
      {grupos.isSuccess && grupos.data.length === 0 && (
        <EmptyState icon={<IconBuilding />} title="Sin grupos">
          Crea un grupo: tu sociedad será la matriz. Para integrar otra
          sociedad, su administrador debe concederte antes el permiso de
          consolidación.
        </EmptyState>
      )}

      {grupo && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <select
              className={selectCls}
              value={gid}
              onChange={(ev) => setGrupoId(ev.target.value)}
              aria-label="Grupo"
            >
              {grupos.data!.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nombre}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-gray-600">
              Desde
              <input
                type="date"
                className={inputCls}
                value={periodo.desde}
                onChange={(ev) =>
                  setPeriodo({ ...periodo, desde: ev.target.value })
                }
              />
            </label>
            <label className="flex items-center gap-1 text-xs text-gray-600">
              Hasta
              <input
                type="date"
                className={inputCls}
                value={periodo.hasta}
                onChange={(ev) =>
                  setPeriodo({ ...periodo, hasta: ev.target.value })
                }
              />
            </label>
            {e?.cerrado && (
              <span className="rounded bg-gray-800 px-2 py-0.5 text-xs font-semibold text-white">
                Periodo cerrado
              </span>
            )}
            {gestiona && !e?.cerrado && (
              <button
                type="button"
                className={btnGhostCls}
                onClick={() => setModal('cierre')}
              >
                Cerrar periodo
              </button>
            )}
          </div>

          {(estados.isError || tesoreria.isError) && (
            <ErrorBanner
              message={((estados.error ?? tesoreria.error) as Error).message}
            />
          )}

          {e && (
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Kpi titulo="Posición neta de tesorería">
                {t ? formatEur(t.posicionNeta) : '—'}
              </Kpi>
              <Kpi titulo="Ingresos consolidados">
                {formatEur(e.totales.ingresos)}
              </Kpi>
              <Kpi titulo="Gastos consolidados">
                {formatEur(e.totales.gastos)}
              </Kpi>
              <Kpi
                titulo="Resultado del grupo"
                alerta={e.totales.resultado < 0}
              >
                {formatEur(e.totales.resultado)}
                {e.sociosExternos.resultado !== 0 && (
                  <span className="block text-xs font-normal text-gray-500">
                    Dominante {formatEur(e.resultadoAtribuidoDominante)} ·
                    externos {formatEur(e.sociosExternos.resultado)}
                  </span>
                )}
              </Kpi>
              <Kpi
                titulo="Eliminaciones intragrupo"
                alerta={e.descuadreIntercompania}
              >
                {formatEur(e.eliminacionesAutomaticas)}
                {e.descuadreIntercompania && (
                  <span className="mt-1 flex items-center gap-1 text-xs font-semibold">
                    <IconAlertTriangle size={12} /> Descuadre intercompañía
                  </span>
                )}
              </Kpi>
            </div>
          )}

          {estados.isLoading && <TableSkeleton />}
          {e && (
            <>
              <div className="mb-2 flex items-center gap-2">
                {(['masa', 'grupo'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVista(v)}
                    className={`rounded-md px-2 py-1 text-xs font-medium ${
                      vista === v
                        ? 'bg-gray-900 text-white'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {v === 'masa'
                      ? 'Por masas'
                      : 'Por grupo PGC (saldo deudor)'}
                  </button>
                ))}
                {e.totales.descuadreBalance !== 0 && (
                  <span className="text-xs font-semibold text-red-700">
                    Balance descuadrado: {formatEur(e.totales.descuadreBalance)}
                  </span>
                )}
              </div>
              <TablaComparativa
                e={e}
                filas={vista === 'masa' ? e.porMasa : e.porGrupo}
                etiqueta={(k) =>
                  (vista === 'masa' ? ETIQUETA_MASA[k] : ETIQUETA_GRUPO[k]) ?? k
                }
              />
              {e.conciliacionIntragrupo.length > 0 && <Conciliacion e={e} />}
              <GroupReporting e={e} />
            </>
          )}

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Sociedades del grupo</h2>
                {gestiona && (
                  <button
                    type="button"
                    className={btnGhostCls}
                    onClick={() => setModal('miembro')}
                  >
                    Integrar sociedad
                  </button>
                )}
              </div>
              <ul className="divide-y rounded-xl border bg-white text-sm shadow-sm">
                {grupo.miembros.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <div>
                      <span className="font-medium">{m.nombre}</span>{' '}
                      <span className="text-xs text-gray-500">{m.nif}</span>
                      <span className="block text-xs text-gray-500">
                        {METODO_CONSOLIDACION_LABELS[m.metodo]} ·{' '}
                        {m.participacionPct} %
                        {m.companyId === grupo.matrizId
                          ? ' · matriz'
                          : ` · alta ${formatDate(m.fechaAlta)}`}
                        {m.fechaBaja && ` · baja ${formatDate(m.fechaBaja)}`}
                        {m.monedaFuncional &&
                          m.monedaFuncional !== grupo.monedaBase &&
                          ` · ${m.monedaFuncional}`}
                      </span>
                      {m.costeInversion !== null &&
                        m.costeInversion !== undefined && (
                          <span className="block text-xs text-gray-500">
                            Inversión {formatEur(m.costeInversion)} en{' '}
                            {m.cuentaInversion}
                            {m.fechaAdquisicion &&
                              ` · control ${formatDate(m.fechaAdquisicion)}`}
                          </span>
                        )}
                      {!m.accesible && (
                        <span className="text-xs font-semibold text-red-700">
                          Sin permiso de consolidación vigente
                        </span>
                      )}
                    </div>
                    {gestiona && m.companyId !== grupo.matrizId && (
                      <button
                        type="button"
                        className="text-xs text-gray-600 hover:underline"
                        onClick={() => setEditando(m)}
                      >
                        Editar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {t && t.cartera.length > 0 && (
                <div className="mt-4 rounded-xl border bg-white p-3 text-sm shadow-sm">
                  <p className="mb-1 text-xs font-semibold uppercase text-gray-500">
                    Cartera de obras
                  </p>
                  {t.cartera.map((c) => (
                    <div
                      key={c.companyId}
                      className="flex justify-between py-0.5"
                    >
                      <span>
                        {c.nombre} · {c.obrasActivas} obras activas
                      </span>
                      <span className="tabular-nums">
                        {formatEur(c.contratado)} · pendiente{' '}
                        {formatEur(c.pendienteCertificar)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <Ajustes
              grupoId={gid}
              ajustes={ajustes.data ?? []}
              gestiona={gestiona}
              onNuevo={() => setModal('ajuste')}
            />
          </div>
          <TiposCambio
            grupo={grupo}
            tipos={tiposCambio.data ?? []}
            monedasExtranjeras={monedasExtranjeras}
            gestiona={gestiona}
            onNuevo={() => setModal('tipo')}
            onEditar={setEditandoTipo}
          />
        </>
      )}

      <NuevoGrupoModal
        open={modal === 'grupo'}
        onClose={() => setModal(null)}
      />
      {grupo && (
        <>
          <IntegrarModal
            grupo={grupo}
            open={modal === 'miembro'}
            onClose={() => setModal(null)}
          />
          <AjusteModal
            grupoId={gid}
            open={modal === 'ajuste'}
            onClose={() => setModal(null)}
          />
          <CierreModal
            grupoId={gid}
            periodo={periodo}
            descuadre={e?.descuadreIntercompania ?? false}
            open={modal === 'cierre'}
            onClose={() => setModal(null)}
          />
          <EditarMiembroModal
            grupoId={gid}
            miembro={editando}
            onClose={() => setEditando(null)}
          />
          <TipoCambioModal
            grupo={grupo}
            monedasExtranjeras={monedasExtranjeras}
            open={modal === 'tipo'}
            onClose={() => setModal(null)}
          />
          <EditarTasaModal
            grupoId={gid}
            tipo={editandoTipo}
            onClose={() => setEditandoTipo(null)}
          />
        </>
      )}
      <AltaSociedadModal
        grupo={grupo ?? null}
        open={modal === 'sociedad'}
        onClose={() => setModal(null)}
      />
      <PermisosModal
        open={modal === 'permisos'}
        onClose={() => setModal(null)}
      />
    </div>
  );
}

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

function TablaComparativa({
  e,
  filas,
  etiqueta,
}: {
  e: EstadosConsolidadosDto;
  filas: FilaConsolidacion[];
  etiqueta: (clave: string) => string;
}) {
  // Las puestas en equivalencia no integran saldos: no tienen columna.
  const integradas = e.sociedades.filter(
    (s) => s.metodo !== 'puesta_equivalencia',
  );
  return (
    <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs text-gray-500">
          <tr>
            <th className="px-3 py-2" />
            {integradas.map((s) => (
              <th key={s.companyId} className="px-3 py-2 text-right">
                {s.nombre}
                <span className="block font-normal">
                  {s.metodo === 'proporcional'
                    ? `${s.participacionPct} % prop.`
                    : `${s.participacionPct} %`}
                </span>
              </th>
            ))}
            <th className="px-3 py-2 text-right">Agregado</th>
            <th className="px-3 py-2 text-right">Eliminaciones</th>
            <th className="px-3 py-2 text-right">Consolidado</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.clave} className="border-t border-gray-100">
              <td className="px-3 py-2 font-medium">{etiqueta(f.clave)}</td>
              {integradas.map((s) => (
                <td
                  key={s.companyId}
                  className="px-3 py-2 text-right tabular-nums"
                >
                  {formatEur(f.porSociedad[s.companyId] ?? 0)}
                </td>
              ))}
              <td className="px-3 py-2 text-right tabular-nums">
                {formatEur(f.agregado)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                {f.eliminaciones === 0 ? '—' : formatEur(f.eliminaciones)}
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">
                {formatEur(f.consolidado)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Conciliacion({ e }: { e: EstadosConsolidadosDto }) {
  const nombre = new Map(e.sociedades.map((s) => [s.companyId, s.nombre]));
  return (
    <div className="mt-4 overflow-x-auto rounded-xl border bg-white shadow-sm">
      <p className="px-3 pt-3 text-xs font-semibold uppercase text-gray-500">
        Conciliación intercompañía
      </p>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-gray-500">
          <tr>
            <th className="px-3 py-2">Vendedor → comprador</th>
            <th className="px-3 py-2 text-right">Ventas</th>
            <th className="px-3 py-2 text-right">Compras</th>
            <th className="px-3 py-2 text-right">A cobrar</th>
            <th className="px-3 py-2 text-right">A pagar</th>
            <th className="px-3 py-2">Estado</th>
          </tr>
        </thead>
        <tbody>
          {e.conciliacionIntragrupo.map((c) => (
            <tr
              key={`${c.vendedor}-${c.comprador}`}
              className="border-t border-gray-100"
            >
              <td className="px-3 py-2">
                {nombre.get(c.vendedor)} → {nombre.get(c.comprador)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatEur(c.ventas)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatEur(c.compras)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatEur(c.cobrar)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatEur(c.pagar)}
              </td>
              <td className="px-3 py-2">
                {c.descuadre ? (
                  <span className="text-xs font-semibold text-red-700">
                    Descuadre {formatEur(c.diferenciaOperaciones)} /{' '}
                    {formatEur(c.diferenciaSaldos)}
                  </span>
                ) : (
                  <span className="text-xs text-emerald-700">Conciliado</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Ajustes({
  grupoId,
  ajustes,
  gestiona,
  onNuevo,
}: {
  grupoId: string;
  ajustes: AjusteConsolidacionDto[];
  gestiona: boolean;
  onNuevo: () => void;
}) {
  const clave = useRef(nuevoUuid());
  const refrescar = useRefrescar();
  const toast = useToast();
  const avisarError = useAvisarError();
  const anular = useMutation({
    mutationFn: (a: AjusteConsolidacionDto) =>
      holdingApi.anularAjuste(
        grupoId,
        a.id,
        'Anulado desde la consolidación',
        a.version,
        clave.current,
      ),
    onSuccess: () => {
      clave.current = nuevoUuid();
      toast('Ajuste anulado');
      refrescar();
    },
    onError: (err) => avisarError(err, refrescar),
  });
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Ajustes de consolidación</h2>
        {gestiona && (
          <button type="button" className={btnGhostCls} onClick={onNuevo}>
            Nuevo ajuste
          </button>
        )}
      </div>
      {ajustes.length === 0 ? (
        <p className="rounded-xl border bg-white p-3 text-sm text-gray-500">
          Sin ajustes manuales. Las eliminaciones intragrupo se calculan solas.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border bg-white text-sm shadow-sm">
          {ajustes.map((a) => (
            <li
              key={a.id}
              className={`px-3 py-2 ${a.estado === 'anulado' ? 'text-gray-400 line-through' : ''}`}
            >
              <div className="flex justify-between gap-2">
                <span>
                  {formatDate(a.fecha)} · {a.concepto}
                </span>
                <span className="tabular-nums">{formatEur(a.importe)}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>
                  {a.cuentaDebe} a {a.cuentaHaber}
                </span>
                {gestiona && a.estado === 'vigente' && (
                  <button
                    type="button"
                    className="text-red-700 hover:underline"
                    disabled={anular.isPending}
                    onClick={() => anular.mutate(a)}
                  >
                    Anular
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
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

function NuevoGrupoModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [nombre, setNombre] = useState('');
  const toast = useToast();
  const { can } = usePermisos();
  const op = useEnvio(
    (clave) => holdingApi.crearGrupo(nombre.trim(), clave),
    (g) => {
      toast(`Grupo «${g.nombre}» creado`);
      setNombre('');
      onClose();
    },
  );
  return (
    <Modal open={open} title="Nuevo grupo" onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (can('crear', 'contabilidad')) op.enviar();
        }}
      >
        <div>
          <label className={labelCls} htmlFor="gr-nombre">
            Nombre del grupo
          </label>
          <input
            id="gr-nombre"
            className={fieldCls}
            value={nombre}
            maxLength={120}
            required
            onChange={(ev) => setNombre(ev.target.value)}
          />
        </div>
        <p className="text-xs text-gray-500">
          Tu sociedad queda como matriz, integrada al 100 %.
        </p>
        <Pie pendiente={op.pendiente} onClose={onClose} texto="Crear grupo" />
      </form>
    </Modal>
  );
}

function IntegrarModal({
  grupo,
  open,
  onClose,
}: {
  grupo: GrupoDto;
  open: boolean;
  onClose: () => void;
}) {
  const [f, setF] = useState({
    companyId: '',
    pct: '100',
    metodo: 'global' as MetodoConsolidacion,
    fechaAlta: anioActual().desde,
    coste: '',
    cuenta: '2403',
  });
  const toast = useToast();
  const { can } = usePermisos();
  const coste = aNumero(f.coste);
  const sociedades = useQuery({
    queryKey: ['holding', 'sociedades'],
    queryFn: holdingApi.sociedades,
    enabled: open,
  });
  const ya = new Set(
    grupo.miembros.filter((m) => !m.fechaBaja).map((m) => m.companyId),
  );
  const op = useEnvio(
    (clave) =>
      holdingApi.integrar(
        grupo.id,
        {
          companyId: f.companyId,
          participacionPct: Number(f.pct.replace(',', '.')),
          metodo: f.metodo,
          fechaAlta: f.fechaAlta,
          ...(coste !== null && {
            costeInversion: coste,
            cuentaInversion: f.cuenta.trim() || '2403',
          }),
        },
        clave,
      ),
    () => {
      toast('Sociedad integrada');
      onClose();
    },
  );
  return (
    <Modal open={open} title="Integrar sociedad" onClose={onClose}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (can('editar', 'contabilidad')) op.enviar();
        }}
      >
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="in-soc">
            Sociedad (con permiso de consolidación)
          </label>
          <select
            id="in-soc"
            className={fieldCls}
            value={f.companyId}
            required
            onChange={(ev) => setF({ ...f, companyId: ev.target.value })}
          >
            <option value="">Selecciona la sociedad</option>
            {(sociedades.data ?? [])
              .filter((s) => !ya.has(s.companyId))
              .map((s) => (
                <option key={s.companyId} value={s.companyId}>
                  {s.nombre} · {s.nif}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="in-pct">
            Participación %
          </label>
          <input
            id="in-pct"
            className={fieldCls}
            inputMode="decimal"
            value={f.pct}
            required
            onChange={(ev) => setF({ ...f, pct: ev.target.value })}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="in-met">
            Método
          </label>
          <select
            id="in-met"
            className={fieldCls}
            value={f.metodo}
            onChange={(ev) =>
              setF({ ...f, metodo: ev.target.value as MetodoConsolidacion })
            }
          >
            {METODOS_CONSOLIDACION.map((m) => (
              <option key={m} value={m}>
                {METODO_CONSOLIDACION_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="in-alta">
            Fecha de alta
          </label>
          <input
            id="in-alta"
            type="date"
            className={fieldCls}
            value={f.fechaAlta}
            required
            onChange={(ev) => setF({ ...f, fechaAlta: ev.target.value })}
          />
        </div>
        <CamposInversion
          prefijo="in"
          coste={f.coste}
          cuenta={f.cuenta}
          obligatorio={f.metodo === 'puesta_equivalencia'}
          onCoste={(v) => setF({ ...f, coste: v })}
          onCuenta={(v) => setF({ ...f, cuenta: v })}
        />
        <Pie pendiente={op.pendiente} onClose={onClose} texto="Integrar" />
      </form>
    </Modal>
  );
}

/** `"1.234,5"` → 1234.5, `"0.92"` → 0.92; vacío o inválido → null. */
function aNumero(texto: string): number | null {
  const limpio = texto.trim();
  const t = limpio.includes(',')
    ? limpio.replace(/\./g, '').replace(',', '.')
    : limpio;
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function CamposInversion({
  prefijo,
  coste,
  cuenta,
  obligatorio,
  onCoste,
  onCuenta,
}: {
  prefijo: string;
  coste: string;
  cuenta: string;
  obligatorio: boolean;
  onCoste: (v: string) => void;
  onCuenta: (v: string) => void;
}) {
  return (
    <>
      <div>
        <label className={labelCls} htmlFor={`${prefijo}-coste`}>
          Coste de la inversión{obligatorio ? ' *' : ''}
        </label>
        <input
          id={`${prefijo}-coste`}
          className={fieldCls}
          inputMode="decimal"
          value={coste}
          required={obligatorio}
          placeholder="Sin eliminación inversión–PN"
          onChange={(ev) => onCoste(ev.target.value)}
        />
      </div>
      <div>
        <label className={labelCls} htmlFor={`${prefijo}-cuenta`}>
          Cuenta de la participación
        </label>
        <input
          id={`${prefijo}-cuenta`}
          className={fieldCls}
          value={cuenta}
          pattern="2[0-9]{3,9}"
          title="Cuenta PGC del grupo 2 (p. ej. 2403 grupo, 2404 asociadas)"
          onChange={(ev) => onCuenta(ev.target.value)}
        />
      </div>
      <p className="text-xs text-gray-500 sm:col-span-2">
        Con coste, el consolidado elimina la inversión contra el patrimonio neto
        a la toma de control (tomado del mayor) y calcula socios externos y
        fondo de comercio o diferencia negativa.
      </p>
    </>
  );
}

function EditarMiembroModal({
  grupoId,
  miembro,
  onClose,
}: {
  grupoId: string;
  miembro: MiembroGrupoDto | null;
  onClose: () => void;
}) {
  const [pct, setPct] = useState('');
  const [baja, setBaja] = useState('');
  const [metodo, setMetodo] = useState<MetodoConsolidacion | ''>('');
  const [control, setControl] = useState('');
  const [coste, setCoste] = useState('');
  const [cuenta, setCuenta] = useState('');
  const [pnAdq, setPnAdq] = useState('');
  const toast = useToast();
  const { can } = usePermisos();
  const m = miembro;
  const limpiar = () => {
    setPct('');
    setBaja('');
    setMetodo('');
    setControl('');
    setCoste('');
    setCuenta('');
    setPnAdq('');
  };
  const op = useEnvio(
    () => {
      const nCoste = aNumero(coste);
      const nPn = aNumero(pnAdq);
      return holdingApi.actualizarMiembro(
        grupoId,
        m!.id,
        {
          ...(pct.trim() && {
            participacionPct: Number(pct.replace(',', '.')),
          }),
          ...(baja && { fechaBaja: baja }),
          ...(metodo && { metodo }),
          ...(control && { fechaAdquisicion: control }),
          ...(nCoste !== null && { costeInversion: nCoste }),
          ...(cuenta.trim() && { cuentaInversion: cuenta.trim() }),
          ...(nPn !== null && { patrimonioAdquisicion: nPn }),
        },
        m!.version,
      );
    },
    () => {
      toast('Sociedad actualizada');
      limpiar();
      onClose();
    },
  );
  return (
    <Modal
      open={m !== null}
      title={m ? `Editar ${m.nombre}` : ''}
      onClose={onClose}
    >
      {m && (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (can('editar', 'contabilidad')) op.enviar();
          }}
        >
          <div>
            <label className={labelCls} htmlFor="ed-pct">
              Participación % (ahora {m.participacionPct})
            </label>
            <input
              id="ed-pct"
              className={fieldCls}
              inputMode="decimal"
              value={pct}
              onChange={(ev) => setPct(ev.target.value)}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="ed-baja">
              Fecha de baja
            </label>
            <input
              id="ed-baja"
              type="date"
              className={fieldCls}
              value={baja}
              onChange={(ev) => setBaja(ev.target.value)}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="ed-met">
              Método (ahora {METODO_CONSOLIDACION_LABELS[m.metodo]})
            </label>
            <select
              id="ed-met"
              className={fieldCls}
              value={metodo}
              onChange={(ev) =>
                setMetodo(ev.target.value as MetodoConsolidacion | '')
              }
            >
              <option value="">Sin cambios</option>
              {METODOS_CONSOLIDACION.map((x) => (
                <option key={x} value={x}>
                  {METODO_CONSOLIDACION_LABELS[x]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="ed-control">
              Toma de control
              {m.fechaAdquisicion
                ? ` (ahora ${formatDate(m.fechaAdquisicion)})`
                : ''}
            </label>
            <input
              id="ed-control"
              type="date"
              className={fieldCls}
              value={control}
              onChange={(ev) => setControl(ev.target.value)}
            />
          </div>
          <CamposInversion
            prefijo="ed"
            coste={coste}
            cuenta={cuenta}
            obligatorio={false}
            onCoste={setCoste}
            onCuenta={setCuenta}
          />
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="ed-pn">
              PN a la toma de control ({m.monedaFuncional}, vacío = del mayor
              {m.patrimonioAdquisicion !== null
                ? `; ahora ${m.patrimonioAdquisicion}`
                : ''}
              )
            </label>
            <input
              id="ed-pn"
              className={fieldCls}
              inputMode="decimal"
              value={pnAdq}
              onChange={(ev) => setPnAdq(ev.target.value)}
            />
          </div>
          {m.costeInversion !== null && (
            <p className="text-xs text-gray-500 sm:col-span-2">
              Coste actual {formatEur(m.costeInversion)} en {m.cuentaInversion}.
            </p>
          )}
          <Pie pendiente={op.pendiente} onClose={onClose} texto="Guardar" />
        </form>
      )}
    </Modal>
  );
}

/* ─────────────────────────── Group Reporting ─────────────────────────── */

function GroupReporting({ e }: { e: EstadosConsolidadosDto }) {
  const conversion = e.conversion ?? [];
  const inversiones = e.inversionPatrimonio ?? [];
  if (conversion.length === 0 && inversiones.length === 0) return null;
  return (
    <section className="mt-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Fondo de comercio de consolidación">
          {formatEur(e.fondoComercio ?? 0)}
        </Kpi>
        <Kpi titulo="Diferencia negativa">
          {formatEur(e.diferenciaNegativa ?? 0)}
        </Kpi>
        <Kpi titulo="Socios externos (patrimonio)">
          {formatEur(e.sociosExternos.patrimonio)}
        </Kpi>
        <Kpi
          titulo={`Diferencias de conversión (${e.monedaPresentacion ?? 'EUR'})`}
          alerta={(e.diferenciaConversion ?? 0) < 0}
        >
          {formatEur(e.diferenciaConversion ?? 0)}
        </Kpi>
      </div>

      {conversion.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <p className="px-3 pt-3 text-xs font-semibold uppercase text-gray-500">
            Conversión de moneda extranjera
          </p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">Sociedad</th>
                <th className="px-3 py-2 text-right">Cierre</th>
                <th className="px-3 py-2 text-right">Medio</th>
                <th className="px-3 py-2 text-right">Histórico</th>
                <th className="px-3 py-2 text-right">Activo</th>
                <th className="px-3 py-2 text-right">Resultado</th>
                <th className="px-3 py-2 text-right">CTA</th>
              </tr>
            </thead>
            <tbody>
              {conversion.map((c) => {
                const masa = (k: string) => c.porMasa.find((x) => x.masa === k);
                const ing = masa('ingreso');
                const gas = masa('gasto');
                return (
                  <tr key={c.companyId} className="border-t border-gray-100">
                    <td className="px-3 py-2">
                      {c.nombre}{' '}
                      <span className="text-xs text-gray-500">
                        {c.monedaFuncional}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {c.tasas.cierre}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {c.tasas.medio}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {c.tasas.historico}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {masa('activo')?.original ?? 0} →{' '}
                      {formatEur(masa('activo')?.convertido ?? 0)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatEur(
                        (ing?.convertido ?? 0) - (gas?.convertido ?? 0),
                      )}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-semibold tabular-nums ${c.diferenciaConversion < 0 ? 'text-red-700' : ''}`}
                    >
                      {formatEur(c.diferenciaConversion)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {inversiones.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <p className="px-3 pt-3 text-xs font-semibold uppercase text-gray-500">
            Eliminación inversión–patrimonio neto
          </p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">Sociedad</th>
                <th className="px-3 py-2 text-right">Coste</th>
                <th className="px-3 py-2 text-right">PN a la toma</th>
                <th className="px-3 py-2 text-right">Parte dominante</th>
                <th className="px-3 py-2 text-right">Fondo de comercio</th>
                <th className="px-3 py-2 text-right">Dif. negativa</th>
                <th className="px-3 py-2 text-right">Socios externos</th>
                <th className="px-3 py-2 text-right">Puesta en equiv.</th>
              </tr>
            </thead>
            <tbody>
              {inversiones.map((i) => (
                <tr key={i.companyId} className="border-t border-gray-100">
                  <td className="px-3 py-2">
                    {i.nombre}
                    <span className="block text-xs text-gray-500">
                      {METODO_CONSOLIDACION_LABELS[i.metodo]} ·{' '}
                      {i.participacionPct} % · {i.cuentaInversion} · control{' '}
                      {formatDate(i.fechaAdquisicion)}
                      {i.patrimonioDelMayor ? ' · PN del mayor' : ''}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(i.costeInversion)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(i.patrimonioAdquisicion)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(i.participacionAdquirida)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(i.fondoComercio)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(i.diferenciaNegativa)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(
                      i.sociosExternosAdquisicion + i.sociosExternosPosteriores,
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {i.valorPuestaEquivalencia === null
                      ? '—'
                      : formatEur(i.valorPuestaEquivalencia)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <details className="border-t px-3 py-2 text-xs text-gray-600">
            <summary className="cursor-pointer font-medium">
              Asientos de consolidación generados
            </summary>
            {inversiones.flatMap((i) =>
              i.ajustes.map((a, n) => (
                <div key={`${i.companyId}-${n}`} className="mt-2">
                  <p className="font-medium">{a.concepto}</p>
                  {a.lineas.map((l, k) => (
                    <p key={k} className="flex justify-between tabular-nums">
                      <span>{l.cuenta}</span>
                      <span>
                        {l.debe ? `D ${formatEur(l.debe)}` : ''}
                        {l.haber ? `H ${formatEur(l.haber)}` : ''}
                      </span>
                    </p>
                  ))}
                </div>
              )),
            )}
          </details>
        </div>
      )}
    </section>
  );
}

function TiposCambio({
  grupo,
  tipos,
  monedasExtranjeras,
  gestiona,
  onNuevo,
  onEditar,
}: {
  grupo: GrupoDto;
  tipos: TipoCambioDto[];
  monedasExtranjeras: string[];
  gestiona: boolean;
  onNuevo: () => void;
  onEditar: (t: TipoCambioDto) => void;
}) {
  if (monedasExtranjeras.length === 0 && tipos.length === 0) return null;
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          Tipos de cambio de consolidación (1 unidad = x {grupo.monedaBase})
        </h2>
        {gestiona && (
          <button type="button" className={btnGhostCls} onClick={onNuevo}>
            Nuevo tipo de cambio
          </button>
        )}
      </div>
      {tipos.length === 0 ? (
        <p className="rounded-xl border bg-white p-3 text-sm text-gray-500">
          Hay sociedades en {monedasExtranjeras.join(', ')}: registra sus tipos
          de cierre, medio e histórico para poder consolidar.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border bg-white text-sm shadow-sm">
          {tipos.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <span>
                <span className="font-medium">{t.moneda}</span> ·{' '}
                {TIPO_CAMBIO_LABELS[t.tipo]} · {formatDate(t.desde)}
                {t.hasta !== t.desde && ` – ${formatDate(t.hasta)}`}
              </span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums">{t.tasa}</span>
                {gestiona && (
                  <button
                    type="button"
                    className="text-xs text-gray-600 hover:underline"
                    onClick={() => onEditar(t)}
                  >
                    Editar
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TipoCambioModal({
  grupo,
  monedasExtranjeras,
  open,
  onClose,
}: {
  grupo: GrupoDto;
  monedasExtranjeras: string[];
  open: boolean;
  onClose: () => void;
}) {
  const { desde, hasta } = anioActual();
  const [f, setF] = useState({
    moneda: '',
    tipo: 'cierre' as TipoCambioConsolidacion,
    desde: hasta,
    hasta,
    tasa: '',
  });
  const toast = useToast();
  const { can } = usePermisos();
  const moneda = (f.moneda || monedasExtranjeras[0] || '').toUpperCase();
  const op = useEnvio(
    (clave) =>
      holdingApi.crearTipoCambio(
        grupo.id,
        {
          moneda,
          tipo: f.tipo,
          desde: f.desde,
          ...(f.tipo === 'medio' && { hasta: f.hasta }),
          tasa: aNumero(f.tasa) ?? 0,
        },
        clave,
      ),
    () => {
      toast('Tipo de cambio registrado');
      setF({ ...f, tasa: '' });
      onClose();
    },
  );
  return (
    <Modal open={open} title="Nuevo tipo de cambio" onClose={onClose}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (can('editar', 'contabilidad')) op.enviar();
        }}
      >
        <div>
          <label className={labelCls} htmlFor="tc-mon">
            Moneda funcional
          </label>
          <input
            id="tc-mon"
            className={fieldCls}
            value={moneda}
            maxLength={3}
            required
            list="tc-monedas"
            onChange={(ev) => setF({ ...f, moneda: ev.target.value })}
          />
          <datalist id="tc-monedas">
            {monedasExtranjeras.map((mo) => (
              <option key={mo} value={mo} />
            ))}
          </datalist>
        </div>
        <div>
          <label className={labelCls} htmlFor="tc-tipo">
            Tipo
          </label>
          <select
            id="tc-tipo"
            className={fieldCls}
            value={f.tipo}
            onChange={(ev) => {
              const tipo = ev.target.value as TipoCambioConsolidacion;
              setF({
                ...f,
                tipo,
                desde: tipo === 'medio' ? desde : hasta,
                hasta,
              });
            }}
          >
            {TIPOS_CAMBIO_CONSOLIDACION.map((x) => (
              <option key={x} value={x}>
                {TIPO_CAMBIO_LABELS[x]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="tc-desde">
            {f.tipo === 'medio' ? 'Desde' : 'Fecha'}
          </label>
          <input
            id="tc-desde"
            type="date"
            className={fieldCls}
            value={f.desde}
            required
            onChange={(ev) => setF({ ...f, desde: ev.target.value })}
          />
        </div>
        {f.tipo === 'medio' && (
          <div>
            <label className={labelCls} htmlFor="tc-hasta">
              Hasta
            </label>
            <input
              id="tc-hasta"
              type="date"
              className={fieldCls}
              value={f.hasta}
              required
              onChange={(ev) => setF({ ...f, hasta: ev.target.value })}
            />
          </div>
        )}
        <div>
          <label className={labelCls} htmlFor="tc-tasa">
            1 {moneda || '…'} = x {grupo.monedaBase} (hasta 8 decimales)
          </label>
          <input
            id="tc-tasa"
            className={fieldCls}
            inputMode="decimal"
            value={f.tasa}
            required
            onChange={(ev) => setF({ ...f, tasa: ev.target.value })}
          />
        </div>
        <Pie pendiente={op.pendiente} onClose={onClose} texto="Registrar" />
      </form>
    </Modal>
  );
}

function EditarTasaModal({
  grupoId,
  tipo,
  onClose,
}: {
  grupoId: string;
  tipo: TipoCambioDto | null;
  onClose: () => void;
}) {
  const [tasa, setTasa] = useState('');
  const toast = useToast();
  const { can } = usePermisos();
  const op = useEnvio(
    () =>
      holdingApi.actualizarTipoCambio(
        grupoId,
        tipo!.id,
        aNumero(tasa) ?? 0,
        tipo!.version,
      ),
    () => {
      toast('Tipo de cambio actualizado');
      setTasa('');
      onClose();
    },
  );
  return (
    <Modal
      open={tipo !== null}
      title={
        tipo ? `Tipo ${tipo.moneda} · ${TIPO_CAMBIO_LABELS[tipo.tipo]}` : ''
      }
      onClose={onClose}
    >
      {tipo && (
        <form
          className="grid gap-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (can('editar', 'contabilidad')) op.enviar();
          }}
        >
          <div>
            <label className={labelCls} htmlFor="et-tasa">
              Nuevo tipo (ahora {tipo.tasa})
            </label>
            <input
              id="et-tasa"
              className={fieldCls}
              inputMode="decimal"
              value={tasa}
              required
              onChange={(ev) => setTasa(ev.target.value)}
            />
          </div>
          <p className="text-xs text-gray-500">
            Un tipo que afecta a un periodo cerrado no se puede cambiar.
          </p>
          <Pie pendiente={op.pendiente} onClose={onClose} texto="Guardar" />
        </form>
      )}
    </Modal>
  );
}

function AltaSociedadModal({
  grupo,
  open,
  onClose,
}: {
  grupo: GrupoDto | null;
  open: boolean;
  onClose: () => void;
}) {
  const inicial = {
    nombre: '',
    nif: '',
    moneda: 'EUR',
    conAdmin: false,
    email: '',
    fullName: '',
    password: '',
    vincular: true,
    pct: '100',
    metodo: 'global' as MetodoConsolidacion,
    fechaAlta: anioActual().desde,
    coste: '',
    cuenta: '2403',
  };
  const [f, setF] = useState(inicial);
  const toast = useToast();
  const { can } = usePermisos();
  const coste = aNumero(f.coste);
  const op = useEnvio(
    (clave) =>
      holdingApi.crearSociedad(
        {
          nombre: f.nombre.trim(),
          nif: f.nif.trim(),
          monedaFuncional: f.moneda.trim().toUpperCase(),
          ...(f.conAdmin && {
            administrador: {
              email: f.email.trim(),
              fullName: f.fullName.trim(),
              password: f.password,
            },
          }),
          ...(grupo &&
            f.vincular && {
              grupo: {
                grupoId: grupo.id,
                participacionPct: Number(f.pct.replace(',', '.')),
                metodo: f.metodo,
                fechaAlta: f.fechaAlta,
                ...(coste !== null && {
                  costeInversion: coste,
                  cuentaInversion: f.cuenta.trim() || '2403',
                }),
              },
            }),
        },
        clave,
      ),
    (s) => {
      toast(`Sociedad «${s.nombre}» dada de alta`);
      setF(inicial);
      onClose();
    },
  );
  return (
    <Modal open={open} title="Alta de sociedad del grupo" onClose={onClose}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (can('crear', 'contabilidad')) op.enviar();
        }}
      >
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="as-nombre">
            Razón social
          </label>
          <input
            id="as-nombre"
            className={fieldCls}
            value={f.nombre}
            minLength={2}
            maxLength={160}
            required
            onChange={(ev) => setF({ ...f, nombre: ev.target.value })}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="as-nif">
            NIF / identificador fiscal
          </label>
          <input
            id="as-nif"
            className={fieldCls}
            value={f.nif}
            minLength={4}
            maxLength={20}
            required
            onChange={(ev) => setF({ ...f, nif: ev.target.value })}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="as-moneda">
            Moneda funcional (ISO 4217)
          </label>
          <input
            id="as-moneda"
            className={fieldCls}
            value={f.moneda}
            maxLength={3}
            pattern="[A-Za-z]{3}"
            required
            onChange={(ev) => setF({ ...f, moneda: ev.target.value })}
          />
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={f.conAdmin}
            onChange={(ev) => setF({ ...f, conAdmin: ev.target.checked })}
          />
          Crear su primer administrador
        </label>
        {f.conAdmin && (
          <>
            <div>
              <label className={labelCls} htmlFor="as-email">
                Email
              </label>
              <input
                id="as-email"
                type="email"
                className={fieldCls}
                value={f.email}
                required
                onChange={(ev) => setF({ ...f, email: ev.target.value })}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="as-fn">
                Nombre
              </label>
              <input
                id="as-fn"
                className={fieldCls}
                value={f.fullName}
                required
                onChange={(ev) => setF({ ...f, fullName: ev.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="as-pw">
                Contraseña inicial
              </label>
              <input
                id="as-pw"
                type="password"
                autoComplete="new-password"
                className={fieldCls}
                value={f.password}
                minLength={8}
                required
                onChange={(ev) => setF({ ...f, password: ev.target.value })}
              />
            </div>
          </>
        )}
        {grupo && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={f.vincular}
              onChange={(ev) => setF({ ...f, vincular: ev.target.checked })}
            />
            Integrarla en «{grupo.nombre}»
          </label>
        )}
        {grupo && f.vincular && (
          <>
            <div>
              <label className={labelCls} htmlFor="as-pct">
                Participación %
              </label>
              <input
                id="as-pct"
                className={fieldCls}
                inputMode="decimal"
                value={f.pct}
                required
                onChange={(ev) => setF({ ...f, pct: ev.target.value })}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="as-met">
                Método
              </label>
              <select
                id="as-met"
                className={fieldCls}
                value={f.metodo}
                onChange={(ev) =>
                  setF({ ...f, metodo: ev.target.value as MetodoConsolidacion })
                }
              >
                {METODOS_CONSOLIDACION.map((x) => (
                  <option key={x} value={x}>
                    {METODO_CONSOLIDACION_LABELS[x]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="as-alta">
                Fecha de alta / toma de control
              </label>
              <input
                id="as-alta"
                type="date"
                className={fieldCls}
                value={f.fechaAlta}
                required
                onChange={(ev) => setF({ ...f, fechaAlta: ev.target.value })}
              />
            </div>
            <div />
            <CamposInversion
              prefijo="as"
              coste={f.coste}
              cuenta={f.cuenta}
              obligatorio={f.metodo === 'puesta_equivalencia'}
              onCoste={(v) => setF({ ...f, coste: v })}
              onCuenta={(v) => setF({ ...f, cuenta: v })}
            />
          </>
        )}
        <p className="text-xs text-gray-500 sm:col-span-2">
          Nace con el plan contable base y con permiso de consolidación para ti.
        </p>
        <Pie pendiente={op.pendiente} onClose={onClose} texto="Dar de alta" />
      </form>
    </Modal>
  );
}

function AjusteModal({
  grupoId,
  open,
  onClose,
}: {
  grupoId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [f, setF] = useState({
    fecha: anioActual().hasta,
    concepto: '',
    cuentaDebe: '',
    cuentaHaber: '',
    importe: '',
  });
  const toast = useToast();
  const { can } = usePermisos();
  const op = useEnvio(
    (clave) =>
      holdingApi.crearAjuste(
        grupoId,
        {
          fecha: f.fecha,
          concepto: f.concepto.trim(),
          cuentaDebe: f.cuentaDebe.trim(),
          cuentaHaber: f.cuentaHaber.trim(),
          importe: Number(f.importe.replace(',', '.')),
        },
        clave,
      ),
    () => {
      toast('Ajuste registrado');
      setF({ ...f, concepto: '', importe: '' });
      onClose();
    },
  );
  const campo = (k: keyof typeof f) => (ev: { target: { value: string } }) =>
    setF({ ...f, [k]: ev.target.value });
  return (
    <Modal open={open} title="Nuevo ajuste de consolidación" onClose={onClose}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (can('editar', 'contabilidad')) op.enviar();
        }}
      >
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="aj-concepto">
            Concepto
          </label>
          <input
            id="aj-concepto"
            className={fieldCls}
            value={f.concepto}
            minLength={3}
            maxLength={240}
            required
            onChange={campo('concepto')}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="aj-debe">
            Cuenta al debe
          </label>
          <input
            id="aj-debe"
            className={fieldCls}
            value={f.cuentaDebe}
            pattern="[1-7][0-9]{2,9}"
            required
            onChange={campo('cuentaDebe')}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="aj-haber">
            Cuenta al haber
          </label>
          <input
            id="aj-haber"
            className={fieldCls}
            value={f.cuentaHaber}
            pattern="[1-7][0-9]{2,9}"
            required
            onChange={campo('cuentaHaber')}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="aj-importe">
            Importe
          </label>
          <input
            id="aj-importe"
            className={fieldCls}
            inputMode="decimal"
            value={f.importe}
            required
            onChange={campo('importe')}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="aj-fecha">
            Fecha
          </label>
          <input
            id="aj-fecha"
            type="date"
            className={fieldCls}
            value={f.fecha}
            required
            onChange={campo('fecha')}
          />
        </div>
        <Pie pendiente={op.pendiente} onClose={onClose} texto="Registrar" />
      </form>
    </Modal>
  );
}

function CierreModal({
  grupoId,
  periodo,
  descuadre,
  open,
  onClose,
}: {
  grupoId: string;
  periodo: { desde: string; hasta: string };
  descuadre: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const [forzar, setForzar] = useState(false);
  const toast = useToast();
  const { can } = usePermisos();
  const op = useEnvio(
    (clave) => holdingApi.cerrar(grupoId, { ...periodo, forzar }, clave),
    () => {
      toast('Periodo de consolidación cerrado');
      setForzar(false);
      onClose();
    },
  );
  return (
    <Modal
      open={open}
      title="Cerrar periodo de consolidación"
      onClose={onClose}
    >
      <form
        className="grid gap-3"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (can('cambiarEstado', 'contabilidad')) op.enviar();
        }}
      >
        <p className="text-sm text-gray-600">
          Se congelará el consolidado del {formatDate(periodo.desde)} al{' '}
          {formatDate(periodo.hasta)} y no se admitirán ajustes con fecha dentro
          del periodo.
        </p>
        {descuadre && (
          <label className="flex items-center gap-2 text-sm text-red-700">
            <input
              type="checkbox"
              checked={forzar}
              onChange={(ev) => setForzar(ev.target.checked)}
            />
            Hay descuadres intercompañía: cerrar igualmente (quedará auditado)
          </label>
        )}
        <Pie
          pendiente={op.pendiente}
          onClose={onClose}
          texto="Cerrar periodo"
        />
      </form>
    </Modal>
  );
}

function PermisosModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const toast = useToast();
  const { can } = usePermisos();
  const refrescar = useRefrescar();
  const avisarError = useAvisarError();
  const permisos = useQuery({
    queryKey: ['holding', 'permisos'],
    queryFn: holdingApi.permisos,
    enabled: open,
  });
  const op = useEnvio(
    (clave) => holdingApi.conceder(email.trim(), clave),
    () => {
      toast('Permiso concedido');
      setEmail('');
    },
  );
  const revocar = useMutation({
    mutationFn: (id: string) => holdingApi.revocar(id),
    onSuccess: () => {
      toast('Permiso revocado');
      refrescar();
    },
    onError: (err) => avisarError(err, refrescar),
  });
  return (
    <Modal
      open={open}
      wide
      title="Permisos de consolidación de mi sociedad"
      onClose={onClose}
    >
      <p className="mb-3 text-sm text-gray-600">
        Usuarios de otras sociedades autorizados a leer los estados financieros
        de la tuya para consolidarlos en su grupo. Revocar corta el acceso al
        instante.
      </p>
      <form
        className="mb-4 flex gap-2"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (can('editar', 'contabilidad')) op.enviar();
        }}
      >
        <input
          className={`${fieldCls} flex-1`}
          type="email"
          placeholder="email del usuario de la otra sociedad"
          value={email}
          required
          onChange={(ev) => setEmail(ev.target.value)}
        />
        <button type="submit" className={btnPrimaryCls} disabled={op.pendiente}>
          Conceder
        </button>
      </form>
      {permisos.isError && (
        <ErrorBanner message={(permisos.error as Error).message} />
      )}
      <ul className="divide-y rounded-lg border text-sm">
        {(permisos.data ?? []).map((p) => (
          <li
            key={p.id}
            className="flex items-center justify-between px-3 py-2"
          >
            <span>
              {p.nombreUsuario} · {p.email} · {p.sociedadUsuario}
              {p.revocadoEn && (
                <span className="ml-2 text-xs text-gray-500">revocado</span>
              )}
            </span>
            {!p.revocadoEn && (
              <button
                type="button"
                className="text-xs text-red-700 hover:underline"
                disabled={revocar.isPending}
                onClick={() => revocar.mutate(p.id)}
              >
                Revocar
              </button>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
