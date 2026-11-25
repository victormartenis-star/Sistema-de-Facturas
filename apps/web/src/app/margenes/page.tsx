'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ESTADO_CONTROL_LABELS,
  MODOS_CONTROL_PRESUPUESTARIO,
  MODO_CONTROL_LABELS,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  type ControlPresupuestarioDto,
  type CuadroMargenesCalculo,
  type EstadoControlPresupuestario,
  type FilaMargenObraDto,
  type ModoControlPresupuestario,
} from '@erp/shared';
import {
  costControlApi,
  estimacionCierreApi,
  formatDate,
  formatEur,
} from '@/lib/api';
import { nuevoUuid } from '@/lib/api-error';
import { crearGuardaEnvio } from '@/lib/envio-unico';
import { usePermisos } from '@/lib/permisos';
import { Autorizado } from '@/components/autorizado';
import { IconAlertTriangle, IconTrendingUp } from '@/components/icons';
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

const COLOR_ESTADO: Record<EstadoControlPresupuestario, string> = {
  sin_presupuesto: 'bg-gray-100 text-gray-600',
  ok: 'bg-emerald-100 text-emerald-700',
  aviso: 'bg-amber-100 text-amber-800',
  excedido: 'bg-red-100 text-red-700',
};

function pct(n: number | null): string {
  return n === null
    ? '—'
    : `${n.toLocaleString('es-ES', { maximumFractionDigits: 2 })} %`;
}

function eurSigno(n: number | null): ReactNode {
  if (n === null) return '—';
  return (
    <span className={n < 0 ? 'text-red-700' : undefined}>{formatEur(n)}</span>
  );
}

function BadgeControl({
  estado,
  modo,
}: {
  estado: EstadoControlPresupuestario;
  modo?: ModoControlPresupuestario;
}) {
  return (
    <span
      className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${COLOR_ESTADO[estado]}`}
      title={modo ? MODO_CONTROL_LABELS[modo] : undefined}
    >
      {ESTADO_CONTROL_LABELS[estado]}
      {modo === 'bloqueo' && ' · bloqueo'}
    </span>
  );
}

/** Barra de consumo del presupuesto (real + comprometido). */
function BarraConsumo({ c }: { c: CuadroMargenesCalculo }) {
  if (c.presupuestado <= 0) return <span className="text-gray-400">—</span>;
  const real = Math.min(100, (c.costeReal / c.presupuestado) * 100);
  const comp = Math.min(100 - real, (c.comprometido / c.presupuestado) * 100);
  const excede = c.consumido > c.presupuestado;
  return (
    <div className="min-w-[110px]">
      <div className="flex h-2 overflow-hidden rounded bg-gray-100">
        <div
          className={excede ? 'bg-red-500' : 'bg-sky-600'}
          style={{ width: `${real}%` }}
        />
        <div
          className={excede ? 'bg-red-300' : 'bg-sky-300'}
          style={{ width: `${comp}%` }}
        />
      </div>
      <span
        className={`text-[11px] tabular-nums ${excede ? 'text-red-700' : 'text-gray-500'}`}
      >
        {pct(c.consumoPct)}
      </span>
    </div>
  );
}

export default function MargenesPage() {
  const [estado, setEstado] = useState('');
  const [q, setQ] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [soloAlertas, setSoloAlertas] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(null);

  const cuadro = useQuery({
    queryKey: ['margenes', estado, q, desde, hasta, soloAlertas],
    queryFn: () =>
      costControlApi.cuadro({
        estado: estado || undefined,
        q: q || undefined,
        desde: desde || undefined,
        hasta: hasta || undefined,
        soloAlertas,
      }),
  });
  const d = cuadro.data;
  const t = d?.totales;

  return (
    <div>
      <PageHeader
        title="Márgenes y control presupuestario"
        subtitle="Presupuestado frente a comprometido y coste real (compras, partes, almacén y amortización), con certificado, facturado, cobrado y márgenes por obra."
        count={d?.obras.length}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          className={inputCls}
          placeholder="Buscar obra"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className={selectCls}
          value={estado}
          onChange={(e) => setEstado(e.target.value)}
          aria-label="Estado de la obra"
        >
          <option value="">Todos los estados</option>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PROJECT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-gray-600">
          Desde
          <input
            type="date"
            className={inputCls}
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-gray-600">
          Hasta
          <input
            type="date"
            className={inputCls}
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={soloAlertas}
            onChange={(e) => setSoloAlertas(e.target.checked)}
          />
          Solo con alerta
        </label>
      </div>
      {(desde || hasta) && (
        <p className="mb-3 text-xs text-gray-500">
          Con fechas, el coste real, certificado, facturado y cobrado son los
          del período; presupuesto y comprometido, la foto a hoy.
        </p>
      )}

      {cuadro.isError && (
        <ErrorBanner message={(cuadro.error as Error).message} />
      )}

      {t && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi titulo="Presupuestado">{formatEur(t.presupuestado)}</Kpi>
          <Kpi titulo="Comprometido + coste real">
            {formatEur(t.consumido)}
            <span className="ml-2 text-sm font-normal text-gray-500">
              {pct(t.consumoPct)}
            </span>
          </Kpi>
          <Kpi titulo="Desviación" alerta={t.desviacion < 0}>
            {formatEur(t.desviacion)}
          </Kpi>
          <Kpi titulo="Margen real (certificado − coste)">
            {formatEur(t.margenReal)}
            <span className="ml-2 text-sm font-normal text-gray-500">
              {pct(t.margenRealPct)}
            </span>
          </Kpi>
        </div>
      )}

      {cuadro.isLoading && <TableSkeleton />}
      {d && d.obras.length === 0 && (
        <EmptyState icon={<IconTrendingUp />} title="Sin obras">
          No hay obras que cumplan los filtros.
        </EmptyState>
      )}
      {d && d.obras.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">Obra</th>
                <th className="px-3 py-2 text-right">Presupuestado</th>
                <th className="px-3 py-2 text-right">Comprometido</th>
                <th className="px-3 py-2 text-right">Coste real</th>
                <th className="px-3 py-2">Consumo</th>
                <th className="px-3 py-2 text-right">Desviación</th>
                <th className="px-3 py-2 text-right">Certificado</th>
                <th className="px-3 py-2 text-right">Facturado</th>
                <th className="px-3 py-2 text-right">Cobrado</th>
                <th className="px-3 py-2 text-right">Margen real</th>
                <th className="px-3 py-2">Control</th>
              </tr>
            </thead>
            <tbody>
              {d.obras.map((o: FilaMargenObraDto) => (
                <tr
                  key={o.projectId}
                  className="cursor-pointer border-t border-gray-100 hover:bg-amber-50/40"
                  onClick={() => setAbierta(o.projectId)}
                >
                  <td className="px-3 py-2">
                    <span className="font-medium">{o.codigo}</span>{' '}
                    <span className="text-gray-600">{o.nombre}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(o.presupuestado)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(o.comprometido)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(o.costeReal)}
                  </td>
                  <td className="px-3 py-2">
                    <BarraConsumo c={o} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {eurSigno(o.desviacion)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(o.certificado)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(o.facturado)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(o.cobrado)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {eurSigno(o.margenReal)}
                  </td>
                  <td className="px-3 py-2">
                    <BadgeControl
                      estado={o.control.estado}
                      modo={o.control.modo}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            {t && (
              <tfoot>
                <tr className="border-t bg-gray-50 font-semibold">
                  <td className="px-3 py-2">Total cartera</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(t.presupuestado)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(t.comprometido)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(t.costeReal)}
                  </td>
                  <td className="px-3 py-2">
                    <BarraConsumo c={t} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {eurSigno(t.desviacion)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(t.certificado)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(t.facturado)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(t.cobrado)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {eurSigno(t.margenReal)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      <DetalleObraModal
        projectId={abierta}
        desde={desde}
        hasta={hasta}
        onClose={() => setAbierta(null)}
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
      <p
        className={`mt-1 text-xl font-semibold tabular-nums ${alerta ? 'text-red-600' : 'text-gray-900'}`}
      >
        {children}
      </p>
    </div>
  );
}

function Linea({
  etiqueta,
  valor,
  fuerte = false,
}: {
  etiqueta: string;
  valor: ReactNode;
  fuerte?: boolean;
}) {
  return (
    <div
      className={`flex justify-between gap-4 py-0.5 text-sm ${fuerte ? 'font-semibold' : ''}`}
    >
      <span className="text-gray-600">{etiqueta}</span>
      <span className="tabular-nums">{valor}</span>
    </div>
  );
}

function DetalleObraModal({
  projectId,
  desde,
  hasta,
  onClose,
}: {
  projectId: string | null;
  desde: string;
  hasta: string;
  onClose: () => void;
}) {
  const detalle = useQuery({
    queryKey: ['margenes', 'obra', projectId, desde, hasta],
    queryFn: () =>
      costControlApi.margenesObra(projectId!, {
        desde: desde || undefined,
        hasta: hasta || undefined,
      }),
    enabled: projectId !== null,
  });
  const control = useQuery({
    queryKey: ['margenes', 'control', projectId],
    queryFn: () => costControlApi.control(projectId!),
    enabled: projectId !== null,
  });
  const d = detalle.data;
  const o = d?.obra;

  return (
    <Modal
      open={projectId !== null}
      wide
      title={o ? `${o.codigo} · ${o.nombre}` : 'Obra'}
      onClose={onClose}
    >
      {detalle.isError && (
        <ErrorBanner message={(detalle.error as Error).message} />
      )}
      {detalle.isLoading && <TableSkeleton rows={4} />}
      {o && d && (
        <div className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-3">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-gray-500">
                Coste real
              </p>
              <Linea
                etiqueta="Facturas de compra"
                valor={formatEur(o.costeRealDesglose.facturasCompra)}
              />
              <Linea
                etiqueta="Partes de personal"
                valor={formatEur(o.costeRealDesglose.partesPersonal)}
              />
              <Linea
                etiqueta="Partes de maquinaria"
                valor={formatEur(o.costeRealDesglose.partesMaquinaria)}
              />
              <Linea
                etiqueta="Almacén (neto)"
                valor={formatEur(o.costeRealDesglose.almacen)}
              />
              <Linea
                etiqueta="Amortización"
                valor={formatEur(o.costeRealDesglose.amortizacion)}
              />
              <Linea
                etiqueta="Avales (comisiones y ejecuciones)"
                valor={formatEur(o.costeRealDesglose.avales)}
              />
              <Linea etiqueta="Total" valor={formatEur(o.costeReal)} fuerte />
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-gray-500">
                Presupuesto
              </p>
              <Linea
                etiqueta="Presupuestado"
                valor={formatEur(o.presupuestado)}
              />
              <Linea
                etiqueta="Pedidos pendientes"
                valor={formatEur(o.comprometidoDesglose.pedidos)}
              />
              <Linea
                etiqueta="Subcontratas pendientes"
                valor={formatEur(o.comprometidoDesglose.subcontratas)}
              />
              <Linea
                etiqueta="Consumido"
                valor={`${formatEur(o.consumido)} · ${pct(o.consumoPct)}`}
              />
              <Linea
                etiqueta="Desviación"
                valor={eurSigno(o.desviacion)}
                fuerte
              />
              <Linea
                etiqueta="Coste estimado al cierre"
                valor={formatEur(o.costeEstimadoCierre)}
              />
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-gray-500">
                Venta y márgenes
              </p>
              <Linea etiqueta="Contrato" valor={eurSigno(o.contrato)} />
              <Linea etiqueta="Certificado" valor={formatEur(o.certificado)} />
              <Linea etiqueta="Facturado" valor={formatEur(o.facturado)} />
              <Linea etiqueta="Cobrado (base)" valor={formatEur(o.cobrado)} />
              <Linea
                etiqueta="Margen previsto"
                valor={
                  <>
                    {eurSigno(o.margenPrevisto)} · {pct(o.margenPrevistoPct)}
                  </>
                }
              />
              <Linea
                etiqueta="Margen proyectado"
                valor={
                  <>
                    {eurSigno(o.margenProyectado)} ·{' '}
                    {pct(o.margenProyectadoPct)}
                  </>
                }
              />
              <Linea
                etiqueta="Margen real"
                valor={
                  <>
                    {eurSigno(o.margenReal)} · {pct(o.margenRealPct)}
                  </>
                }
                fuerte
              />
            </div>
          </div>

          {d.capitulos.length > 0 && (
            <TablaDesglose
              titulo="Por capítulo"
              filas={d.capitulos.map((c) => ({
                clave: c.capitulo,
                etiqueta: `Capítulo ${c.capitulo}`,
                ...c,
                excedida: c.excedido,
              }))}
            />
          )}
          {d.partidas.length > 0 && (
            <TablaDesglose
              titulo="Por partida"
              filas={d.partidas.map((p) => ({
                clave: p.phaseId ?? 'sin',
                etiqueta: p.codigo ? `${p.codigo} ${p.nombre}` : p.nombre,
                ...p,
              }))}
            />
          )}

          <PanelEstimacionCierre projectId={o.projectId} />
          <PanelControl projectId={o.projectId} control={control.data} />
        </div>
      )}
    </Modal>
  );
}

/**
 * Estimación al cierre (EAC) editable por obra: la efectiva alimenta el
 * margen proyectado y la provisión por pérdidas. Cada cambio queda como
 * versión con motivo, fecha de efecto y usuario.
 */
function PanelEstimacionCierre({ projectId }: { projectId: string }) {
  const [coste, setCoste] = useState('');
  const [motivo, setMotivo] = useState('');
  const [fecha, setFecha] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const clave = useRef(nuevoUuid());
  const [guarda] = useState(crearGuardaEnvio);
  const { can } = usePermisos();
  const qc = useQueryClient();
  const toast = useToast();
  const avisarError = useAvisarError();
  const eac = useQuery({
    queryKey: ['estimacion-cierre', projectId],
    queryFn: () => estimacionCierreApi.obtener(projectId),
  });
  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: ['estimacion-cierre', projectId] });
    void qc.invalidateQueries({ queryKey: ['margenes'] });
  };
  const m = useMutation({
    mutationFn: (automatica: boolean) =>
      estimacionCierreApi.fijar(
        projectId,
        {
          costeEstimado: automatica
            ? null
            : Number(coste.trim().replace(',', '.')),
          motivo: motivo.trim(),
          fecha,
        },
        eac.data?.version ?? 0,
        clave.current,
      ),
    onSuccess: (r) => {
      clave.current = nuevoUuid();
      setCoste('');
      setMotivo('');
      toast(
        `Estimación al cierre: ${formatEur(r.costeEstimadoCierre)} (${r.origen === 'manual' ? 'manual' : 'automática'})`,
      );
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  useEffect(() => {
    if (!m.isPending) guarda.liberar();
  }, [m.isPending, guarda]);

  const e = eac.data;
  const puede = can('editar', 'estimacion_cierre');
  const enviar = (automatica: boolean) => {
    if (!can('editar', 'estimacion_cierre') || m.isPending) return;
    if (motivo.trim().length < 3) return;
    if (!automatica && !(Number(coste.replace(',', '.')) >= 0 && coste.trim()))
      return;
    if (!guarda.intentar()) return;
    m.mutate(automatica);
  };

  return (
    <div className="rounded-lg border p-3">
      <p className="mb-2 text-xs font-semibold uppercase text-gray-500">
        Estimación al cierre (EAC)
      </p>
      {eac.isError && <ErrorBanner message={(eac.error as Error).message} />}
      {e && (
        <>
          <div className="mb-3 grid gap-2 text-sm sm:grid-cols-4">
            <Linea
              etiqueta="Automática"
              valor={formatEur(e.costeEstimadoCierreAutomatico)}
            />
            <Linea
              etiqueta={`Efectiva (${e.origen === 'manual' ? 'manual' : 'automática'})`}
              valor={formatEur(e.costeEstimadoCierre)}
              fuerte
            />
            <Linea etiqueta="Coste real" valor={formatEur(e.costeReal)} />
            <Linea
              etiqueta="Margen proyectado"
              valor={
                e.margenProyectado === null
                  ? '—'
                  : formatEur(e.margenProyectado)
              }
            />
          </div>
          {e.ajustadaAlReal && (
            <p className="mb-2 text-xs text-amber-700">
              La estimación manual quedó por debajo del coste real y se eleva a
              él: revísala.
            </p>
          )}
          {puede && (
            <form
              className="grid gap-2 sm:grid-cols-4"
              onSubmit={(ev) => {
                ev.preventDefault();
                enviar(false);
              }}
            >
              <div>
                <label className={labelCls} htmlFor="eac-coste">
                  Nuevo coste al cierre (€)
                </label>
                <input
                  id="eac-coste"
                  inputMode="decimal"
                  className={fieldCls}
                  value={coste}
                  onChange={(ev) => setCoste(ev.target.value)}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="eac-fecha">
                  Fecha de efecto
                </label>
                <input
                  id="eac-fecha"
                  type="date"
                  className={fieldCls}
                  value={fecha}
                  onChange={(ev) => setFecha(ev.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls} htmlFor="eac-motivo">
                  Motivo
                </label>
                <input
                  id="eac-motivo"
                  className={fieldCls}
                  value={motivo}
                  onChange={(ev) => setMotivo(ev.target.value)}
                  minLength={3}
                  maxLength={240}
                  required
                />
              </div>
              <div className="flex justify-end gap-2 sm:col-span-4">
                {e.origen === 'manual' && (
                  <button
                    type="button"
                    className={btnGhostCls}
                    disabled={m.isPending || motivo.trim().length < 3}
                    onClick={() => enviar(true)}
                  >
                    Volver al cálculo automático
                  </button>
                )}
                <button
                  type="submit"
                  className={btnPrimaryCls}
                  disabled={
                    m.isPending || motivo.trim().length < 3 || !coste.trim()
                  }
                >
                  {m.isPending ? 'Guardando…' : 'Fijar estimación'}
                </button>
              </div>
            </form>
          )}
          {e.historial.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-gray-600">
              {e.historial.map((h) => (
                <li key={h.version}>
                  v{h.version} · {formatDate(h.fecha)} ·{' '}
                  {h.costeEstimado === null
                    ? 'automática'
                    : formatEur(h.costeEstimado)}{' '}
                  · {h.motivo}
                  {h.usuarioNombre && ` · ${h.usuarioNombre}`}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function TablaDesglose({
  titulo,
  filas,
}: {
  titulo: string;
  filas: {
    clave: string;
    etiqueta: string;
    presupuestado: number;
    comprometido: number;
    costeReal: number;
    desviacion: number;
    consumoPct: number | null;
    excedida: boolean;
  }[];
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase text-gray-500">
        {titulo}
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-3 py-1.5" />
              <th className="px-3 py-1.5 text-right">Presupuestado</th>
              <th className="px-3 py-1.5 text-right">Comprometido</th>
              <th className="px-3 py-1.5 text-right">Real</th>
              <th className="px-3 py-1.5 text-right">Consumo</th>
              <th className="px-3 py-1.5 text-right">Desviación</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.clave} className="border-t border-gray-100">
                <td className="px-3 py-1.5">
                  {f.etiqueta}
                  {f.excedida && (
                    <IconAlertTriangle
                      size={12}
                      className="ml-1 inline text-red-600"
                    />
                  )}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {formatEur(f.presupuestado)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {formatEur(f.comprometido)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {formatEur(f.costeReal)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {pct(f.consumoPct)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {eurSigno(f.desviacion)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PanelControl({
  projectId,
  control,
}: {
  projectId: string;
  control: ControlPresupuestarioDto | undefined;
}) {
  const [modo, setModo] = useState<ModoControlPresupuestario>('observacion');
  const [tolerancia, setTolerancia] = useState('0');
  const [umbral, setUmbral] = useState('90');
  const qc = useQueryClient();
  const toast = useToast();
  const avisarError = useAvisarError();
  const cfg = control?.config;
  useEffect(() => {
    if (!cfg) return;
    setModo(cfg.modo);
    setTolerancia(String(cfg.toleranciaPct));
    setUmbral(String(cfg.umbralAvisoPct));
  }, [cfg]);
  const refrescar = () => void qc.invalidateQueries({ queryKey: ['margenes'] });
  const guardar = useMutation({
    mutationFn: () =>
      costControlApi.configurarControl(
        projectId,
        {
          modo,
          toleranciaPct: Number(tolerancia.replace(',', '.')) || 0,
          umbralAvisoPct: Number(umbral.replace(',', '.')) || 90,
        },
        cfg?.version ?? 0,
      ),
    onSuccess: () => {
      toast('Control presupuestario actualizado');
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });

  if (!control) return null;
  const ev = control.evaluacion;
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="text-sm font-semibold">Control presupuestario</p>
        <BadgeControl estado={ev.estado} modo={control.config.modo} />
        <span className="text-xs text-gray-500">
          Límite {formatEur(ev.limite)} · disponible {eurSigno(ev.disponible)}
        </span>
      </div>
      <Autorizado
        accion="editar"
        recurso="contabilidad"
        alternativa={
          <p className="text-sm text-gray-600">
            {MODO_CONTROL_LABELS[control.config.modo]} · tolerancia{' '}
            {control.config.toleranciaPct} % · aviso al{' '}
            {control.config.umbralAvisoPct} %
          </p>
        }
      >
        <form
          className="grid gap-3 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!guardar.isPending) guardar.mutate();
          }}
        >
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="cp-modo">
              Modo
            </label>
            <select
              id="cp-modo"
              className={fieldCls}
              value={modo}
              onChange={(e) =>
                setModo(e.target.value as ModoControlPresupuestario)
              }
            >
              {MODOS_CONTROL_PRESUPUESTARIO.map((m) => (
                <option key={m} value={m}>
                  {MODO_CONTROL_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="cp-tol">
              Tolerancia %
            </label>
            <input
              id="cp-tol"
              className={fieldCls}
              inputMode="decimal"
              value={tolerancia}
              onChange={(e) => setTolerancia(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="cp-umbral">
              Aviso al %
            </label>
            <input
              id="cp-umbral"
              className={fieldCls}
              inputMode="decimal"
              value={umbral}
              onChange={(e) => setUmbral(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 sm:col-span-4">
            <button
              type="button"
              className={btnGhostCls}
              onClick={refrescar}
              disabled={guardar.isPending}
            >
              Recargar
            </button>
            <button
              type="submit"
              className={btnPrimaryCls}
              disabled={guardar.isPending}
            >
              {guardar.isPending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </Autorizado>
      {control.eventos.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold uppercase text-gray-500">
            Últimos eventos
          </p>
          <ul className="space-y-1 text-xs text-gray-600">
            {control.eventos.slice(0, 8).map((e, i) => (
              <li key={`${e.fecha}-${i}`}>
                {formatDate(e.fecha.slice(0, 10))} ·{' '}
                <span
                  className={
                    e.evento === 'bloqueo'
                      ? 'font-semibold text-red-700'
                      : e.evento === 'aviso'
                        ? 'font-semibold text-amber-700'
                        : ''
                  }
                >
                  {e.evento === 'configuracion'
                    ? 'Configuración'
                    : e.evento === 'bloqueo'
                      ? 'Bloqueado'
                      : 'Aviso'}
                </span>
                {e.operacion &&
                  ` · ${e.operacion === 'pedido_compra' ? 'pedido de compra' : 'consumo de almacén'}`}
                {e.exceso !== null && ` · exceso ${formatEur(e.exceso)}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
