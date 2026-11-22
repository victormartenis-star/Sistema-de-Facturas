'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  ORIGEN_ASIENTO_LABELS,
  ORIGENES_ASIENTO,
  errorCuadre,
  totalesAsiento,
  type AsientoDto,
} from '@erp/shared';
import { contabilidadApi, formatDate, formatEur } from '@/lib/api';
import { nuevoUuid } from '@/lib/api-error';
import { useAvisarError, useToast } from '@/components/toast';
import { Autorizado } from '@/components/autorizado';
import { IconCalculator } from '@/components/icons';
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

const MESES_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

type Pestana = 'diario' | 'sumas' | 'mayor' | 'periodos';

const PESTANAS: { id: Pestana; label: string }[] = [
  { id: 'diario', label: 'Libro diario' },
  { id: 'sumas', label: 'Sumas y saldos' },
  { id: 'mayor', label: 'Libro mayor' },
  { id: 'periodos', label: 'Períodos' },
];

const POR_PAGINA = 25;

export default function ContabilidadPage() {
  const [pestana, setPestana] = useState<Pestana>('diario');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [nuevo, setNuevo] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const avisarError = useAvisarError();

  const interfaz = useMutation({
    mutationFn: contabilidadApi.contabilizarPendientes,
    onSuccess: (r) => {
      toast(
        `Contabilizados ${r.contabilizados}, anulados ${r.anulados}` +
          (r.omitidos.length ? `, omitidos ${r.omitidos.length}` : ''),
        r.omitidos.length ? 'error' : 'success',
      );
      void qc.invalidateQueries({ queryKey: ['contabilidad'] });
    },
    onError: (e) => avisarError(e),
  });

  return (
    <div>
      <PageHeader
        title="Contabilidad"
        subtitle="Libro diario, mayor y balances (PGC). Los asientos no se editan: se anulan con contra-asiento."
      >
        <Autorizado accion="cambiarEstado" recurso="contabilidad">
          <button
            type="button"
            className={btnGhostCls}
            disabled={interfaz.isPending}
            onClick={() => interfaz.mutate()}
          >
            {interfaz.isPending ? 'Contabilizando…' : 'Contabilizar pendientes'}
          </button>
        </Autorizado>
        <Autorizado accion="crear" recurso="contabilidad">
          <button
            type="button"
            className={btnPrimaryCls}
            onClick={() => setNuevo(true)}
          >
            Nuevo asiento
          </button>
        </Autorizado>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <nav
          className="flex gap-1 rounded-lg bg-gray-100 p-1"
          aria-label="Vistas"
        >
          {PESTANAS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPestana(p.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                pestana === p.id
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {p.label}
            </button>
          ))}
        </nav>
        {pestana !== 'periodos' && (
          <>
            <label className="text-xs text-gray-600">
              Desde
              <input
                type="date"
                className={`${inputCls} block`}
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
              />
            </label>
            <label className="text-xs text-gray-600">
              Hasta
              <input
                type="date"
                className={`${inputCls} block`}
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
              />
            </label>
          </>
        )}
      </div>

      {pestana === 'diario' && <LibroDiario desde={desde} hasta={hasta} />}
      {pestana === 'sumas' && <SumasSaldos desde={desde} hasta={hasta} />}
      {pestana === 'mayor' && <LibroMayor desde={desde} hasta={hasta} />}
      {pestana === 'periodos' && <Periodos />}

      <NuevoAsientoModal open={nuevo} onClose={() => setNuevo(false)} />
    </div>
  );
}

/* ───────────────────────────── libro diario ───────────────────────────── */

function LibroDiario({ desde, hasta }: { desde: string; hasta: string }) {
  const [origen, setOrigen] = useState('');
  const [pagina, setPagina] = useState(0);
  const [anulando, setAnulando] = useState<AsientoDto | null>(null);
  const q = useQuery({
    queryKey: ['contabilidad', 'asientos', desde, hasta, origen, pagina],
    queryFn: () =>
      contabilidadApi.asientos({
        desde: desde || undefined,
        hasta: hasta || undefined,
        origen: origen || undefined,
        limit: POR_PAGINA,
        offset: pagina * POR_PAGINA,
      }),
  });

  const total = q.data?.total ?? 0;
  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        <select
          className={selectCls}
          value={origen}
          onChange={(e) => {
            setOrigen(e.target.value);
            setPagina(0);
          }}
          aria-label="Origen"
        >
          <option value="">Todos los orígenes</option>
          {ORIGENES_ASIENTO.map((o) => (
            <option key={o} value={o}>
              {ORIGEN_ASIENTO_LABELS[o]}
            </option>
          ))}
        </select>
        <span className="text-xs text-gray-500">{total} asientos</span>
      </div>
      {q.isError && <ErrorBanner message={(q.error as Error).message} />}
      {q.isLoading && <TableSkeleton />}
      {q.data && q.data.items.length === 0 && (
        <EmptyState icon={<IconCalculator />} title="Sin asientos">
          Pulsa «Contabilizar pendientes» para llevar al libro las facturas
          aprobadas y los cobros y pagos, o crea un asiento manual.
        </EmptyState>
      )}
      <div className="space-y-3">
        {q.data?.items.map((a) => (
          <article
            key={a.id}
            className={`rounded-xl border bg-white p-4 shadow-sm ${
              a.estado === 'anulado' ? 'opacity-60' : ''
            }`}
          >
            <header className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold tabular-nums">
                Nº {a.numero}/{a.ejercicio}
              </span>
              <span className="text-gray-500">{formatDate(a.fecha)}</span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                {ORIGEN_ASIENTO_LABELS[a.origen]}
              </span>
              {a.estado === 'anulado' && (
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">
                  Anulado
                </span>
              )}
              <span className="text-gray-700">{a.concepto}</span>
              {a.estado === 'contabilizado' && !a.anulaAId && (
                <Autorizado accion="anular" recurso="contabilidad">
                  <button
                    type="button"
                    className={`${btnGhostCls} ml-auto text-xs`}
                    onClick={() => setAnulando(a)}
                  >
                    Anular
                  </button>
                </Autorizado>
              )}
            </header>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr>
                  <th className="py-1">Cuenta</th>
                  <th className="py-1">Concepto</th>
                  <th className="py-1 text-right">Debe</th>
                  <th className="py-1 text-right">Haber</th>
                </tr>
              </thead>
              <tbody>
                {a.lineas.map((l) => (
                  <tr key={l.id} className="border-t border-gray-100">
                    <td className="py-1 tabular-nums">
                      {l.cuenta}{' '}
                      <span className="text-gray-500">{l.nombreCuenta}</span>
                    </td>
                    <td className="py-1 text-gray-600">{l.concepto}</td>
                    <td className="py-1 text-right tabular-nums">
                      {l.debe ? formatEur(l.debe) : ''}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {l.haber ? formatEur(l.haber) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        ))}
      </div>
      {total > POR_PAGINA && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <button
            type="button"
            className={btnGhostCls}
            disabled={pagina === 0}
            onClick={() => setPagina((p) => p - 1)}
          >
            Anterior
          </button>
          <span className="tabular-nums text-gray-600">
            {pagina + 1} / {Math.ceil(total / POR_PAGINA)}
          </span>
          <button
            type="button"
            className={btnGhostCls}
            disabled={(pagina + 1) * POR_PAGINA >= total}
            onClick={() => setPagina((p) => p + 1)}
          >
            Siguiente
          </button>
        </div>
      )}
      <AnularModal asiento={anulando} onClose={() => setAnulando(null)} />
    </section>
  );
}

function AnularModal({
  asiento,
  onClose,
}: {
  asiento: AsientoDto | null;
  onClose: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const qc = useQueryClient();
  const toast = useToast();
  const avisarError = useAvisarError();
  const m = useMutation({
    mutationFn: (a: AsientoDto) =>
      contabilidadApi.anularAsiento(a.id, a.version, motivo.trim()),
    onSuccess: (contra) => {
      toast(
        `Contra-asiento ${contra.numero}/${contra.ejercicio} contabilizado`,
      );
      setMotivo('');
      void qc.invalidateQueries({ queryKey: ['contabilidad'] });
      onClose();
    },
    onError: (e) =>
      avisarError(
        e,
        () => void qc.invalidateQueries({ queryKey: ['contabilidad'] }),
      ),
  });
  return (
    <Modal
      open={asiento !== null}
      title={
        asiento ? `Anular asiento ${asiento.numero}/${asiento.ejercicio}` : ''
      }
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!asiento || m.isPending || motivo.trim().length < 3) return;
          m.mutate(asiento);
        }}
      >
        <p className="mb-3 text-sm text-gray-600">
          Se contabilizará un contra-asiento con debe y haber intercambiados. El
          asiento original se conserva y queda marcado como anulado.
        </p>
        <label className={labelCls} htmlFor="motivo-anulacion">
          Motivo
        </label>
        <input
          id="motivo-anulacion"
          className={fieldCls}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          maxLength={240}
          required
          minLength={3}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnGhostCls} onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            className={btnPrimaryCls}
            disabled={m.isPending || motivo.trim().length < 3}
          >
            {m.isPending ? 'Anulando…' : 'Anular'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ──────────────────────────── sumas y saldos ──────────────────────────── */

function SumasSaldos({ desde, hasta }: { desde: string; hasta: string }) {
  const q = useQuery({
    queryKey: ['contabilidad', 'sumas', desde, hasta],
    queryFn: () =>
      contabilidadApi.sumasSaldos(desde || undefined, hasta || undefined),
  });
  if (q.isError) return <ErrorBanner message={(q.error as Error).message} />;
  if (q.isLoading || !q.data) return <TableSkeleton />;
  const d = q.data;
  if (d.filas.length === 0) {
    return (
      <EmptyState icon={<IconCalculator />} title="Sin movimientos">
        No hay apuntes en el rango elegido.
      </EmptyState>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs text-gray-500">
          <tr>
            <th className="px-3 py-2">Cuenta</th>
            <th className="px-3 py-2 text-right">Debe</th>
            <th className="px-3 py-2 text-right">Haber</th>
            <th className="px-3 py-2 text-right">Saldo deudor</th>
            <th className="px-3 py-2 text-right">Saldo acreedor</th>
          </tr>
        </thead>
        <tbody>
          {d.filas.map((f) => (
            <tr key={f.codigo} className="border-t border-gray-100">
              <td className="px-3 py-2 tabular-nums">
                {f.codigo} <span className="text-gray-500">{f.nombre}</span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatEur(f.debe)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatEur(f.haber)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {f.saldoDeudor ? formatEur(f.saldoDeudor) : ''}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {f.saldoAcreedor ? formatEur(f.saldoAcreedor) : ''}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 font-semibold">
          <tr>
            <td className="px-3 py-2">
              Totales{' '}
              <span className={d.cuadra ? 'text-emerald-700' : 'text-red-700'}>
                {d.cuadra ? '· cuadra' : '· ¡no cuadra!'}
              </span>
            </td>
            <td className="px-3 py-2 text-right tabular-nums">
              {formatEur(d.totalDebe)}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">
              {formatEur(d.totalHaber)}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">
              {formatEur(d.totalSaldoDeudor)}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">
              {formatEur(d.totalSaldoAcreedor)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* ───────────────────────────── libro mayor ───────────────────────────── */

function LibroMayor({ desde, hasta }: { desde: string; hasta: string }) {
  const [cuenta, setCuenta] = useState('5720');
  const [consultada, setConsultada] = useState('5720');
  const q = useQuery({
    queryKey: ['contabilidad', 'mayor', consultada, desde, hasta],
    queryFn: () =>
      contabilidadApi.mayor(consultada, desde || undefined, hasta || undefined),
    enabled: /^\d{3,12}$/.test(consultada),
    retry: false,
  });
  const d = q.data;
  return (
    <section>
      <form
        className="mb-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setConsultada(cuenta.trim());
        }}
      >
        <label className="text-xs text-gray-600">
          Cuenta
          <input
            className={`${inputCls} block w-40 tabular-nums`}
            value={cuenta}
            inputMode="numeric"
            onChange={(e) => setCuenta(e.target.value)}
          />
        </label>
        <button type="submit" className={btnGhostCls}>
          Consultar
        </button>
      </form>
      {q.isError && <ErrorBanner message={(q.error as Error).message} />}
      {q.isLoading && <TableSkeleton />}
      {d && (
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm">
            <span className="font-semibold">
              {d.cuenta.codigo} {d.cuenta.nombre}
            </span>{' '}
            · saldo inicial {formatEur(d.saldoInicial)} · saldo final{' '}
            <span className="font-semibold">{formatEur(d.saldoFinal)}</span>
          </p>
          {d.truncado && (
            <p className="mb-2 text-xs text-amber-700">
              Se muestran los primeros 2.000 movimientos: acota el rango de
              fechas.
            </p>
          )}
          {d.movimientos.length === 0 ? (
            <p className="text-sm text-gray-500">
              Sin movimientos en el rango.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr>
                  <th className="py-1">Fecha</th>
                  <th className="py-1">Asiento</th>
                  <th className="py-1">Concepto</th>
                  <th className="py-1 text-right">Debe</th>
                  <th className="py-1 text-right">Haber</th>
                  <th className="py-1 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {d.movimientos.map((m, i) => (
                  <tr
                    key={`${m.asientoId}-${i}`}
                    className="border-t border-gray-100"
                  >
                    <td className="py-1">{formatDate(m.fecha)}</td>
                    <td className="py-1 tabular-nums">{m.numero}</td>
                    <td className="py-1 text-gray-600">{m.concepto}</td>
                    <td className="py-1 text-right tabular-nums">
                      {m.debe ? formatEur(m.debe) : ''}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {m.haber ? formatEur(m.haber) : ''}
                    </td>
                    <td className="py-1 text-right font-medium tabular-nums">
                      {formatEur(m.saldo)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}

/* ─────────────────────────────── períodos ─────────────────────────────── */

function Periodos() {
  const [ejercicio, setEjercicio] = useState(new Date().getFullYear());
  const qc = useQueryClient();
  const toast = useToast();
  const avisarError = useAvisarError();
  const q = useQuery({
    queryKey: ['contabilidad', 'periodos', ejercicio],
    queryFn: () => contabilidadApi.periodos(ejercicio),
  });
  const m = useMutation({
    mutationFn: (v: { mes: number; accion: 'cerrar' | 'reabrir' }) =>
      contabilidadApi.cambiarPeriodo(ejercicio, v.mes, v.accion),
    onSuccess: (p) => {
      toast(`Período ${MESES_ES[p.mes - 1]} ${p.ejercicio} ${p.estado}`);
      void qc.invalidateQueries({ queryKey: ['contabilidad'] });
    },
    onError: (e) => avisarError(e),
  });
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          className={btnGhostCls}
          onClick={() => setEjercicio((y) => y - 1)}
        >
          ←
        </button>
        <span className="font-semibold tabular-nums">
          Ejercicio {ejercicio}
        </span>
        <button
          type="button"
          className={btnGhostCls}
          onClick={() => setEjercicio((y) => y + 1)}
        >
          →
        </button>
      </div>
      {q.isError && <ErrorBanner message={(q.error as Error).message} />}
      {q.isLoading && <TableSkeleton rows={4} />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {q.data?.map((p) => (
          <div key={p.mes} className="rounded-xl border bg-white p-3 shadow-sm">
            <p className="text-sm font-semibold capitalize">
              {MESES_ES[p.mes - 1]}
            </p>
            <p className="text-xs text-gray-500">{p.asientos} asientos</p>
            <p
              className={`mt-1 text-xs font-medium ${
                p.estado === 'cerrado' ? 'text-red-700' : 'text-emerald-700'
              }`}
            >
              {p.estado === 'cerrado' ? 'Cerrado' : 'Abierto'}
            </p>
            <Autorizado accion="cambiarEstado" recurso="contabilidad">
              <button
                type="button"
                className={`${btnGhostCls} mt-2 text-xs`}
                disabled={m.isPending}
                onClick={() =>
                  m.mutate({
                    mes: p.mes,
                    accion: p.estado === 'cerrado' ? 'reabrir' : 'cerrar',
                  })
                }
              >
                {p.estado === 'cerrado' ? 'Reabrir' : 'Cerrar'}
              </button>
            </Autorizado>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─────────────────────────── nuevo asiento ─────────────────────────── */

interface LineaForm {
  cuenta: string;
  debe: string;
  haber: string;
  concepto: string;
}

const lineaVacia = (): LineaForm => ({
  cuenta: '',
  debe: '',
  haber: '',
  concepto: '',
});

function aNumero(v: string): number {
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function NuevoAsientoModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [fecha, setFecha] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [concepto, setConcepto] = useState('');
  const [lineas, setLineas] = useState<LineaForm[]>([
    lineaVacia(),
    lineaVacia(),
  ]);
  // Una clave por intento de envío: un doble clic o un reintento no duplica el asiento.
  const clave = useRef<string>(nuevoUuid());
  const qc = useQueryClient();
  const toast = useToast();
  const avisarError = useAvisarError();

  const importes = lineas.map((l) => ({
    debe: aNumero(l.debe),
    haber: aNumero(l.haber),
  }));
  const totales = totalesAsiento(importes);
  const error = errorCuadre(importes);

  const m = useMutation({
    mutationFn: () =>
      contabilidadApi.crearAsiento(
        {
          fecha,
          concepto: concepto.trim(),
          lineas: lineas.map((l, i) => ({
            cuenta: l.cuenta.trim(),
            debe: importes[i].debe,
            haber: importes[i].haber,
            concepto: l.concepto.trim() || undefined,
          })),
        },
        clave.current,
      ),
    onSuccess: (a) => {
      toast(`Asiento ${a.numero}/${a.ejercicio} contabilizado`);
      clave.current = nuevoUuid();
      setConcepto('');
      setLineas([lineaVacia(), lineaVacia()]);
      void qc.invalidateQueries({ queryKey: ['contabilidad'] });
      onClose();
    },
    onError: (e) => avisarError(e),
  });

  const cambiar = (i: number, campo: keyof LineaForm, valor: string) =>
    setLineas((ls) =>
      ls.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)),
    );

  return (
    <Modal open={open} title="Nuevo asiento manual" wide onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (m.isPending || error || !concepto.trim()) return;
          m.mutate();
        }}
      >
        <div className="mb-3 grid gap-3 sm:grid-cols-[10rem_1fr]">
          <div>
            <label className={labelCls} htmlFor="asiento-fecha">
              Fecha
            </label>
            <input
              id="asiento-fecha"
              type="date"
              className={fieldCls}
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              required
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="asiento-concepto">
              Concepto
            </label>
            <input
              id="asiento-concepto"
              className={fieldCls}
              value={concepto}
              maxLength={240}
              onChange={(e) => setConcepto(e.target.value)}
              required
            />
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-gray-500">
            <tr>
              <th className="py-1">Cuenta</th>
              <th className="py-1">Concepto (opcional)</th>
              <th className="py-1 text-right">Debe</th>
              <th className="py-1 text-right">Haber</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={i}>
                <td className="py-1 pr-2">
                  <input
                    aria-label={`Cuenta línea ${i + 1}`}
                    className={`${inputCls} w-24 tabular-nums`}
                    inputMode="numeric"
                    value={l.cuenta}
                    onChange={(e) => cambiar(i, 'cuenta', e.target.value)}
                    required
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    aria-label={`Concepto línea ${i + 1}`}
                    className={`${inputCls} w-full`}
                    value={l.concepto}
                    onChange={(e) => cambiar(i, 'concepto', e.target.value)}
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    aria-label={`Debe línea ${i + 1}`}
                    className={`${inputCls} w-28 text-right tabular-nums`}
                    inputMode="decimal"
                    value={l.debe}
                    onChange={(e) => cambiar(i, 'debe', e.target.value)}
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    aria-label={`Haber línea ${i + 1}`}
                    className={`${inputCls} w-28 text-right tabular-nums`}
                    inputMode="decimal"
                    value={l.haber}
                    onChange={(e) => cambiar(i, 'haber', e.target.value)}
                  />
                </td>
                <td className="py-1">
                  {lineas.length > 2 && (
                    <button
                      type="button"
                      className={`${btnGhostCls} text-xs`}
                      aria-label={`Quitar línea ${i + 1}`}
                      onClick={() =>
                        setLineas((ls) => ls.filter((_, j) => j !== i))
                      }
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td colSpan={2} className="py-2">
                <button
                  type="button"
                  className={`${btnGhostCls} text-xs`}
                  onClick={() => setLineas((ls) => [...ls, lineaVacia()])}
                >
                  + Añadir línea
                </button>
              </td>
              <td className="py-2 text-right tabular-nums">
                {formatEur(totales.debe)}
              </td>
              <td className="py-2 text-right tabular-nums">
                {formatEur(totales.haber)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
        {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnGhostCls} onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            className={btnPrimaryCls}
            disabled={m.isPending || error !== null || !concepto.trim()}
          >
            {m.isPending ? 'Contabilizando…' : 'Contabilizar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
