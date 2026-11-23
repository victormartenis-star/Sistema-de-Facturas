'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import {
  TIPOS_MOVIMIENTO_STOCK,
  TIPO_ALMACEN_LABELS,
  TIPO_MOVIMIENTO_STOCK_LABELS,
  UNIDADES_STOCK,
  type ExistenciaDto,
  type TipoAlmacen,
  type TipoMovimientoStock,
  type UnidadStock,
} from '@erp/shared';
import {
  almacenApi,
  deliveryNotesApi,
  formatDate,
  formatEur,
  projectsApi,
} from '@/lib/api';
import { nuevoUuid } from '@/lib/api-error';
import { Autorizado } from '@/components/autorizado';
import { IconAlertTriangle, IconCube } from '@/components/icons';
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

type Operacion =
  'almacen' | 'articulo' | 'entrada' | 'consumo' | 'devolucion' | 'traspaso';

const hoy = () => new Date().toISOString().slice(0, 10);

/** "1.234,5" o "1234.5" → número (NaN si no es válido). */
function num(v: string): number {
  const t = v.trim();
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
}

function formatCantidad(n: number, unidad?: string): string {
  return `${n.toLocaleString('es-ES', { maximumFractionDigits: 3 })}${unidad ? ` ${unidad}` : ''}`;
}

function formatPmp(n: number): string {
  return n.toLocaleString('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

/** Invalida todo lo que depende del stock (y el libro mayor). */
function useRefrescar() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['almacen'] });
    void qc.invalidateQueries({ queryKey: ['contabilidad'] });
  };
}

export default function AlmacenPage() {
  const [almacenId, setAlmacenId] = useState('');
  const [vista, setVista] = useState<'existencias' | 'movimientos'>(
    'existencias',
  );
  const [q, setQ] = useState('');
  const [soloAlertas, setSoloAlertas] = useState(false);
  const [operacion, setOperacion] = useState<Operacion | null>(null);
  const [regularizar, setRegularizar] = useState<ExistenciaDto | null>(null);
  const [minimo, setMinimo] = useState<ExistenciaDto | null>(null);

  const resumen = useQuery({
    queryKey: ['almacen', 'resumen'],
    queryFn: almacenApi.resumen,
  });
  const existencias = useQuery({
    queryKey: ['almacen', 'existencias', almacenId, q, soloAlertas],
    queryFn: () =>
      almacenApi.existencias({
        almacenId: almacenId || undefined,
        q: q || undefined,
        bajoMinimo: soloAlertas,
      }),
    enabled: vista === 'existencias',
  });

  const r = resumen.data;
  const filas = existencias.data ?? [];

  return (
    <div>
      <PageHeader
        title="Almacén y stock"
        subtitle="Existencias valoradas a precio medio ponderado, imputación de consumos a obra y asientos PGC automáticos."
        count={r?.articulosConStock}
      >
        <Autorizado accion="crear">
          <button
            type="button"
            className={btnGhostCls}
            onClick={() => setOperacion('consumo')}
          >
            Imputar a obra
          </button>
          <button
            type="button"
            className={btnGhostCls}
            onClick={() => setOperacion('devolucion')}
          >
            Devolución
          </button>
          <button
            type="button"
            className={btnGhostCls}
            onClick={() => setOperacion('traspaso')}
          >
            Traspasar
          </button>
        </Autorizado>
        <Autorizado accion="crear" recurso="contabilidad">
          <button
            type="button"
            className={btnGhostCls}
            onClick={() => setOperacion('almacen')}
          >
            Nuevo almacén
          </button>
          <button
            type="button"
            className={btnGhostCls}
            onClick={() => setOperacion('articulo')}
          >
            Nuevo artículo
          </button>
          <button
            type="button"
            className={btnPrimaryCls}
            onClick={() => setOperacion('entrada')}
          >
            Registrar entrada
          </button>
        </Autorizado>
      </PageHeader>

      {resumen.isError && (
        <ErrorBanner message={(resumen.error as Error).message} />
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Kpi titulo="Valoración del inventario">
          {r ? formatEur(r.valoracionTotal) : '—'}
        </Kpi>
        <Kpi titulo="Almacenes activos">{r?.almacenes ?? '—'}</Kpi>
        <Kpi titulo="Alertas bajo mínimo" alerta={(r?.alertas ?? 0) > 0}>
          {r?.alertas ?? '—'}
        </Kpi>
      </div>

      {r && r.porAlmacen.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <ChipAlmacen
            activo={almacenId === ''}
            onClick={() => setAlmacenId('')}
            titulo="Todos"
          />
          {r.porAlmacen.map((a) => (
            <ChipAlmacen
              key={a.almacenId}
              activo={almacenId === a.almacenId}
              onClick={() => setAlmacenId(a.almacenId)}
              titulo={`${a.codigo} · ${a.nombre}`}
              detalle={`${TIPO_ALMACEN_LABELS[a.tipo]} · ${formatEur(a.valor)}`}
              alertas={a.alertas}
            />
          ))}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3 border-b border-gray-200">
        {(['existencias', 'movimientos'] as const).map((v) => (
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
            {v === 'existencias' ? 'Existencias' : 'Movimientos'}
          </button>
        ))}
      </div>

      {vista === 'existencias' ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <input
              className={inputCls}
              placeholder="Buscar artículo"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={soloAlertas}
                onChange={(e) => setSoloAlertas(e.target.checked)}
              />
              Solo bajo mínimo
            </label>
          </div>
          {existencias.isError && (
            <ErrorBanner message={(existencias.error as Error).message} />
          )}
          {existencias.isLoading && <TableSkeleton />}
          {existencias.isSuccess && filas.length === 0 && (
            <EmptyState icon={<IconCube />} title="Sin existencias">
              Da de alta almacenes y artículos y registra la primera entrada
              (manual o desde un albarán de compra).
            </EmptyState>
          )}
          {filas.length > 0 && (
            <TablaExistencias
              filas={filas}
              onRegularizar={setRegularizar}
              onMinimo={setMinimo}
            />
          )}
        </>
      ) : (
        <Movimientos almacenId={almacenId} />
      )}

      <AlmacenModal
        open={operacion === 'almacen'}
        onClose={() => setOperacion(null)}
      />
      <ArticuloModal
        open={operacion === 'articulo'}
        onClose={() => setOperacion(null)}
      />
      <EntradaModal
        open={operacion === 'entrada'}
        almacenInicial={almacenId}
        onClose={() => setOperacion(null)}
      />
      <ConsumoModal
        open={operacion === 'consumo' || operacion === 'devolucion'}
        modo={operacion === 'devolucion' ? 'devolucion' : 'consumo'}
        almacenInicial={almacenId}
        onClose={() => setOperacion(null)}
      />
      <TraspasoModal
        open={operacion === 'traspaso'}
        almacenInicial={almacenId}
        onClose={() => setOperacion(null)}
      />
      <RegularizarModal
        existencia={regularizar}
        onClose={() => setRegularizar(null)}
      />
      <MinimoModal existencia={minimo} onClose={() => setMinimo(null)} />
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
      className={`rounded-xl border bg-white px-4 py-3 shadow-sm ${
        alerta ? 'border-red-200' : ''
      }`}
    >
      <p className="text-xs text-gray-500">{titulo}</p>
      <p
        className={`mt-1 text-xl font-semibold tabular-nums ${
          alerta ? 'text-red-600' : 'text-gray-900'
        }`}
      >
        {children}
      </p>
    </div>
  );
}

function ChipAlmacen({
  activo,
  onClick,
  titulo,
  detalle,
  alertas = 0,
}: {
  activo: boolean;
  onClick: () => void;
  titulo: string;
  detalle?: string;
  alertas?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
        activo
          ? 'border-amber-500 bg-amber-50'
          : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      <span className="font-medium">{titulo}</span>
      {alertas > 0 && (
        <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
          {alertas} bajo mínimo
        </span>
      )}
      {detalle && (
        <span className="block text-xs text-gray-500">{detalle}</span>
      )}
    </button>
  );
}

function TablaExistencias({
  filas,
  onRegularizar,
  onMinimo,
}: {
  filas: ExistenciaDto[];
  onRegularizar: (e: ExistenciaDto) => void;
  onMinimo: (e: ExistenciaDto) => void;
}) {
  const total = filas.reduce((s, e) => s + Math.round(e.valor * 100), 0);
  return (
    <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs text-gray-500">
          <tr>
            <th className="px-3 py-2">Almacén</th>
            <th className="px-3 py-2">Artículo</th>
            <th className="px-3 py-2 text-right">Disponible</th>
            <th className="px-3 py-2 text-right">PMP</th>
            <th className="px-3 py-2 text-right">Valoración</th>
            <th className="px-3 py-2 text-right">Stock mínimo</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {filas.map((e) => (
            <tr key={e.id} className="border-t border-gray-100">
              <td className="px-3 py-2 text-gray-600">{e.almacenCodigo}</td>
              <td className="px-3 py-2">
                <span className="font-medium">{e.articuloCodigo}</span>{' '}
                {e.articuloNombre}
                {e.bajoMinimo && (
                  <span className="ml-2 inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                    <IconAlertTriangle size={10} /> Bajo mínimo
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatCantidad(e.disponible, e.unidad)}
                {e.reservada > 0 && (
                  <span className="block text-[11px] text-gray-500">
                    {formatCantidad(e.reservada)} reservadas
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatPmp(e.pmp)}
              </td>
              <td className="px-3 py-2 text-right font-medium tabular-nums">
                {formatEur(e.valor)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {e.stockMinimo > 0 ? formatCantidad(e.stockMinimo) : '—'}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                <Autorizado accion="editar" recurso="contabilidad">
                  <button
                    type="button"
                    className="mr-3 text-xs text-gray-600 hover:underline"
                    onClick={() => onMinimo(e)}
                  >
                    Mínimo
                  </button>
                  <button
                    type="button"
                    className="text-xs font-medium text-amber-700 hover:underline"
                    onClick={() => onRegularizar(e)}
                  >
                    Regularizar
                  </button>
                </Autorizado>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t bg-gray-50 font-semibold">
            <td className="px-3 py-2" colSpan={4}>
              Total
            </td>
            <td className="px-3 py-2 text-right tabular-nums">
              {formatEur(total / 100)}
            </td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

const PAGE_SIZE = 25;

function Movimientos({ almacenId }: { almacenId: string }) {
  const [tipo, setTipo] = useState('');
  const [projectId, setProjectId] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [page, setPage] = useState(1);
  const obras = useQuery({
    queryKey: ['projects', 'almacen'],
    queryFn: () => projectsApi.list('', ''),
  });
  const movs = useQuery({
    queryKey: [
      'almacen',
      'movimientos',
      almacenId,
      tipo,
      projectId,
      desde,
      hasta,
      page,
    ],
    queryFn: () =>
      almacenApi.movimientos({
        almacenId: almacenId || undefined,
        tipo: tipo || undefined,
        projectId: projectId || undefined,
        desde: desde || undefined,
        hasta: hasta || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
  });
  const nombreObra = new Map(
    (obras.data ?? []).map((o) => [o.id, `${o.code} ${o.name}`]),
  );
  const filtro =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(1);
    };
  const p = movs.data;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <select
          className={selectCls}
          value={tipo}
          onChange={(e) => filtro(setTipo)(e.target.value)}
          aria-label="Tipo de movimiento"
        >
          <option value="">Todos los tipos</option>
          {TIPOS_MOVIMIENTO_STOCK.map((t) => (
            <option key={t} value={t}>
              {TIPO_MOVIMIENTO_STOCK_LABELS[t]}
            </option>
          ))}
        </select>
        <select
          className={selectCls}
          value={projectId}
          onChange={(e) => filtro(setProjectId)(e.target.value)}
          aria-label="Obra"
        >
          <option value="">Todas las obras</option>
          {(obras.data ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.code} · {o.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-gray-600">
          Desde
          <input
            type="date"
            className={inputCls}
            value={desde}
            onChange={(e) => filtro(setDesde)(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-gray-600">
          Hasta
          <input
            type="date"
            className={inputCls}
            value={hasta}
            onChange={(e) => filtro(setHasta)(e.target.value)}
          />
        </label>
      </div>
      {movs.isError && <ErrorBanner message={(movs.error as Error).message} />}
      {movs.isLoading && <TableSkeleton />}
      {p && p.items.length === 0 && (
        <EmptyState icon={<IconCube />} title="Sin movimientos">
          No hay movimientos con estos filtros.
        </EmptyState>
      )}
      {p && p.items.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Almacén</th>
                  <th className="px-3 py-2">Artículo</th>
                  <th className="px-3 py-2 text-right">Cantidad</th>
                  <th className="px-3 py-2 text-right">Coste unit.</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                  <th className="px-3 py-2">Obra / motivo</th>
                </tr>
              </thead>
              <tbody>
                {p.items.map((m) => (
                  <tr key={m.id} className="border-t border-gray-100">
                    <td className="px-3 py-2 tabular-nums">
                      {formatDate(m.fecha)}
                    </td>
                    <td className="px-3 py-2">
                      <BadgeTipo tipo={m.tipo} />
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {m.almacenCodigo}
                      {m.almacenDestinoCodigo && ` → ${m.almacenDestinoCodigo}`}
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-medium">{m.articuloCodigo}</span>{' '}
                      {m.articuloNombre}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        m.cantidad < 0 ? 'text-red-700' : 'text-emerald-700'
                      }`}
                    >
                      {formatCantidad(m.cantidad, m.unidad)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatPmp(m.costeUnitario)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {formatEur(m.valor)}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {m.projectId
                        ? (nombreObra.get(m.projectId) ?? 'Obra')
                        : (m.motivo ?? m.notas ?? '')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-end gap-3 text-sm text-gray-600">
            <span>
              Página {p.page} de {Math.max(1, p.totalPages)} · {p.total}{' '}
              movimientos
            </span>
            <button
              type="button"
              className={btnGhostCls}
              disabled={page <= 1}
              onClick={() => setPage((x) => x - 1)}
            >
              Anterior
            </button>
            <button
              type="button"
              className={btnGhostCls}
              disabled={page >= p.totalPages}
              onClick={() => setPage((x) => x + 1)}
            >
              Siguiente
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const COLOR_TIPO: Record<TipoMovimientoStock, string> = {
  entrada_compra: 'bg-emerald-100 text-emerald-700',
  salida_obra: 'bg-amber-100 text-amber-800',
  traspaso: 'bg-sky-100 text-sky-700',
  regularizacion: 'bg-purple-100 text-purple-700',
  devolucion: 'bg-gray-100 text-gray-700',
};

function BadgeTipo({ tipo }: { tipo: TipoMovimientoStock }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${COLOR_TIPO[tipo]}`}
    >
      {TIPO_MOVIMIENTO_STOCK_LABELS[tipo]}
    </span>
  );
}

/* ────────────────────────────── modales ────────────────────────────── */

/**
 * Mutación con guarda de envío único e Idempotency-Key estable entre
 * reintentos del mismo envío (se renueva tras un éxito).
 */
function useOperacion<T>(
  fn: (clave: string) => Promise<T>,
  alTerminar: (r: T) => void,
) {
  const clave = useRef(nuevoUuid());
  const refrescar = useRefrescar();
  const avisarError = useAvisarError();
  const m = useMutation({
    mutationFn: () => fn(clave.current),
    onSuccess: (r) => {
      clave.current = nuevoUuid();
      refrescar();
      alTerminar(r);
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
    <div className="mt-2 flex justify-end gap-2 sm:col-span-2">
      <button type="button" className={btnGhostCls} onClick={onClose}>
        Cancelar
      </button>
      <button type="submit" className={btnPrimaryCls} disabled={pendiente}>
        {pendiente ? 'Guardando…' : texto}
      </button>
    </div>
  );
}

function Campo({
  id,
  label,
  children,
  ancho = false,
}: {
  id: string;
  label: string;
  children: ReactNode;
  ancho?: boolean;
}) {
  return (
    <div className={ancho ? 'sm:col-span-2' : undefined}>
      <label className={labelCls} htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  );
}

function useAlmacenes(open: boolean) {
  return useQuery({
    queryKey: ['almacen', 'almacenes'],
    queryFn: almacenApi.almacenes,
    enabled: open,
  });
}

function useArticulos(open: boolean) {
  return useQuery({
    queryKey: ['almacen', 'articulos'],
    queryFn: () => almacenApi.articulos(),
    enabled: open,
  });
}

function useObras(open: boolean) {
  return useQuery({
    queryKey: ['projects', 'almacen'],
    queryFn: () => projectsApi.list('', ''),
    enabled: open,
  });
}

function AlmacenModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [f, setF] = useState({
    codigo: '',
    nombre: '',
    tipo: 'central' as TipoAlmacen,
    projectId: '',
    direccion: '',
  });
  const obras = useObras(open);
  const toast = useToast();
  const op = useOperacion(
    (clave) =>
      almacenApi.crearAlmacen(
        {
          codigo: f.codigo.trim(),
          nombre: f.nombre.trim(),
          tipo: f.tipo,
          projectId: f.tipo === 'obra' ? f.projectId : null,
          direccion: f.direccion.trim() || null,
        },
        clave,
      ),
    (a) => {
      toast(`Almacén ${a.codigo} creado`);
      onClose();
    },
  );
  return (
    <Modal open={open} title="Nuevo almacén" onClose={onClose}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          op.enviar();
        }}
      >
        <Campo id="al-codigo" label="Código">
          <input
            id="al-codigo"
            className={fieldCls}
            value={f.codigo}
            maxLength={20}
            required
            onChange={(e) => setF({ ...f, codigo: e.target.value })}
          />
        </Campo>
        <Campo id="al-tipo" label="Tipo">
          <select
            id="al-tipo"
            className={fieldCls}
            value={f.tipo}
            onChange={(e) =>
              setF({ ...f, tipo: e.target.value as TipoAlmacen })
            }
          >
            <option value="central">{TIPO_ALMACEN_LABELS.central}</option>
            <option value="obra">{TIPO_ALMACEN_LABELS.obra}</option>
          </select>
        </Campo>
        <Campo id="al-nombre" label="Nombre" ancho>
          <input
            id="al-nombre"
            className={fieldCls}
            value={f.nombre}
            maxLength={120}
            required
            onChange={(e) => setF({ ...f, nombre: e.target.value })}
          />
        </Campo>
        {f.tipo === 'obra' && (
          <Campo id="al-obra" label="Obra" ancho>
            <select
              id="al-obra"
              className={fieldCls}
              value={f.projectId}
              required
              onChange={(e) => setF({ ...f, projectId: e.target.value })}
            >
              <option value="">Selecciona la obra</option>
              {(obras.data ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.code} · {o.name}
                </option>
              ))}
            </select>
          </Campo>
        )}
        <Campo id="al-dir" label="Dirección" ancho>
          <input
            id="al-dir"
            className={fieldCls}
            value={f.direccion}
            maxLength={240}
            onChange={(e) => setF({ ...f, direccion: e.target.value })}
          />
        </Campo>
        <Pie pendiente={op.pendiente} onClose={onClose} texto="Crear almacén" />
      </form>
    </Modal>
  );
}

function ArticuloModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [f, setF] = useState({
    codigo: '',
    nombre: '',
    unidad: 'ud' as UnidadStock,
    cuentaExistencias: '3000',
    cuentaVariacion: '6100',
  });
  const toast = useToast();
  const op = useOperacion(
    (clave) =>
      almacenApi.crearArticulo(
        {
          codigo: f.codigo.trim(),
          nombre: f.nombre.trim(),
          unidad: f.unidad,
          cuentaExistencias: f.cuentaExistencias.trim(),
          cuentaVariacion: f.cuentaVariacion.trim(),
        },
        clave,
      ),
    (a) => {
      toast(`Artículo ${a.codigo} creado`);
      onClose();
    },
  );
  return (
    <Modal open={open} title="Nuevo artículo" onClose={onClose}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          op.enviar();
        }}
      >
        <Campo id="ar-codigo" label="Código">
          <input
            id="ar-codigo"
            className={fieldCls}
            value={f.codigo}
            maxLength={30}
            required
            onChange={(e) => setF({ ...f, codigo: e.target.value })}
          />
        </Campo>
        <Campo id="ar-unidad" label="Unidad">
          <select
            id="ar-unidad"
            className={fieldCls}
            value={f.unidad}
            onChange={(e) =>
              setF({ ...f, unidad: e.target.value as UnidadStock })
            }
          >
            {UNIDADES_STOCK.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </Campo>
        <Campo id="ar-nombre" label="Nombre" ancho>
          <input
            id="ar-nombre"
            className={fieldCls}
            value={f.nombre}
            maxLength={160}
            required
            onChange={(e) => setF({ ...f, nombre: e.target.value })}
          />
        </Campo>
        <Campo id="ar-c3" label="Cuenta de existencias (grupo 3)">
          <input
            id="ar-c3"
            className={fieldCls}
            value={f.cuentaExistencias}
            pattern="3[0-9]{3,7}"
            required
            onChange={(e) => setF({ ...f, cuentaExistencias: e.target.value })}
          />
        </Campo>
        <Campo id="ar-c61" label="Cuenta de variación (61x)">
          <input
            id="ar-c61"
            className={fieldCls}
            value={f.cuentaVariacion}
            pattern="61[0-9]{2,6}"
            required
            onChange={(e) => setF({ ...f, cuentaVariacion: e.target.value })}
          />
        </Campo>
        <Pie
          pendiente={op.pendiente}
          onClose={onClose}
          texto="Crear artículo"
        />
      </form>
    </Modal>
  );
}

interface LineaForm {
  articuloId: string;
  cantidad: string;
  costeUnitario: string;
}

function LineasEditor({
  lineas,
  setLineas,
  conCoste,
  open,
}: {
  lineas: LineaForm[];
  setLineas: (l: LineaForm[]) => void;
  conCoste: boolean;
  open: boolean;
}) {
  const articulos = useArticulos(open);
  const activos = (articulos.data ?? []).filter((a) => a.activo);
  const cambiar = (i: number, k: keyof LineaForm, v: string) =>
    setLineas(lineas.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <div className="sm:col-span-2">
      <p className={labelCls}>Líneas</p>
      <div className="space-y-2">
        {lineas.map((l, i) => (
          <div key={i} className="flex gap-2">
            <select
              aria-label="Artículo"
              className={`${fieldCls} flex-1`}
              value={l.articuloId}
              required
              onChange={(e) => cambiar(i, 'articuloId', e.target.value)}
            >
              <option value="">Artículo…</option>
              {activos.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.codigo} · {a.nombre} ({a.unidad})
                </option>
              ))}
            </select>
            <input
              aria-label="Cantidad"
              className={`${fieldCls} w-24`}
              placeholder="Cantidad"
              inputMode="decimal"
              value={l.cantidad}
              required
              onChange={(e) => cambiar(i, 'cantidad', e.target.value)}
            />
            {conCoste && (
              <input
                aria-label="Coste unitario"
                className={`${fieldCls} w-28`}
                placeholder="€/ud"
                inputMode="decimal"
                value={l.costeUnitario}
                required
                onChange={(e) => cambiar(i, 'costeUnitario', e.target.value)}
              />
            )}
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
      </div>
      <button
        type="button"
        className="mt-2 text-xs font-medium text-amber-700 hover:underline"
        onClick={() =>
          setLineas([
            ...lineas,
            { articuloId: '', cantidad: '', costeUnitario: '' },
          ])
        }
      >
        + Añadir línea
      </button>
    </div>
  );
}

const lineaVacia = (): LineaForm => ({
  articuloId: '',
  cantidad: '',
  costeUnitario: '',
});

function SelectAlmacen({
  id,
  value,
  onChange,
  open,
  excluir,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  open: boolean;
  excluir?: string;
}) {
  const almacenes = useAlmacenes(open);
  return (
    <select
      id={id}
      className={fieldCls}
      value={value}
      required
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Selecciona el almacén</option>
      {(almacenes.data ?? [])
        .filter((a) => a.activo && a.id !== excluir)
        .map((a) => (
          <option key={a.id} value={a.id}>
            {a.codigo} · {a.nombre}
          </option>
        ))}
    </select>
  );
}

function EntradaModal({
  open,
  almacenInicial,
  onClose,
}: {
  open: boolean;
  almacenInicial: string;
  onClose: () => void;
}) {
  const [almacenId, setAlmacenId] = useState(almacenInicial);
  const [fecha, setFecha] = useState(hoy);
  const [albaranId, setAlbaranId] = useState('');
  const [notas, setNotas] = useState('');
  const [lineas, setLineas] = useState<LineaForm[]>([lineaVacia()]);
  const albaranes = useQuery({
    queryKey: ['delivery-notes', 'almacen'],
    queryFn: () => deliveryNotesApi.list({}),
    enabled: open,
  });
  const toast = useToast();
  const op = useOperacion(
    (clave) =>
      almacenApi.entrada(
        {
          almacenId,
          fecha,
          albaranId: albaranId || null,
          notas: notas.trim() || null,
          lineas: lineas.map((l) => ({
            articuloId: l.articuloId,
            cantidad: num(l.cantidad),
            costeUnitario: num(l.costeUnitario),
          })),
        },
        clave,
      ),
    (r) => {
      toast(`Entrada registrada: ${r.length} línea(s)`);
      setLineas([lineaVacia()]);
      setAlbaranId('');
      onClose();
    },
  );
  return (
    <Modal open={open} title="Registrar entrada" wide onClose={onClose}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          op.enviar();
        }}
      >
        <Campo id="en-almacen" label="Almacén">
          <SelectAlmacen
            id="en-almacen"
            value={almacenId}
            onChange={setAlmacenId}
            open={open}
          />
        </Campo>
        <Campo id="en-fecha" label="Fecha">
          <input
            id="en-fecha"
            type="date"
            className={fieldCls}
            value={fecha}
            required
            onChange={(e) => setFecha(e.target.value)}
          />
        </Campo>
        <Campo id="en-albaran" label="Albarán de compra (opcional)" ancho>
          <select
            id="en-albaran"
            className={fieldCls}
            value={albaranId}
            onChange={(e) => setAlbaranId(e.target.value)}
          >
            <option value="">Entrada manual, sin albarán</option>
            {(albaranes.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.noteNumber} · {a.contactName} · {formatEur(a.amount)}
              </option>
            ))}
          </select>
        </Campo>
        <LineasEditor
          lineas={lineas}
          setLineas={setLineas}
          conCoste
          open={open}
        />
        <Campo id="en-notas" label="Notas" ancho>
          <input
            id="en-notas"
            className={fieldCls}
            value={notas}
            maxLength={500}
            onChange={(e) => setNotas(e.target.value)}
          />
        </Campo>
        <p className="text-xs text-gray-500 sm:col-span-2">
          Recalcula el precio medio ponderado y contabiliza existencias (3000)
          contra variación de existencias (6100).
        </p>
        <Pie pendiente={op.pendiente} onClose={onClose} texto="Registrar" />
      </form>
    </Modal>
  );
}

function ConsumoModal({
  open,
  modo,
  almacenInicial,
  onClose,
}: {
  open: boolean;
  modo: 'consumo' | 'devolucion';
  almacenInicial: string;
  onClose: () => void;
}) {
  const [almacenId, setAlmacenId] = useState(almacenInicial);
  const [projectId, setProjectId] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [notas, setNotas] = useState('');
  const [lineas, setLineas] = useState<LineaForm[]>([lineaVacia()]);
  const obras = useObras(open);
  const toast = useToast();
  const op = useOperacion(
    (clave) => {
      const input = {
        almacenId,
        projectId,
        fecha,
        notas: notas.trim() || null,
        lineas: lineas.map((l) => ({
          articuloId: l.articuloId,
          cantidad: num(l.cantidad),
        })),
      };
      return modo === 'consumo'
        ? almacenApi.consumo(input, clave)
        : almacenApi.devolucion(input, clave);
    },
    (r) => {
      const total = r.reduce(
        (s, m) => s + Math.round(Math.abs(m.valor) * 100),
        0,
      );
      toast(
        `${modo === 'consumo' ? 'Imputado a obra' : 'Devuelto al almacén'}: ${formatEur(total / 100)}`,
      );
      setLineas([lineaVacia()]);
      onClose();
    },
  );
  return (
    <Modal
      open={open}
      title={
        modo === 'consumo' ? 'Imputar consumo a obra' : 'Devolución de obra'
      }
      wide
      onClose={onClose}
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          op.enviar();
        }}
      >
        <Campo id="co-almacen" label="Almacén">
          <SelectAlmacen
            id="co-almacen"
            value={almacenId}
            onChange={setAlmacenId}
            open={open}
          />
        </Campo>
        <Campo id="co-obra" label="Obra">
          <select
            id="co-obra"
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
        </Campo>
        <Campo id="co-fecha" label="Fecha">
          <input
            id="co-fecha"
            type="date"
            className={fieldCls}
            value={fecha}
            required
            onChange={(e) => setFecha(e.target.value)}
          />
        </Campo>
        <Campo id="co-notas" label="Notas">
          <input
            id="co-notas"
            className={fieldCls}
            value={notas}
            maxLength={500}
            onChange={(e) => setNotas(e.target.value)}
          />
        </Campo>
        <LineasEditor
          lineas={lineas}
          setLineas={setLineas}
          conCoste={false}
          open={open}
        />
        <p className="text-xs text-gray-500 sm:col-span-2">
          {modo === 'consumo'
            ? 'Se valora al precio medio vigente y se imputa a la obra: 6100 (obra) a 3000.'
            : 'Se valora al coste con que la obra lo consumió y revierte su imputación: 3000 a 6100 (obra).'}
        </p>
        <Pie
          pendiente={op.pendiente}
          onClose={onClose}
          texto={modo === 'consumo' ? 'Imputar' : 'Devolver'}
        />
      </form>
    </Modal>
  );
}

function TraspasoModal({
  open,
  almacenInicial,
  onClose,
}: {
  open: boolean;
  almacenInicial: string;
  onClose: () => void;
}) {
  const [origenId, setOrigenId] = useState(almacenInicial);
  const [destinoId, setDestinoId] = useState('');
  const [articuloId, setArticuloId] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const articulos = useArticulos(open);
  const saldoOrigen = useQuery({
    queryKey: ['almacen', 'existencias', 'traspaso', origenId],
    queryFn: () => almacenApi.existencias({ almacenId: origenId }),
    enabled: open && Boolean(origenId),
  });
  const actual = (saldoOrigen.data ?? []).find(
    (e) => e.articuloId === articuloId,
  );
  const toast = useToast();
  const op = useOperacion(
    (clave) =>
      almacenApi.traspaso(
        { origenId, destinoId, articuloId, cantidad: num(cantidad), fecha },
        clave,
        actual?.version,
      ),
    (m) => {
      toast(`Traspasado: ${formatEur(Math.abs(m.valor))}`);
      setCantidad('');
      onClose();
    },
  );
  return (
    <Modal open={open} title="Traspaso entre almacenes" onClose={onClose}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          op.enviar();
        }}
      >
        <Campo id="tr-origen" label="Origen">
          <SelectAlmacen
            id="tr-origen"
            value={origenId}
            onChange={setOrigenId}
            open={open}
          />
        </Campo>
        <Campo id="tr-destino" label="Destino">
          <SelectAlmacen
            id="tr-destino"
            value={destinoId}
            onChange={setDestinoId}
            open={open}
            excluir={origenId}
          />
        </Campo>
        <Campo id="tr-articulo" label="Artículo" ancho>
          <select
            id="tr-articulo"
            className={fieldCls}
            value={articuloId}
            required
            onChange={(e) => setArticuloId(e.target.value)}
          >
            <option value="">Selecciona el artículo</option>
            {(articulos.data ?? [])
              .filter((a) => a.activo)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.codigo} · {a.nombre}
                </option>
              ))}
          </select>
          {actual && (
            <p className="mt-1 text-xs text-gray-500">
              Disponible en origen:{' '}
              {formatCantidad(actual.disponible, actual.unidad)} a{' '}
              {formatPmp(actual.pmp)}
            </p>
          )}
        </Campo>
        <Campo id="tr-cantidad" label="Cantidad">
          <input
            id="tr-cantidad"
            className={fieldCls}
            inputMode="decimal"
            value={cantidad}
            required
            onChange={(e) => setCantidad(e.target.value)}
          />
        </Campo>
        <Campo id="tr-fecha" label="Fecha">
          <input
            id="tr-fecha"
            type="date"
            className={fieldCls}
            value={fecha}
            required
            onChange={(e) => setFecha(e.target.value)}
          />
        </Campo>
        <Pie pendiente={op.pendiente} onClose={onClose} texto="Traspasar" />
      </form>
    </Modal>
  );
}

function RegularizarModal({
  existencia,
  onClose,
}: {
  existencia: ExistenciaDto | null;
  onClose: () => void;
}) {
  const [contada, setContada] = useState('');
  const [coste, setCoste] = useState('');
  const [motivo, setMotivo] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const toast = useToast();
  const e = existencia;
  const op = useOperacion(
    (clave) =>
      almacenApi.regularizacion(
        {
          almacenId: e!.almacenId,
          articuloId: e!.articuloId,
          fecha,
          cantidadContada: num(contada),
          costeUnitario: coste.trim() ? num(coste) : null,
          motivo: motivo.trim(),
        },
        clave,
        e!.version,
      ),
    (m) => {
      toast(
        `Regularizado: ${formatCantidad(m.cantidad)} (${formatEur(m.valor)})`,
      );
      setContada('');
      setMotivo('');
      setCoste('');
      onClose();
    },
  );
  const diferencia = contada.trim() && e ? num(contada) - e.cantidad : null;
  return (
    <Modal
      open={e !== null}
      title={e ? `Regularizar ${e.articuloCodigo} en ${e.almacenCodigo}` : ''}
      onClose={onClose}
    >
      {e && (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            op.enviar();
          }}
        >
          <p className="text-sm text-gray-600 sm:col-span-2">
            Stock teórico: {formatCantidad(e.cantidad, e.unidad)} · PMP{' '}
            {formatPmp(e.pmp)}
          </p>
          <Campo id="rg-contada" label="Cantidad contada">
            <input
              id="rg-contada"
              className={fieldCls}
              inputMode="decimal"
              value={contada}
              required
              onChange={(ev) => setContada(ev.target.value)}
            />
            {diferencia !== null && !Number.isNaN(diferencia) && (
              <p
                className={`mt-1 text-xs ${diferencia < 0 ? 'text-red-600' : 'text-emerald-700'}`}
              >
                Diferencia:{' '}
                {formatCantidad(Number(diferencia.toFixed(3)), e.unidad)}
              </p>
            )}
          </Campo>
          <Campo id="rg-fecha" label="Fecha">
            <input
              id="rg-fecha"
              type="date"
              className={fieldCls}
              value={fecha}
              required
              onChange={(ev) => setFecha(ev.target.value)}
            />
          </Campo>
          <Campo
            id="rg-coste"
            label="Coste del sobrante (opcional, €/ud)"
            ancho
          >
            <input
              id="rg-coste"
              className={fieldCls}
              inputMode="decimal"
              placeholder="Por defecto, el PMP vigente"
              value={coste}
              onChange={(ev) => setCoste(ev.target.value)}
            />
          </Campo>
          <Campo id="rg-motivo" label="Motivo" ancho>
            <input
              id="rg-motivo"
              className={fieldCls}
              value={motivo}
              minLength={3}
              maxLength={240}
              required
              onChange={(ev) => setMotivo(ev.target.value)}
            />
          </Campo>
          <Pie pendiente={op.pendiente} onClose={onClose} texto="Regularizar" />
        </form>
      )}
    </Modal>
  );
}

function MinimoModal({
  existencia,
  onClose,
}: {
  existencia: ExistenciaDto | null;
  onClose: () => void;
}) {
  const [valor, setValor] = useState('');
  const toast = useToast();
  const refrescar = useRefrescar();
  const avisarError = useAvisarError();
  const e = existencia;
  const m = useMutation({
    mutationFn: () => almacenApi.stockMinimo(e!.id, num(valor), e!.version),
    onSuccess: (r) => {
      toast(
        `Stock mínimo de ${r.articuloCodigo}: ${formatCantidad(r.stockMinimo, r.unidad)}`,
      );
      refrescar();
      setValor('');
      onClose();
    },
    onError: (err) => avisarError(err, refrescar),
  });
  return (
    <Modal
      open={e !== null}
      title={
        e ? `Stock mínimo de ${e.articuloCodigo} en ${e.almacenCodigo}` : ''
      }
      onClose={onClose}
    >
      {e && (
        <form
          className="grid gap-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (!m.isPending) m.mutate();
          }}
        >
          <Campo id="mi-valor" label={`Mínimo (${e.unidad})`}>
            <input
              id="mi-valor"
              className={fieldCls}
              inputMode="decimal"
              placeholder={String(e.stockMinimo)}
              value={valor}
              required
              onChange={(ev) => setValor(ev.target.value)}
            />
          </Campo>
          <Pie pendiente={m.isPending} onClose={onClose} texto="Guardar" />
        </form>
      )}
    </Modal>
  );
}
