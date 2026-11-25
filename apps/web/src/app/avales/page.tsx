'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  DIRECCIONES_AVAL,
  DIRECCION_AVAL_LABELS,
  ESTADOS_AVAL,
  ESTADO_AVAL_LABELS,
  LIQUIDACIONES_EJECUCION_AVAL,
  LIQUIDACION_EJECUCION_AVAL_LABELS,
  TIPOS_AVAL,
  TIPO_AVAL_LABELS,
  TIPO_MOVIMIENTO_AVAL_LABELS,
  type AvalDetalleDto,
  type AvalDto,
  type DireccionAval,
  type EstadoAval,
  type LineaAvalDto,
  type DevengoAvalDto,
  type LiquidacionEjecucionAval,
  type TipoAval,
} from '@erp/shared';
import { avalesApi, formatDate, formatEur, projectsApi } from '@/lib/api';
import { nuevoUuid } from '@/lib/api-error';
import { crearGuardaEnvio } from '@/lib/envio-unico';
import { usePermisos } from '@/lib/permisos';
import { Autorizado } from '@/components/autorizado';
import { IconShield } from '@/components/icons';
import { KpiCard } from '@/components/kpi-card';
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

const hoy = () => new Date().toISOString().slice(0, 10);
const importe = (s: string) => Number(s.trim().replace(',', '.'));
const importeOpcional = (s: string) => (s.trim() ? importe(s) : null);

const TONO_ESTADO: Record<EstadoAval, string> = {
  vigente: 'bg-emerald-50 text-emerald-700',
  liberado_parcial: 'bg-amber-50 text-amber-700',
  liberado: 'bg-gray-100 text-gray-600',
  ejecutado: 'bg-red-50 text-red-700',
  vencido: 'bg-gray-100 text-gray-500',
  anulado: 'bg-gray-100 text-gray-400 line-through',
};

/** Invalida avales, contabilidad y notificaciones tras una mutación. */
function useRefrescar() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['avales'] });
    void qc.invalidateQueries({ queryKey: ['aval'] });
    void qc.invalidateQueries({ queryKey: ['contabilidad'] });
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  };
}

function Vence({ a }: { a: AvalDto }) {
  if (!a.fechaVencimiento)
    return <span className="text-gray-400">Indefinido</span>;
  const d = a.diasHastaVencimiento ?? 0;
  const vivo = a.estado === 'vigente' || a.estado === 'liberado_parcial';
  const tono = !vivo
    ? ''
    : d < 0
      ? 'text-red-700'
      : d <= 30
        ? 'text-amber-600'
        : '';
  return (
    <span className={tono}>
      {formatDate(a.fechaVencimiento)}
      {vivo && (
        <span className="ml-1 text-xs">
          ({d < 0 ? `vencido hace ${-d} d` : `${d} d`})
        </span>
      )}
    </span>
  );
}

export default function AvalesPage() {
  const [direccion, setDireccion] = useState('');
  const [estado, setEstado] = useState('');
  const [vista, setVista] = useState<'vivos' | 'proximos' | 'todos'>('vivos');
  const [q, setQ] = useState('');
  const [nuevo, setNuevo] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const claveAvisos = useRef(nuevoUuid());
  const { can } = usePermisos();
  const toast = useToast();
  const avisarError = useAvisarError();
  const refrescar = useRefrescar();

  const resumen = useQuery({
    queryKey: ['avales', 'resumen'],
    queryFn: () => avalesApi.resumen(30),
  });
  const lista = useQuery({
    queryKey: ['avales', 'lista', direccion, estado, vista, q],
    queryFn: () =>
      avalesApi.listar({
        direccion: direccion || undefined,
        estado: estado || undefined,
        vivos: vista === 'vivos' && !estado ? 'true' : undefined,
        venceEnDias: vista === 'proximos' ? 30 : undefined,
        q: q || undefined,
      }),
  });
  const avisos = useMutation({
    mutationFn: () => avalesApi.avisos(30, claveAvisos.current),
    onSuccess: (r) => {
      claveAvisos.current = nuevoUuid();
      toast(
        `${r.avisados} avisos de vencimiento enviados (${r.revisados} avales revisados)`,
      );
      refrescar();
    },
    onError: (e) => avisarError(e),
  });

  const r = resumen.data;
  const filas = lista.data ?? [];

  return (
    <div>
      <PageHeader
        title="Avales y garantías"
        subtitle="Avales emitidos y recibidos por obra: exposición viva, vencimientos, liberaciones y ejecuciones contabilizadas."
        count={filas.length}
      >
        <Autorizado accion="cambiarEstado" recurso="aval">
          <button
            type="button"
            className={btnGhostCls}
            disabled={avisos.isPending}
            onClick={() => {
              if (!avisos.isPending && can('cambiarEstado', 'aval'))
                avisos.mutate();
            }}
          >
            {avisos.isPending ? 'Avisando…' : 'Avisar vencimientos (30 d)'}
          </button>
        </Autorizado>
        <Autorizado accion="crear" recurso="aval">
          <button
            type="button"
            className={btnPrimaryCls}
            onClick={() => setNuevo(true)}
          >
            Nuevo aval
          </button>
        </Autorizado>
      </PageHeader>

      {resumen.isError && (
        <ErrorBanner message={(resumen.error as Error).message} />
      )}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          etiqueta="Riesgo emitido vivo"
          valor={formatEur(r?.emitidos.saldoVivo ?? 0)}
          detalle={`${r?.emitidos.numero ?? 0} avales · nominal ${formatEur(r?.emitidos.nominal ?? 0)}`}
          cargando={resumen.isLoading}
        />
        <KpiCard
          etiqueta="Garantías recibidas vivas"
          valor={formatEur(r?.recibidos.saldoVivo ?? 0)}
          tono="bueno"
          detalle={`${r?.recibidos.numero ?? 0} avales de terceros`}
          cargando={resumen.isLoading}
        />
        <KpiCard
          etiqueta="Vencen en 30 días"
          valor={String(r?.proximosVencer ?? 0)}
          tono={(r?.proximosVencer ?? 0) > 0 ? 'aviso' : 'neutro'}
          detalle={`Saldo ${formatEur(r?.saldoProximosVencer ?? 0)} · ${r?.vencidosSinCerrar ?? 0} vencidos sin cerrar`}
          cargando={resumen.isLoading}
        />
        <KpiCard
          etiqueta="Comisiones acumuladas"
          valor={formatEur(r?.comisionesAcumuladas ?? 0)}
          detalle="Contabilizadas en 6260"
          cargando={resumen.isLoading}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          className={selectCls}
          value={vista}
          onChange={(e) => setVista(e.target.value as typeof vista)}
          aria-label="Vista"
        >
          <option value="vivos">Vivos</option>
          <option value="proximos">Vencen en 30 días</option>
          <option value="todos">Todos</option>
        </select>
        <select
          className={selectCls}
          value={direccion}
          onChange={(e) => setDireccion(e.target.value)}
          aria-label="Dirección"
        >
          <option value="">Emitidos y recibidos</option>
          {DIRECCIONES_AVAL.map((d) => (
            <option key={d} value={d}>
              {DIRECCION_AVAL_LABELS[d]}
            </option>
          ))}
        </select>
        <select
          className={selectCls}
          value={estado}
          onChange={(e) => setEstado(e.target.value)}
          aria-label="Estado"
        >
          <option value="">Cualquier estado</option>
          {ESTADOS_AVAL.map((s) => (
            <option key={s} value={s}>
              {ESTADO_AVAL_LABELS[s]}
            </option>
          ))}
        </select>
        <input
          className={inputCls}
          placeholder="Referencia o entidad"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {lista.isError && (
        <ErrorBanner message={(lista.error as Error).message} />
      )}
      {lista.isLoading && <TableSkeleton />}
      {lista.isSuccess && filas.length === 0 && (
        <EmptyState icon={<IconShield />} title="Sin avales">
          Registra los avales que emite tu banco a favor de clientes y los que
          te entregan subcontratas y proveedores para controlar su vencimiento.
        </EmptyState>
      )}
      {filas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">Referencia</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Obra</th>
                <th className="px-3 py-2">Beneficiario / avalado</th>
                <th className="px-3 py-2 text-right">Nominal</th>
                <th className="px-3 py-2 text-right">Saldo vivo</th>
                <th className="px-3 py-2">Vencimiento</th>
                <th className="px-3 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((a) => (
                <tr
                  key={a.id}
                  className="cursor-pointer border-t border-gray-100 hover:bg-amber-50/40"
                  onClick={() => setAbierto(a.id)}
                >
                  <td className="px-3 py-2">
                    <span className="font-medium">{a.referencia}</span>
                    <span className="block text-xs text-gray-500">
                      {a.entidad} ·{' '}
                      {a.direccion === 'emitido' ? 'Emitido' : 'Recibido'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    {TIPO_AVAL_LABELS[a.tipo]}
                  </td>
                  <td className="px-3 py-2">{a.projectCodigo ?? '—'}</td>
                  <td className="px-3 py-2">{a.contactNombre ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(a.nominal)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formatEur(a.saldoVivo)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    <Vence a={a} />
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${TONO_ESTADO[a.estado]}`}
                    >
                      {ESTADO_AVAL_LABELS[a.estado]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DevengosAval />
      <LineasAval />
      <NuevoAvalModal open={nuevo} onClose={() => setNuevo(false)} />
      <DetalleAvalModal id={abierto} onClose={() => setAbierto(null)} />
    </div>
  );
}

function mesAnterior(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

/**
 * Devengo mensual de comisiones de los avales emitidos con tasa (6260 obra a
 * 4100). Un devengo por aval y mes; la liquidación del banco salda después
 * lo devengado. Admin, gerente y administración.
 */
function DevengosAval() {
  const [periodo, setPeriodo] = useState(mesAnterior);
  const [anulando, setAnulando] = useState<DevengoAvalDto | null>(null);
  const [motivo, setMotivo] = useState('');
  const clave = useRef(nuevoUuid());
  const [guarda] = useState(crearGuardaEnvio);
  const { can } = usePermisos();
  const qc = useQueryClient();
  const toast = useToast();
  const avisarError = useAvisarError();
  const valido = /^\d{4}-\d{2}$/.test(periodo);
  const lista = useQuery({
    queryKey: ['avales', 'devengos', periodo],
    queryFn: () => avalesApi.devengos({ periodo }),
    enabled: valido,
  });
  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: ['avales'] });
    void qc.invalidateQueries({ queryKey: ['aval'] });
    void qc.invalidateQueries({ queryKey: ['contabilidad'] });
  };
  const devengar = useMutation({
    mutationFn: () => avalesApi.devengar(periodo, clave.current),
    onSuccess: (r) => {
      clave.current = nuevoUuid();
      toast(
        `${r.contabilizados} devengos contabilizados (${formatEur(r.importe)})` +
          (r.omitidos.length
            ? ` · ${r.omitidos.length} omitidos: ${r.omitidos[0].motivo}`
            : ''),
        r.omitidos.length ? 'error' : 'success',
      );
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const anular = useMutation({
    mutationFn: (d: DevengoAvalDto) =>
      avalesApi.anularDevengo(d.id, motivo.trim(), d.version, clave.current),
    onSuccess: (d) => {
      clave.current = nuevoUuid();
      setAnulando(null);
      setMotivo('');
      toast(`Devengo de ${d.referencia} (${d.periodo}) anulado`);
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const ejecuciones = useQuery({
    queryKey: ['avales', 'devengos', 'ejecuciones'],
    queryFn: () => avalesApi.ejecucionesDevengo(),
  });
  const lotes = useQuery({
    queryKey: ['avales', 'devengos', 'lotes'],
    queryFn: () => avalesApi.lotesDevengo(),
  });
  const automatico = useMutation({
    mutationFn: () => avalesApi.devengoAutomatico(undefined, clave.current),
    onSuccess: (r) => {
      clave.current = nuevoUuid();
      toast(
        `Devengo automático ${r.desde ?? '—'} a ${r.hasta}: ${r.contabilizados} devengos (${formatEur(r.importe)})` +
          (r.alertas ? ` · ${r.alertas} aviso(s) que requieren acción` : ''),
        r.alertas ? 'error' : 'success',
      );
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const ocupado =
    devengar.isPending || anular.isPending || automatico.isPending;
  useEffect(() => {
    if (!ocupado) guarda.liberar();
  }, [ocupado, guarda]);
  const filas = lista.data ?? [];
  const ultima = ejecuciones.data?.[0];
  const lote = lotes.data?.[0];
  const alertasLote = lote?.avisos.filter((a) => a.nivel === 'alerta') ?? [];
  const infoLote = lote?.avisos.filter((a) => a.nivel === 'info') ?? [];

  return (
    <section className="mt-8">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Devengo de comisiones</h2>
          <p className="text-xs text-gray-500">
            Σ saldo vivo de cada tramo × tasa anual × días / 365 (los cambios de
            saldo dentro del mes abren tramos), contabilizado 6260 (obra) a
            4100. La liquidación del banco salda lo devengado. Se ejecuta solo
            el día 1 de cada mes.
          </p>
          {ultima && (
            <p className="text-xs text-gray-500">
              Última ejecución ({ultima.disparo}): {ultima.periodo} ·{' '}
              {ultima.contabilizados} devengos · {formatEur(ultima.importe)}
              {ultima.omitidos > 0 && ` · ${ultima.omitidos} omitidos`}
            </p>
          )}
        </div>
        <div className="flex items-end gap-2">
          <input
            type="month"
            className={inputCls}
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
            aria-label="Periodo"
          />
          <Autorizado accion="cambiarEstado" recurso="aval">
            <button
              type="button"
              className={btnPrimaryCls}
              disabled={!valido || ocupado}
              onClick={() => {
                if (
                  !can('cambiarEstado', 'aval') ||
                  !valido ||
                  ocupado ||
                  !guarda.intentar()
                )
                  return;
                devengar.mutate();
              }}
            >
              {devengar.isPending ? 'Devengando…' : 'Devengar el mes'}
            </button>
            <button
              type="button"
              className={btnGhostCls}
              disabled={ocupado}
              onClick={() => {
                if (
                  !can('cambiarEstado', 'aval') ||
                  ocupado ||
                  !guarda.intentar()
                )
                  return;
                automatico.mutate();
              }}
            >
              {automatico.isPending
                ? 'Devengando pendientes…'
                : 'Devengar meses pendientes'}
            </button>
          </Autorizado>
        </div>
      </div>
      {lista.isError && (
        <ErrorBanner message={(lista.error as Error).message} />
      )}
      {lote && lote.avisos.length > 0 && (
        <div
          className={`mb-3 rounded-lg border p-3 text-xs ${alertasLote.length ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}
        >
          <p className="mb-1 font-semibold text-gray-700">
            Último devengo automático (
            {lote.disparo === 'automatico' ? 'tarea programada' : 'manual'},
            referencia {formatDate(lote.fechaReferencia)}):{' '}
            {lote.contabilizados} devengos · {formatEur(lote.importe)}
            {alertasLote.length > 0 &&
              ` · ${alertasLote.length} aviso(s) que requieren acción`}
          </p>
          <ul className="space-y-0.5">
            {alertasLote.map((a) => (
              <li key={`${a.motivo}-${a.desde}`} className="text-amber-800">
                ⚠ {a.detalle}
              </li>
            ))}
          </ul>
          {infoLote.length > 0 && (
            <details className="mt-1 text-gray-600">
              <summary className="cursor-pointer">
                {infoLote.length} aviso(s) informativo(s)
              </summary>
              <ul>
                {infoLote.map((a) => (
                  <li key={`${a.motivo}-${a.desde}`}>{a.detalle}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {filas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">Aval</th>
                <th className="px-3 py-2">Tramo</th>
                <th className="px-3 py-2 text-right">Saldo base</th>
                <th className="px-3 py-2 text-right">Tasa</th>
                <th className="px-3 py-2 text-right">Importe</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filas.map((d) => (
                <tr key={d.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-medium">{d.referencia}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatDate(d.desde)} – {formatDate(d.hasta)} ({d.dias} d)
                    {d.tramos.length > 1 && (
                      <ul className="mt-1 text-xs text-gray-500">
                        {d.tramos.map((t) => (
                          <li key={t.desde}>
                            {formatDate(t.desde)}–{formatDate(t.hasta)} ·{' '}
                            {formatEur(t.saldo)} × {t.dias} d
                            {t.tasaAnualPct !== undefined &&
                              ` × ${t.tasaAnualPct} %`}{' '}
                            = {formatEur(t.importe)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(d.saldoBase)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {d.tasaAnualPct} %
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(d.importe)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {d.estado === 'anulado'
                      ? `Anulado: ${d.motivoAnulacion ?? ''}`
                      : 'Contabilizado'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {d.estado === 'contabilizado' && (
                      <Autorizado accion="anular" recurso="aval">
                        {anulando?.id === d.id ? (
                          <form
                            className="flex justify-end gap-1"
                            onSubmit={(e) => {
                              e.preventDefault();
                              if (
                                !can('anular', 'aval') ||
                                motivo.trim().length < 3 ||
                                ocupado ||
                                !guarda.intentar()
                              )
                                return;
                              anular.mutate(d);
                            }}
                          >
                            <input
                              className={`${inputCls} w-40`}
                              placeholder="Motivo"
                              value={motivo}
                              onChange={(e) => setMotivo(e.target.value)}
                              aria-label="Motivo de la anulación"
                            />
                            <button
                              type="submit"
                              className={btnGhostCls}
                              disabled={ocupado || motivo.trim().length < 3}
                            >
                              Anular
                            </button>
                          </form>
                        ) : (
                          <button
                            type="button"
                            className={btnGhostCls}
                            onClick={() => setAnulando(d)}
                          >
                            Anular
                          </button>
                        )}
                      </Autorizado>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Líneas de avales por entidad (límite de riesgo concedido): dispuesto por
 * los avales emitidos vivos y disponible. Un alta que la supere se rechaza
 * con BANK_GUARANTEE_LIMIT_EXCEEDED.
 */
function LineasAval() {
  const [entidad, setEntidad] = useState('');
  const [limite, setLimite] = useState('');
  const [editando, setEditando] = useState<LineaAvalDto | null>(null);
  const [nuevoLimite, setNuevoLimite] = useState('');
  const clave = useRef(nuevoUuid());
  const [guarda] = useState(crearGuardaEnvio);
  const { can } = usePermisos();
  const qc = useQueryClient();
  const toast = useToast();
  const avisarError = useAvisarError();
  const lineas = useQuery({
    queryKey: ['avales', 'lineas'],
    queryFn: () => avalesApi.lineas(),
  });
  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: ['avales', 'lineas'] });
  };
  const crear = useMutation({
    mutationFn: () =>
      avalesApi.crearLinea(
        { entidad: entidad.trim(), limite: importe(limite) },
        clave.current,
      ),
    onSuccess: (l) => {
      clave.current = nuevoUuid();
      setEntidad('');
      setLimite('');
      toast(`Línea de ${l.entidad} creada`);
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const actualizar = useMutation({
    mutationFn: (p: {
      l: LineaAvalDto;
      cambios: { limite?: number; activa?: boolean };
    }) => avalesApi.actualizarLinea(p.l.id, p.cambios, p.l.version),
    onSuccess: (l) => {
      setEditando(null);
      toast(`Línea de ${l.entidad} actualizada`);
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const ocupado = crear.isPending || actualizar.isPending;
  useEffect(() => {
    if (!ocupado) guarda.liberar();
  }, [ocupado, guarda]);
  const filas = lineas.data ?? [];

  return (
    <section className="mt-8">
      <h2 className="mb-1 text-sm font-semibold">
        Líneas de avales por entidad
      </h2>
      <p className="mb-2 text-xs text-gray-500">
        Límite de riesgo que cada banco concede. Lo consumen los avales emitidos
        vivos de esa entidad; sin línea no hay límite.
      </p>
      {lineas.isError && (
        <ErrorBanner message={(lineas.error as Error).message} />
      )}
      {filas.length > 0 && (
        <div className="mb-3 overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">Entidad</th>
                <th className="px-3 py-2 text-right">Límite</th>
                <th className="px-3 py-2 text-right">Dispuesto</th>
                <th className="px-3 py-2 text-right">Disponible</th>
                <th className="px-3 py-2 text-right">Uso</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filas.map((l) => (
                <tr key={l.id} className="border-t border-gray-100">
                  <td className="px-3 py-2">
                    {l.entidad}
                    {!l.activa && (
                      <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                        Inactiva
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(l.limite)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(l.dispuesto)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${l.disponible < 0 ? 'text-red-700' : ''}`}
                  >
                    {formatEur(l.disponible)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {l.usoPct === null ? '—' : `${l.usoPct.toFixed(1)} %`}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Autorizado accion="editar" recurso="aval">
                      {editando?.id === l.id ? (
                        <form
                          className="flex justify-end gap-1"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (
                              !can('editar', 'aval') ||
                              !nuevoLimite.trim() ||
                              ocupado ||
                              !guarda.intentar()
                            )
                              return;
                            actualizar.mutate({
                              l,
                              cambios: { limite: importe(nuevoLimite) },
                            });
                          }}
                        >
                          <input
                            className={`${inputCls} w-28`}
                            inputMode="decimal"
                            value={nuevoLimite}
                            onChange={(e) => setNuevoLimite(e.target.value)}
                            aria-label="Nuevo límite"
                          />
                          <button
                            type="submit"
                            className={btnPrimaryCls}
                            disabled={ocupado}
                          >
                            Guardar
                          </button>
                        </form>
                      ) : (
                        <span className="flex justify-end gap-1">
                          <button
                            type="button"
                            className={btnGhostCls}
                            onClick={() => {
                              setEditando(l);
                              setNuevoLimite(String(l.limite));
                            }}
                          >
                            Límite
                          </button>
                          <button
                            type="button"
                            className={btnGhostCls}
                            disabled={ocupado}
                            onClick={() => {
                              if (
                                !can('editar', 'aval') ||
                                ocupado ||
                                !guarda.intentar()
                              )
                                return;
                              actualizar.mutate({
                                l,
                                cambios: { activa: !l.activa },
                              });
                            }}
                          >
                            {l.activa ? 'Desactivar' : 'Activar'}
                          </button>
                        </span>
                      )}
                    </Autorizado>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Autorizado accion="crear" recurso="aval">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              !can('crear', 'aval') ||
              !entidad.trim() ||
              !limite.trim() ||
              ocupado ||
              !guarda.intentar()
            )
              return;
            crear.mutate();
          }}
        >
          <div>
            <label className={labelCls} htmlFor="ln-entidad">
              Entidad
            </label>
            <input
              id="ln-entidad"
              className={fieldCls}
              value={entidad}
              onChange={(e) => setEntidad(e.target.value)}
              maxLength={120}
              required
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="ln-limite">
              Límite (€)
            </label>
            <input
              id="ln-limite"
              inputMode="decimal"
              className={fieldCls}
              value={limite}
              onChange={(e) => setLimite(e.target.value)}
              required
            />
          </div>
          <button type="submit" className={btnPrimaryCls} disabled={ocupado}>
            {crear.isPending ? 'Creando…' : 'Nueva línea'}
          </button>
        </form>
      </Autorizado>
    </section>
  );
}

function NuevoAvalModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const inicial = {
    referencia: '',
    tipo: 'garantia_definitiva' as TipoAval,
    direccion: 'emitido' as DireccionAval,
    entidad: '',
    projectId: '',
    importe: '',
    fechaEmision: hoy(),
    fechaVencimiento: '',
    tasa: '',
    periodicidad: '3',
  };
  const [f, setF] = useState(inicial);
  const clave = useRef(nuevoUuid());
  const [guarda] = useState(crearGuardaEnvio);
  const { can } = usePermisos();
  const toast = useToast();
  const avisarError = useAvisarError();
  const refrescar = useRefrescar();
  const obras = useQuery({
    queryKey: ['projects', 'avales'],
    queryFn: () => projectsApi.list('', ''),
    enabled: open,
  });
  const m = useMutation({
    mutationFn: () =>
      avalesApi.crear(
        {
          referencia: f.referencia.trim(),
          tipo: f.tipo,
          direccion: f.direccion,
          entidad: f.entidad.trim(),
          projectId: f.projectId || null,
          importe: importe(f.importe),
          fechaEmision: f.fechaEmision,
          fechaVencimiento: f.fechaVencimiento || null,
          tasaComisionAnualPct:
            f.direccion === 'emitido' && f.tasa.trim() ? importe(f.tasa) : null,
          periodicidadComisionMeses:
            f.direccion === 'emitido' && f.tasa.trim()
              ? Number(f.periodicidad)
              : null,
        },
        clave.current,
      ),
    onSuccess: (a) => {
      toast(`Aval ${a.referencia} dado de alta`);
      clave.current = nuevoUuid();
      setF(inicial);
      refrescar();
      onClose();
    },
    onError: (e) => avisarError(e),
  });
  useEffect(() => {
    if (!m.isPending) guarda.liberar();
  }, [m.isPending, guarda]);
  const campo = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((v) => ({ ...v, [k]: e.target.value }));

  return (
    <Modal open={open} title="Nuevo aval" onClose={onClose}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!can('crear', 'aval') || m.isPending || !guarda.intentar())
            return;
          m.mutate();
        }}
      >
        <div>
          <label className={labelCls} htmlFor="av-dir">
            Dirección
          </label>
          <select
            id="av-dir"
            className={fieldCls}
            value={f.direccion}
            onChange={campo('direccion')}
          >
            {DIRECCIONES_AVAL.map((d) => (
              <option key={d} value={d}>
                {DIRECCION_AVAL_LABELS[d]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="av-tipo">
            Tipo
          </label>
          <select
            id="av-tipo"
            className={fieldCls}
            value={f.tipo}
            onChange={campo('tipo')}
          >
            {TIPOS_AVAL.map((t) => (
              <option key={t} value={t}>
                {TIPO_AVAL_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="av-ref">
            Referencia / nº de aval
          </label>
          <input
            id="av-ref"
            className={fieldCls}
            value={f.referencia}
            onChange={campo('referencia')}
            required
            maxLength={60}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="av-ent">
            Entidad avalista
          </label>
          <input
            id="av-ent"
            className={fieldCls}
            value={f.entidad}
            onChange={campo('entidad')}
            required
            maxLength={120}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="av-obra">
            Obra
          </label>
          <select
            id="av-obra"
            className={fieldCls}
            value={f.projectId}
            onChange={campo('projectId')}
          >
            <option value="">Sin obra (aval de empresa)</option>
            {(obras.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.code} · {o.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="av-imp">
            Importe (€)
          </label>
          <input
            id="av-imp"
            inputMode="decimal"
            className={fieldCls}
            value={f.importe}
            onChange={campo('importe')}
            required
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="av-emi">
            Emisión
          </label>
          <input
            id="av-emi"
            type="date"
            className={fieldCls}
            value={f.fechaEmision}
            onChange={campo('fechaEmision')}
            required
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="av-ven">
            Vencimiento (vacío: indefinido)
          </label>
          <input
            id="av-ven"
            type="date"
            className={fieldCls}
            value={f.fechaVencimiento}
            onChange={campo('fechaVencimiento')}
          />
        </div>
        {f.direccion === 'emitido' && (
          <>
            <div>
              <label className={labelCls} htmlFor="av-tasa">
                Comisión anual (%)
              </label>
              <input
                id="av-tasa"
                inputMode="decimal"
                className={fieldCls}
                value={f.tasa}
                onChange={campo('tasa')}
                placeholder="0,75"
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="av-per">
                Liquidación (meses)
              </label>
              <select
                id="av-per"
                className={fieldCls}
                value={f.periodicidad}
                onChange={campo('periodicidad')}
              >
                {[1, 3, 6, 12].map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        <div className="flex items-end justify-end gap-2 sm:col-span-2">
          <button type="button" className={btnGhostCls} onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            className={btnPrimaryCls}
            disabled={m.isPending}
          >
            {m.isPending ? 'Guardando…' : 'Dar de alta'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type Accion = 'liberar' | 'ejecutar' | 'prorrogar' | 'comision';

const ETIQUETA_ACCION: Record<Accion, string> = {
  liberar: 'Liberar',
  ejecutar: 'Ejecutar',
  prorrogar: 'Prorrogar',
  comision: 'Registrar comisión',
};

function DetalleAvalModal({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const [accion, setAccion] = useState<Accion>('liberar');
  const [fecha, setFecha] = useState(hoy);
  const [imp, setImp] = useState('');
  const [motivo, setMotivo] = useState('');
  const [nuevaFecha, setNuevaFecha] = useState('');
  const [liquidacion, setLiquidacion] =
    useState<LiquidacionEjecucionAval>('tesoreria');
  const [nuevaTasa, setNuevaTasa] = useState('');
  const [tasaDesde, setTasaDesde] = useState(hoy);
  const clave = useRef(nuevoUuid());
  const [guarda] = useState(crearGuardaEnvio);
  const { can } = usePermisos();
  const toast = useToast();
  const avisarError = useAvisarError();
  const refrescar = useRefrescar();
  const d = useQuery({
    queryKey: ['aval', id],
    queryFn: () => avalesApi.detalle(id!),
    enabled: id !== null,
  });
  const cambioTasa = useMutation({
    mutationFn: (a: AvalDetalleDto) =>
      avalesApi.cambiarTasa(a.id, importe(nuevaTasa), tasaDesde, a.version),
    onSuccess: (a) => {
      setNuevaTasa('');
      toast(`Tasa de ${a.referencia} cambiada desde ${formatDate(tasaDesde)}`);
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const m = useMutation({
    mutationFn: (a: AvalDetalleDto) => {
      const c = clave.current;
      switch (accion) {
        case 'liberar':
          return avalesApi.liberar(
            a.id,
            { fecha, importe: importeOpcional(imp), motivo: motivo.trim() },
            a.version,
            c,
          );
        case 'ejecutar':
          return avalesApi.ejecutar(
            a.id,
            {
              fecha,
              importe: importeOpcional(imp),
              motivo: motivo.trim(),
              liquidacion:
                a.direccion === 'emitido' ? liquidacion : 'tesoreria',
            },
            a.version,
            c,
          );
        case 'prorrogar':
          return avalesApi.prorrogar(
            a.id,
            {
              fecha,
              nuevaFechaVencimiento: nuevaFecha,
              motivo: motivo.trim() || undefined,
            },
            a.version,
            c,
          );
        case 'comision':
          return avalesApi.comision(
            a.id,
            { fecha, importe: importeOpcional(imp) },
            a.version,
            c,
          );
      }
    },
    onSuccess: (a) => {
      toast(
        `${ETIQUETA_ACCION[accion]}: aval ${a.referencia} (${ESTADO_AVAL_LABELS[a.estado]}, saldo ${formatEur(a.saldoVivo)})`,
      );
      clave.current = nuevoUuid();
      setImp('');
      setMotivo('');
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  useEffect(() => {
    if (!m.isPending && !cambioTasa.isPending) guarda.liberar();
  }, [m.isPending, cambioTasa.isPending, guarda]);

  const a = d.data;
  const vivo = a?.estado === 'vigente' || a?.estado === 'liberado_parcial';
  const acciones: Accion[] =
    a?.direccion === 'emitido'
      ? ['liberar', 'ejecutar', 'prorrogar', 'comision']
      : ['liberar', 'ejecutar', 'prorrogar'];
  const pideMotivo = accion === 'liberar' || accion === 'ejecutar';
  const valido =
    (!pideMotivo || motivo.trim().length >= 3) &&
    (accion !== 'prorrogar' || nuevaFecha !== '');

  return (
    <Modal
      open={id !== null}
      wide
      title={a ? `Aval ${a.referencia} · ${a.entidad}` : 'Aval'}
      onClose={onClose}
    >
      {d.isError && <ErrorBanner message={(d.error as Error).message} />}
      {d.isLoading && <TableSkeleton rows={4} />}
      {a && (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-gray-500">Nominal</dt>
              <dd className="font-semibold tabular-nums">
                {formatEur(a.nominal)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Liberado / ejecutado</dt>
              <dd className="font-semibold tabular-nums">
                {formatEur(a.liberado)} / {formatEur(a.ejecutado)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Saldo vivo</dt>
              <dd className="font-semibold tabular-nums">
                {formatEur(a.saldoVivo)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Vencimiento</dt>
              <dd className="font-semibold">
                <Vence a={a} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Tipo</dt>
              <dd>
                {TIPO_AVAL_LABELS[a.tipo]} ·{' '}
                {DIRECCION_AVAL_LABELS[a.direccion]}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Obra</dt>
              <dd>{a.projectCodigo ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Estado</dt>
              <dd>{ESTADO_AVAL_LABELS[a.estado]}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Comisiones</dt>
              <dd className="tabular-nums">
                {formatEur(a.comisiones)}
                {a.tasaComisionAnualPct !== null &&
                  ` (${a.tasaComisionAnualPct} % anual)`}
                {a.comisionDevengada > 0 && (
                  <span className="block text-xs text-gray-500">
                    Devengado {formatEur(a.comisionDevengada)} · liquidado{' '}
                    {formatEur(a.devengoLiquidado)}
                  </span>
                )}
                {a.tasas.length > 1 && (
                  <span className="block text-xs text-gray-500">
                    Tasas:{' '}
                    {a.tasas
                      .map(
                        (t) =>
                          `${formatDate(t.fecha)} ${t.tasaAnualPct === null ? 'sin comisión' : `${t.tasaAnualPct} %`}`,
                      )
                      .join(' → ')}
                  </span>
                )}
              </dd>
            </div>
          </dl>

          {a.direccion === 'emitido' && vivo && (
            <Autorizado accion="editar" recurso="aval">
              <form
                className="mb-4 flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (
                    !can('editar', 'aval') ||
                    !nuevaTasa.trim() ||
                    !tasaDesde ||
                    cambioTasa.isPending ||
                    !guarda.intentar()
                  )
                    return;
                  cambioTasa.mutate(a);
                }}
              >
                <div>
                  <label className={labelCls} htmlFor="tasa-nueva">
                    Nueva tasa anual (%)
                  </label>
                  <input
                    id="tasa-nueva"
                    inputMode="decimal"
                    className={fieldCls}
                    value={nuevaTasa}
                    onChange={(e) => setNuevaTasa(e.target.value)}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="tasa-desde">
                    Rige desde
                  </label>
                  <input
                    id="tasa-desde"
                    type="date"
                    className={fieldCls}
                    value={tasaDesde}
                    onChange={(e) => setTasaDesde(e.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  className={btnGhostCls}
                  disabled={cambioTasa.isPending || !nuevaTasa.trim()}
                >
                  {cambioTasa.isPending ? 'Guardando…' : 'Cambiar tasa'}
                </button>
                <p className="w-full text-xs text-gray-500">
                  El devengo del mes del cambio se prorratea por tramos de tasa.
                </p>
              </form>
            </Autorizado>
          )}

          <div className="mb-4 max-h-56 overflow-y-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-2 py-1">Fecha</th>
                  <th className="px-2 py-1">Movimiento</th>
                  <th className="px-2 py-1 text-right">Importe</th>
                  <th className="px-2 py-1 text-right">Saldo vivo</th>
                  <th className="px-2 py-1">Motivo</th>
                  <th className="px-2 py-1">Asiento</th>
                </tr>
              </thead>
              <tbody>
                {a.movimientos.map((mv) => (
                  <tr key={mv.id} className="border-t border-gray-100">
                    <td className="px-2 py-1 tabular-nums">
                      {formatDate(mv.fecha)}
                    </td>
                    <td className="px-2 py-1">
                      {TIPO_MOVIMIENTO_AVAL_LABELS[mv.tipo]}
                      {mv.tipo === 'prorroga' &&
                        ` → ${formatDate(mv.fechaVencimiento)}`}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {formatEur(mv.importe)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {formatEur(mv.saldoVivo)}
                    </td>
                    <td className="px-2 py-1 text-gray-600">
                      {mv.motivo ?? ''}
                    </td>
                    <td className="px-2 py-1 text-xs text-emerald-700">
                      {mv.asientoId ? 'Contabilizado' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {vivo && (
            <Autorizado accion="cambiarEstado" recurso="aval">
              <form
                className="grid gap-3 rounded-lg bg-gray-50 p-3 sm:grid-cols-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (
                    !can('cambiarEstado', 'aval') ||
                    !valido ||
                    m.isPending ||
                    !guarda.intentar()
                  )
                    return;
                  m.mutate(a);
                }}
              >
                <div className="flex flex-wrap gap-2 sm:col-span-4">
                  {acciones.map((x) => (
                    <button
                      key={x}
                      type="button"
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${accion === x ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-200'}`}
                      onClick={() => setAccion(x)}
                    >
                      {ETIQUETA_ACCION[x]}
                    </button>
                  ))}
                </div>
                <div>
                  <label className={labelCls} htmlFor="mv-fecha">
                    Fecha
                  </label>
                  <input
                    id="mv-fecha"
                    type="date"
                    className={fieldCls}
                    value={fecha}
                    onChange={(e) => setFecha(e.target.value)}
                    required
                  />
                </div>
                {accion === 'prorrogar' ? (
                  <div>
                    <label className={labelCls} htmlFor="mv-nueva">
                      Nuevo vencimiento
                    </label>
                    <input
                      id="mv-nueva"
                      type="date"
                      className={fieldCls}
                      value={nuevaFecha}
                      onChange={(e) => setNuevaFecha(e.target.value)}
                      required
                    />
                  </div>
                ) : (
                  <div>
                    <label className={labelCls} htmlFor="mv-imp">
                      {accion === 'comision'
                        ? 'Importe (vacío: según tasa)'
                        : 'Importe (vacío: total)'}
                    </label>
                    <input
                      id="mv-imp"
                      inputMode="decimal"
                      className={fieldCls}
                      value={imp}
                      onChange={(e) => setImp(e.target.value)}
                    />
                  </div>
                )}
                {accion !== 'comision' && (
                  <div className="sm:col-span-2">
                    <label className={labelCls} htmlFor="mv-motivo">
                      Motivo
                    </label>
                    <input
                      id="mv-motivo"
                      className={fieldCls}
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      required={pideMotivo}
                      minLength={pideMotivo ? 3 : undefined}
                      maxLength={240}
                    />
                  </div>
                )}
                {accion === 'ejecutar' && a.direccion === 'emitido' && (
                  <div className="sm:col-span-2">
                    <label className={labelCls} htmlFor="mv-liq">
                      Liquidación
                    </label>
                    <select
                      id="mv-liq"
                      className={fieldCls}
                      value={liquidacion}
                      onChange={(e) =>
                        setLiquidacion(
                          e.target.value as LiquidacionEjecucionAval,
                        )
                      }
                    >
                      {LIQUIDACIONES_EJECUCION_AVAL.map((l) => (
                        <option key={l} value={l}>
                          {LIQUIDACION_EJECUCION_AVAL_LABELS[l]}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 sm:col-span-4">
                  <p className="text-xs text-gray-500">
                    {accion === 'ejecutar'
                      ? a.direccion === 'emitido'
                        ? `Se contabiliza 6780 (obra) a ${liquidacion === 'financiacion' ? '5200 (préstamo del banco)' : '5720'} en la fecha indicada.`
                        : 'Se contabiliza 5720 a 7780 (obra) en la fecha indicada.'
                      : accion === 'comision'
                        ? 'Se contabiliza 6260 (obra) a 5720.'
                        : accion === 'liberar'
                          ? 'Sin asiento: el aval es un riesgo contingente.'
                          : ''}
                  </p>
                  <button
                    type="submit"
                    className={
                      accion === 'ejecutar'
                        ? `${btnPrimaryCls} bg-red-700 hover:bg-red-800`
                        : btnPrimaryCls
                    }
                    disabled={m.isPending || !valido}
                  >
                    {m.isPending ? 'Guardando…' : ETIQUETA_ACCION[accion]}
                  </button>
                </div>
              </form>
            </Autorizado>
          )}
        </>
      )}
    </Modal>
  );
}
