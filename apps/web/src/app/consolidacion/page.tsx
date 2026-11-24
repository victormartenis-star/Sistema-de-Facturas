'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import {
  METODOS_CONSOLIDACION,
  METODO_CONSOLIDACION_LABELS,
  type AjusteConsolidacionDto,
  type EstadosConsolidadosDto,
  type FilaConsolidacion,
  type GrupoDto,
  type MetodoConsolidacion,
  type MiembroGrupoDto,
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
    'grupo' | 'miembro' | 'ajuste' | 'cierre' | 'permisos' | null
  >(null);
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

  const e = estados.data;
  const t = tesoreria.data;

  return (
    <div>
      <PageHeader
        title="Consolidación de grupo"
        subtitle="Balance, cuenta de resultados y tesorería consolidados del holding, con eliminaciones intragrupo y socios externos."
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
                      </span>
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
        </>
      )}
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
  return (
    <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs text-gray-500">
          <tr>
            <th className="px-3 py-2" />
            {e.sociedades.map((s) => (
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
              {e.sociedades.map((s) => (
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
  });
  const toast = useToast();
  const { can } = usePermisos();
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
        <Pie pendiente={op.pendiente} onClose={onClose} texto="Integrar" />
      </form>
    </Modal>
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
  const toast = useToast();
  const { can } = usePermisos();
  const m = miembro;
  const op = useEnvio(
    () =>
      holdingApi.actualizarMiembro(
        grupoId,
        m!.id,
        {
          ...(pct.trim() && {
            participacionPct: Number(pct.replace(',', '.')),
          }),
          ...(baja && { fechaBaja: baja }),
        },
        m!.version,
      ),
    () => {
      toast('Sociedad actualizada');
      setPct('');
      setBaja('');
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
          <Pie pendiente={op.pendiente} onClose={onClose} texto="Guardar" />
        </form>
      )}
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
