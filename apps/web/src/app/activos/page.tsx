'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  CATEGORIAS_ACTIVO,
  CATEGORIA_ACTIVO_LABELS,
  type ActivoDto,
  type CategoriaActivo,
} from '@erp/shared';
import { activosApi, formatDate, formatEur } from '@/lib/api';
import { nuevoUuid } from '@/lib/api-error';
import { Autorizado } from '@/components/autorizado';
import { IconCalculator } from '@/components/icons';
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

function mesAnterior(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

export default function ActivosPage() {
  const [estado, setEstado] = useState('activo');
  const [q, setQ] = useState('');
  const [hasta, setHasta] = useState(mesAnterior);
  const [nuevo, setNuevo] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const avisarError = useAvisarError();

  const lista = useQuery({
    queryKey: ['activos', estado, q],
    queryFn: () =>
      activosApi.listar({ estado: estado || undefined, q: q || undefined }),
  });

  const amortizar = useMutation({
    mutationFn: () => activosApi.amortizar(hasta),
    onSuccess: (r) => {
      toast(
        `${r.cuotas} cuotas contabilizadas (${formatEur(r.importe)})` +
          (r.omitidos.length
            ? ` · ${r.omitidos.length} omitidos: ${r.omitidos[0].motivo}`
            : ''),
        r.omitidos.length ? 'error' : 'success',
      );
      void qc.invalidateQueries({ queryKey: ['activos'] });
      void qc.invalidateQueries({ queryKey: ['activo'] });
      void qc.invalidateQueries({ queryKey: ['contabilidad'] });
    },
    onError: (e) => avisarError(e),
  });

  const filas = lista.data ?? [];
  const totales = filas.reduce(
    (t, a) => ({
      coste: t.coste + Math.round(a.coste * 100),
      neto: t.neto + Math.round(a.valorNeto * 100),
    }),
    { coste: 0, neto: 0 },
  );

  return (
    <div>
      <PageHeader
        title="Activos fijos"
        subtitle="Inmovilizado, cuadro de amortización y bajas, contabilizados en el libro mayor."
        count={filas.length}
      >
        <Autorizado accion="cambiarEstado" recurso="contabilidad">
          <label className="flex items-center gap-1 text-xs text-gray-600">
            Amortizar hasta
            <input
              type="month"
              className={inputCls}
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
            />
          </label>
          <button
            type="button"
            className={btnGhostCls}
            disabled={amortizar.isPending || !hasta}
            onClick={() => amortizar.mutate()}
          >
            {amortizar.isPending ? 'Amortizando…' : 'Amortizar'}
          </button>
        </Autorizado>
        <Autorizado accion="crear" recurso="contabilidad">
          <button
            type="button"
            className={btnPrimaryCls}
            onClick={() => setNuevo(true)}
          >
            Nuevo activo
          </button>
        </Autorizado>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          className={selectCls}
          value={estado}
          onChange={(e) => setEstado(e.target.value)}
          aria-label="Estado"
        >
          <option value="activo">En uso</option>
          <option value="baja">De baja</option>
          <option value="">Todos</option>
        </select>
        <input
          className={inputCls}
          placeholder="Buscar código o nombre"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {filas.length > 0 && (
          <span className="ml-auto text-sm text-gray-600">
            Coste {formatEur(totales.coste / 100)} · Valor neto{' '}
            <span className="font-semibold">
              {formatEur(totales.neto / 100)}
            </span>
          </span>
        )}
      </div>

      {lista.isError && (
        <ErrorBanner message={(lista.error as Error).message} />
      )}
      {lista.isLoading && <TableSkeleton />}
      {lista.isSuccess && filas.length === 0 && (
        <EmptyState icon={<IconCalculator />} title="Sin activos">
          Da de alta la maquinaria, vehículos e instalaciones para calcular y
          contabilizar su amortización.
        </EmptyState>
      )}
      {filas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Nombre</th>
                <th className="px-3 py-2">Categoría</th>
                <th className="px-3 py-2 text-right">Coste</th>
                <th className="px-3 py-2 text-right">Amort. acumulada</th>
                <th className="px-3 py-2 text-right">Valor neto</th>
                <th className="px-3 py-2">Amortizado hasta</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((a: ActivoDto) => (
                <tr
                  key={a.id}
                  className="cursor-pointer border-t border-gray-100 hover:bg-amber-50/40"
                  onClick={() => setAbierto(a.id)}
                >
                  <td className="px-3 py-2 font-medium">{a.codigo}</td>
                  <td className="px-3 py-2">
                    {a.nombre}
                    {a.estado === 'baja' && (
                      <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
                        Baja {formatDate(a.fechaBaja)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    {CATEGORIA_ACTIVO_LABELS[a.categoria]}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(a.coste)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(a.amortizacionAcumulada)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formatEur(a.valorNeto)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {a.amortizadoHasta ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NuevoActivoModal open={nuevo} onClose={() => setNuevo(false)} />
      <DetalleActivoModal id={abierto} onClose={() => setAbierto(null)} />
    </div>
  );
}

function NuevoActivoModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const hoy = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({
    codigo: '',
    nombre: '',
    categoria: 'maquinaria' as CategoriaActivo,
    fechaAdquisicion: hoy,
    fechaInicio: hoy,
    coste: '',
    valorResidual: '0',
    vidaUtilMeses: '60',
  });
  const clave = useRef(nuevoUuid());
  const qc = useQueryClient();
  const toast = useToast();
  const avisarError = useAvisarError();
  const m = useMutation({
    mutationFn: () =>
      activosApi.crear(
        {
          codigo: f.codigo.trim(),
          nombre: f.nombre.trim(),
          categoria: f.categoria,
          fechaAdquisicion: f.fechaAdquisicion,
          fechaInicio: f.fechaInicio,
          coste: Number(f.coste.replace(',', '.')),
          valorResidual: Number(f.valorResidual.replace(',', '.')) || 0,
          vidaUtilMeses: Number(f.vidaUtilMeses),
        },
        clave.current,
      ),
    onSuccess: (a) => {
      toast(`Activo ${a.codigo} dado de alta`);
      clave.current = nuevoUuid();
      void qc.invalidateQueries({ queryKey: ['activos'] });
      onClose();
    },
    onError: (e) => avisarError(e),
  });
  const campo = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((v) => ({ ...v, [k]: e.target.value }));

  return (
    <Modal open={open} title="Nuevo activo" onClose={onClose}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!m.isPending) m.mutate();
        }}
      >
        <div>
          <label className={labelCls} htmlFor="af-codigo">
            Código
          </label>
          <input
            id="af-codigo"
            className={fieldCls}
            value={f.codigo}
            onChange={campo('codigo')}
            required
            maxLength={30}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="af-categoria">
            Categoría
          </label>
          <select
            id="af-categoria"
            className={fieldCls}
            value={f.categoria}
            onChange={campo('categoria')}
          >
            {CATEGORIAS_ACTIVO.map((c) => (
              <option key={c} value={c}>
                {CATEGORIA_ACTIVO_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="af-nombre">
            Nombre
          </label>
          <input
            id="af-nombre"
            className={fieldCls}
            value={f.nombre}
            onChange={campo('nombre')}
            required
            maxLength={160}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="af-adq">
            Adquisición
          </label>
          <input
            id="af-adq"
            type="date"
            className={fieldCls}
            value={f.fechaAdquisicion}
            onChange={campo('fechaAdquisicion')}
            required
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="af-ini">
            Puesta en servicio
          </label>
          <input
            id="af-ini"
            type="date"
            className={fieldCls}
            value={f.fechaInicio}
            onChange={campo('fechaInicio')}
            required
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="af-coste">
            Coste (€)
          </label>
          <input
            id="af-coste"
            inputMode="decimal"
            className={fieldCls}
            value={f.coste}
            onChange={campo('coste')}
            required
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="af-residual">
            Valor residual (€)
          </label>
          <input
            id="af-residual"
            inputMode="decimal"
            className={fieldCls}
            value={f.valorResidual}
            onChange={campo('valorResidual')}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="af-vida">
            Vida útil (meses)
          </label>
          <input
            id="af-vida"
            type="number"
            min={1}
            max={600}
            className={fieldCls}
            value={f.vidaUtilMeses}
            onChange={campo('vidaUtilMeses')}
            required
          />
        </div>
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

function DetalleActivoModal({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const [fechaBaja, setFechaBaja] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [venta, setVenta] = useState('0');
  const [motivo, setMotivo] = useState('');
  const clave = useRef(nuevoUuid());
  const qc = useQueryClient();
  const toast = useToast();
  const avisarError = useAvisarError();
  const d = useQuery({
    queryKey: ['activo', id],
    queryFn: () => activosApi.detalle(id!),
    enabled: id !== null,
  });
  const baja = useMutation({
    mutationFn: () =>
      activosApi.baja(
        id!,
        {
          fecha: fechaBaja,
          importeVenta: Number(venta.replace(',', '.')) || 0,
          motivo: motivo.trim(),
        },
        d.data!.version,
        clave.current,
      ),
    onSuccess: () => {
      toast('Activo dado de baja');
      clave.current = nuevoUuid();
      void qc.invalidateQueries({ queryKey: ['activos'] });
      void qc.invalidateQueries({ queryKey: ['activo', id] });
      void qc.invalidateQueries({ queryKey: ['contabilidad'] });
    },
    onError: (e) => avisarError(e),
  });
  const a = d.data;
  return (
    <Modal
      open={id !== null}
      wide
      title={a ? `${a.codigo} · ${a.nombre}` : 'Activo'}
      onClose={onClose}
    >
      {d.isError && <ErrorBanner message={(d.error as Error).message} />}
      {d.isLoading && <TableSkeleton rows={4} />}
      {a && (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-gray-500">Coste</dt>
              <dd className="font-semibold tabular-nums">
                {formatEur(a.coste)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Acumulada</dt>
              <dd className="font-semibold tabular-nums">
                {formatEur(a.amortizacionAcumulada)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Valor neto</dt>
              <dd className="font-semibold tabular-nums">
                {formatEur(a.valorNeto)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Vida útil</dt>
              <dd className="font-semibold">{a.vidaUtilMeses} meses</dd>
            </div>
          </dl>
          <div className="mb-4 max-h-64 overflow-y-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-2 py-1">Mes</th>
                  <th className="px-2 py-1 text-right">Cuota</th>
                  <th className="px-2 py-1 text-right">Acumulada</th>
                  <th className="px-2 py-1 text-right">Valor neto</th>
                  <th className="px-2 py-1">Estado</th>
                </tr>
              </thead>
              <tbody>
                {a.cuadro.map((c) => (
                  <tr
                    key={`${c.ejercicio}-${c.mes}`}
                    className="border-t border-gray-100"
                  >
                    <td className="px-2 py-1 tabular-nums">
                      {String(c.mes).padStart(2, '0')}/{c.ejercicio}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {formatEur(c.importe)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {formatEur(c.acumulada)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {formatEur(c.valorNeto)}
                    </td>
                    <td
                      className={`px-2 py-1 text-xs ${c.contabilizada ? 'text-emerald-700' : 'text-gray-400'}`}
                    >
                      {c.contabilizada ? 'Contabilizada' : 'Prevista'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {a.estado === 'baja' ? (
            <p className="text-sm text-gray-600">
              Baja el {formatDate(a.fechaBaja)} ({a.motivoBaja}) por{' '}
              {formatEur(a.importeVenta ?? 0)}.
            </p>
          ) : (
            <Autorizado accion="anular" recurso="contabilidad">
              <form
                className="grid gap-3 rounded-lg bg-gray-50 p-3 sm:grid-cols-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!baja.isPending && motivo.trim().length >= 3)
                    baja.mutate();
                }}
              >
                <div>
                  <label className={labelCls} htmlFor="baja-fecha">
                    Fecha de baja
                  </label>
                  <input
                    id="baja-fecha"
                    type="date"
                    className={fieldCls}
                    value={fechaBaja}
                    onChange={(e) => setFechaBaja(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="baja-venta">
                    Importe de venta
                  </label>
                  <input
                    id="baja-venta"
                    inputMode="decimal"
                    className={fieldCls}
                    value={venta}
                    onChange={(e) => setVenta(e.target.value)}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls} htmlFor="baja-motivo">
                    Motivo
                  </label>
                  <input
                    id="baja-motivo"
                    className={fieldCls}
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    required
                    minLength={3}
                    maxLength={240}
                  />
                </div>
                <div className="flex justify-end sm:col-span-4">
                  <button
                    type="submit"
                    className={btnPrimaryCls}
                    disabled={baja.isPending || motivo.trim().length < 3}
                  >
                    {baja.isPending ? 'Dando de baja…' : 'Dar de baja'}
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
