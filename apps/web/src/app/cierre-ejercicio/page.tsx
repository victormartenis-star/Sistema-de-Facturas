'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  ESTADO_CIERRE_EJERCICIO_LABELS,
  type AsientoCierrePropuestoDto,
} from '@erp/shared';
import {
  cierreEjercicioApi,
  conciliacionApi,
  formatDate,
  formatEur,
} from '@/lib/api';
import { nuevoUuid } from '@/lib/api-error';
import { crearGuardaEnvio } from '@/lib/envio-unico';
import { usePermisos } from '@/lib/permisos';
import { Autorizado } from '@/components/autorizado';
import { KpiCard } from '@/components/kpi-card';
import { useAvisarError, useToast } from '@/components/toast';
import {
  ErrorBanner,
  PageHeader,
  TableSkeleton,
  btnGhostCls,
  btnPrimaryCls,
  fieldCls,
  inputCls,
  labelCls,
} from '@/components/ui';

function TablaAsiento({
  titulo,
  a,
}: {
  titulo: string;
  a: AsientoCierrePropuestoDto;
}) {
  return (
    <section className="rounded-xl border bg-white shadow-sm">
      <header className="flex items-center justify-between border-b px-3 py-2">
        <h3 className="text-sm font-semibold">{titulo}</h3>
        <span className="text-xs text-gray-500">
          {formatDate(a.fecha)} · {a.lineas.length} líneas ·{' '}
          {formatEur(a.total)}
        </span>
      </header>
      {a.lineas.length === 0 ? (
        <p className="px-3 py-2 text-xs text-gray-500">Sin líneas.</p>
      ) : (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-1">Cuenta</th>
                <th className="px-3 py-1">Obra</th>
                <th className="px-3 py-1 text-right">Debe</th>
                <th className="px-3 py-1 text-right">Haber</th>
              </tr>
            </thead>
            <tbody>
              {a.lineas.map((l, i) => (
                <tr
                  key={`${l.cuenta}-${l.projectId}-${i}`}
                  className="border-t border-gray-100"
                >
                  <td className="px-3 py-1">
                    <span className="font-medium tabular-nums">{l.cuenta}</span>{' '}
                    <span className="text-gray-500">
                      {l.nombreCuenta ?? ''}
                    </span>
                  </td>
                  <td className="px-3 py-1 text-xs text-gray-500">
                    {l.projectId ? 'Imputada' : ''}
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums">
                    {Number(l.debe) ? formatEur(Number(l.debe)) : ''}
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums">
                    {Number(l.haber) ? formatEur(Number(l.haber)) : ''}
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
 * Cierre y apertura del ejercicio (PGC): vista previa de la regularización
 * (6 y 7 contra 129), el cierre del balance y la apertura del siguiente;
 * cerrar bloquea el ejercicio. Solo admin y gerente cierran o revierten.
 */
export default function CierreEjercicioPage() {
  const [ejercicio, setEjercicio] = useState(
    () => new Date().getFullYear() - 1,
  );
  const [confirmado, setConfirmado] = useState(false);
  const [motivo, setMotivo] = useState('');
  const clave = useRef(nuevoUuid());
  const [guarda] = useState(crearGuardaEnvio);
  const { can } = usePermisos();
  const qc = useQueryClient();
  const toast = useToast();
  const avisarError = useAvisarError();
  const valido = ejercicio >= 2000 && ejercicio <= 2100;

  const propuesta = useQuery({
    queryKey: ['cierre-ejercicio', 'propuesta', ejercicio],
    queryFn: () => cierreEjercicioApi.propuesta(ejercicio),
    enabled: valido,
  });
  const historial = useQuery({
    queryKey: ['cierre-ejercicio', 'lista'],
    queryFn: () => cierreEjercicioApi.listar(),
  });
  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: ['cierre-ejercicio'] });
    void qc.invalidateQueries({ queryKey: ['contabilidad'] });
  };
  const exito = (texto: string) => {
    clave.current = nuevoUuid();
    setConfirmado(false);
    setMotivo('');
    toast(texto);
    refrescar();
  };
  const cerrar = useMutation({
    mutationFn: () => cierreEjercicioApi.cerrar(ejercicio, clave.current),
    onSuccess: (c) =>
      exito(
        `Ejercicio ${c.ejercicio} cerrado (resultado ${formatEur(c.resultado)})`,
      ),
    onError: (e) => avisarError(e, refrescar),
  });
  const revertir = useMutation({
    mutationFn: (version: number) =>
      cierreEjercicioApi.revertir(
        ejercicio,
        motivo.trim(),
        version,
        clave.current,
      ),
    onSuccess: (c) => exito(`Cierre de ${c.ejercicio} revertido`),
    onError: (e) => avisarError(e, refrescar),
  });
  const ocupado = cerrar.isPending || revertir.isPending;
  useEffect(() => {
    if (!ocupado) guarda.liberar();
  }, [ocupado, guarda]);

  const p = propuesta.data;
  const vigente = p?.cierreVigente ?? null;

  return (
    <div>
      <PageHeader
        title="Cierre del ejercicio"
        subtitle="Regularización de gastos e ingresos contra 129, cierre del balance y apertura del ejercicio siguiente (PGC)."
      >
        <label className="flex items-center gap-1 text-xs text-gray-600">
          Ejercicio
          <input
            type="number"
            min={2000}
            max={2100}
            className={`${inputCls} w-24`}
            value={ejercicio}
            onChange={(e) => {
              setEjercicio(Number(e.target.value));
              setConfirmado(false);
            }}
          />
        </label>
      </PageHeader>

      {propuesta.isError && (
        <ErrorBanner message={(propuesta.error as Error).message} />
      )}
      {propuesta.isLoading && <TableSkeleton />}
      {p && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            <KpiCard etiqueta="Ingresos (7)" valor={formatEur(p.ingresos)} />
            <KpiCard etiqueta="Gastos (6)" valor={formatEur(p.gastos)} />
            <KpiCard
              etiqueta="Resultado (129)"
              valor={formatEur(p.resultado)}
              tono={
                p.resultado < 0 ? 'malo' : p.resultado > 0 ? 'bueno' : 'neutro'
              }
            />
            <KpiCard
              etiqueta="Estado"
              valor={
                vigente ? ESTADO_CIERRE_EJERCICIO_LABELS.cerrado : 'Abierto'
              }
              tono={vigente ? 'aviso' : 'neutro'}
              detalle={
                vigente
                  ? `Cerrado el ${formatDate(vigente.cerradoEn.slice(0, 10))}`
                  : undefined
              }
            />
          </div>

          {!vigente && p.impedimentos.length > 0 && (
            <ul className="mb-4 space-y-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              {p.impedimentos.map((i) => (
                <li key={i.code}>
                  {i.message} <span className="text-xs">({i.code})</span>
                </li>
              ))}
            </ul>
          )}

          <Autorizado accion="cambiarEstado" recurso="cierre_ejercicio">
            {!vigente ? (
              <form
                className="mb-6 flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (
                    !can('cambiarEstado', 'cierre_ejercicio') ||
                    !confirmado ||
                    p.impedimentos.length > 0 ||
                    ocupado ||
                    !guarda.intentar()
                  )
                    return;
                  cerrar.mutate();
                }}
              >
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={confirmado}
                    onChange={(e) => setConfirmado(e.target.checked)}
                  />
                  He revisado los asientos: cerrar {ejercicio} bloquea el
                  ejercicio y abre {ejercicio + 1}.
                </label>
                <button
                  type="submit"
                  className={btnPrimaryCls}
                  disabled={!confirmado || ocupado || p.impedimentos.length > 0}
                >
                  {cerrar.isPending ? 'Cerrando…' : `Cerrar ${ejercicio}`}
                </button>
              </form>
            ) : (
              <form
                className="mb-6 grid gap-3 rounded-lg bg-gray-50 p-3 sm:grid-cols-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (
                    !can('cambiarEstado', 'cierre_ejercicio') ||
                    motivo.trim().length < 3 ||
                    ocupado ||
                    !guarda.intentar()
                  )
                    return;
                  revertir.mutate(vigente.version);
                }}
              >
                <div className="sm:col-span-3">
                  <label className={labelCls} htmlFor="rev-motivo">
                    Motivo de la reversión (contra-asientos de los tres
                    asientos)
                  </label>
                  <input
                    id="rev-motivo"
                    className={fieldCls}
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    minLength={3}
                    maxLength={240}
                    required
                  />
                </div>
                <div className="flex items-end justify-end">
                  <button
                    type="submit"
                    className={btnGhostCls}
                    disabled={ocupado || motivo.trim().length < 3}
                  >
                    {revertir.isPending ? 'Revirtiendo…' : 'Revertir el cierre'}
                  </button>
                </div>
              </form>
            )}
          </Autorizado>

          <div className="grid gap-4 lg:grid-cols-3">
            <TablaAsiento titulo="Regularización" a={p.regularizacion} />
            <TablaAsiento titulo="Cierre" a={p.cierre} />
            <TablaAsiento titulo={`Apertura ${ejercicio + 1}`} a={p.apertura} />
          </div>
        </>
      )}

      {valido && <AplicacionResultado ejercicio={ejercicio} />}
      {valido && <CuentasAnuales ejercicio={ejercicio} />}

      <h2 className="mt-8 mb-2 text-sm font-semibold">Historial de cierres</h2>
      {historial.isError && (
        <ErrorBanner message={(historial.error as Error).message} />
      )}
      {(historial.data ?? []).length === 0 ? (
        <p className="text-sm text-gray-500">Ningún ejercicio cerrado.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {(historial.data ?? []).map((c) => (
            <li key={c.id}>
              <span className="font-medium">{c.ejercicio}</span> ·{' '}
              {ESTADO_CIERRE_EJERCICIO_LABELS[c.estado]} · resultado{' '}
              {formatEur(c.resultado)} · {formatDate(c.cerradoEn.slice(0, 10))}
              {c.motivoReversion && ` · revertido: ${c.motivoReversion}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Aplicación del resultado (129) del ejercicio cerrado: reparto entre los
 * destinos admitidos (reserva legal mínima indicada), contabilizado en el
 * ejercicio siguiente. Solo admin y gerente.
 */
function AplicacionResultado({ ejercicio }: { ejercicio: number }) {
  const [importes, setImportes] = useState<Record<string, string>>({});
  const [fecha, setFecha] = useState(`${ejercicio + 1}-06-30`);
  const [acuerdo, setAcuerdo] = useState('');
  const [fueraDePlazo, setFueraDePlazo] = useState(false);
  const [motivo, setMotivo] = useState('');
  const clave = useRef(nuevoUuid());
  const [guarda] = useState(crearGuardaEnvio);
  const { can } = usePermisos();
  const qc = useQueryClient();
  const toast = useToast();
  const avisarError = useAvisarError();
  const prop = useQuery({
    queryKey: ['cierre-ejercicio', 'aplicacion', ejercicio],
    queryFn: () => cierreEjercicioApi.aplicacion(ejercicio),
  });
  useEffect(() => {
    setFecha(`${ejercicio + 1}-06-30`);
    setImportes({});
  }, [ejercicio]);
  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: ['cierre-ejercicio'] });
    void qc.invalidateQueries({ queryKey: ['contabilidad'] });
  };
  const exito = (texto: string) => {
    clave.current = nuevoUuid();
    setImportes({});
    setAcuerdo('');
    setFueraDePlazo(false);
    setMotivo('');
    toast(texto);
    refrescar();
  };
  const aplicar = useMutation({
    mutationFn: () =>
      cierreEjercicioApi.aplicarResultado(
        ejercicio,
        {
          fecha,
          acuerdo: acuerdo.trim(),
          ...(fueraDePlazo ? { aceptarFueraDePlazo: true } : {}),
          reparto: Object.entries(importes)
            .filter(([, v]) => v.trim() && Number(v.replace(',', '.')) > 0)
            .map(([cuenta, v]) => ({
              cuenta,
              importe: Number(v.trim().replace(',', '.')),
            })),
        },
        clave.current,
      ),
    onSuccess: () => exito(`Resultado de ${ejercicio} aplicado`),
    onError: (e) => avisarError(e, refrescar),
  });
  const anular = useMutation({
    mutationFn: (version: number) =>
      cierreEjercicioApi.anularAplicacion(
        ejercicio,
        motivo.trim(),
        version,
        clave.current,
      ),
    onSuccess: () => exito(`Aplicación del resultado de ${ejercicio} anulada`),
    onError: (e) => avisarError(e, refrescar),
  });
  const ocupado = aplicar.isPending || anular.isPending;
  useEffect(() => {
    if (!ocupado) guarda.liberar();
  }, [ocupado, guarda]);

  const p = prop.data;
  if (!p || !p.cerrado || p.resultado === null) return null;
  const vigente = p.aplicacionVigente;
  const repartido = Object.values(importes).reduce(
    (t, v) => t + Math.round((Number(v.replace(',', '.')) || 0) * 100),
    0,
  );
  const objetivo = Math.round(Math.abs(p.resultado) * 100);

  return (
    <section className="mt-8 rounded-xl border bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold">
        Aplicación del resultado de {ejercicio} ({formatEur(p.resultado)})
      </h2>
      <p className="mb-3 text-xs text-gray-500">
        Capital {formatEur(p.capital)} · reserva legal{' '}
        {formatEur(p.reservaLegal)} · reservas voluntarias{' '}
        {formatEur(p.reservasVoluntarias)} · pérdidas pendientes{' '}
        {formatEur(p.negativosAnteriores)}
        {p.resultado > 0 &&
          ` · reserva legal mínima ${formatEur(p.reservaLegalMinima)} · dividendo máximo ${formatEur(p.dividendoMaximo)}`}
        {` · patrimonio neto ${formatEur(p.patrimonioNeto)} · plazo de la junta hasta ${formatDate(p.fechaLimite)}`}
      </p>
      {p.situacionPatrimonial.bajoCapital && (
        <p className="mb-3 rounded bg-amber-50 p-2 text-xs text-amber-800">
          El patrimonio neto está por debajo del capital social: no se pueden
          repartir dividendos que lo reduzcan (art. 273.2 LSC).
          {p.situacionPatrimonial.desequilibrio &&
            ' Además es inferior a la mitad del capital: causa de disolución salvo que se reequilibre (art. 363 LSC).'}
        </p>
      )}
      {prop.isError && <ErrorBanner message={(prop.error as Error).message} />}
      {vigente ? (
        <>
          <ul className="mb-3 space-y-1 text-sm">
            {vigente.reparto.map((r) => (
              <li key={r.cuenta}>
                {r.cuenta} {r.nombre}:{' '}
                <span className="tabular-nums">{formatEur(r.importe)}</span>
              </li>
            ))}
            <li className="text-xs text-gray-500">
              {formatDate(vigente.fecha)} · {vigente.acuerdo}
            </li>
          </ul>
          <Autorizado accion="anular" recurso="cierre_ejercicio">
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (
                  !can('anular', 'cierre_ejercicio') ||
                  motivo.trim().length < 3 ||
                  ocupado ||
                  !guarda.intentar()
                )
                  return;
                anular.mutate(vigente.version);
              }}
            >
              <div className="min-w-64 flex-1">
                <label className={labelCls} htmlFor="apl-motivo">
                  Motivo de la anulación
                </label>
                <input
                  id="apl-motivo"
                  className={fieldCls}
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  minLength={3}
                  maxLength={240}
                  required
                />
              </div>
              <button
                type="submit"
                className={btnGhostCls}
                disabled={ocupado || motivo.trim().length < 3}
              >
                {anular.isPending ? 'Anulando…' : 'Anular la aplicación'}
              </button>
            </form>
          </Autorizado>
        </>
      ) : (
        <Autorizado
          accion="cambiarEstado"
          recurso="cierre_ejercicio"
          alternativa={
            <p className="text-sm text-gray-500">
              Resultado pendiente de aplicar.
            </p>
          }
        >
          <form
            className="grid gap-3 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (
                !can('cambiarEstado', 'cierre_ejercicio') ||
                repartido !== objetivo ||
                acuerdo.trim().length < 3 ||
                ocupado ||
                !guarda.intentar()
              )
                return;
              aplicar.mutate();
            }}
          >
            {p.destinos.map((dst) => (
              <div key={dst.cuenta}>
                <label className={labelCls} htmlFor={`apl-${dst.cuenta}`}>
                  {dst.cuenta} {dst.nombre}
                </label>
                <input
                  id={`apl-${dst.cuenta}`}
                  inputMode="decimal"
                  className={fieldCls}
                  value={importes[dst.cuenta] ?? ''}
                  onChange={(e) =>
                    setImportes((v) => ({ ...v, [dst.cuenta]: e.target.value }))
                  }
                />
              </div>
            ))}
            <div>
              <label className={labelCls} htmlFor="apl-fecha">
                Fecha del acuerdo
              </label>
              <input
                id="apl-fecha"
                type="date"
                className={fieldCls}
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                required
              />
              {fecha > p.fechaLimite && (
                <label className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                  <input
                    type="checkbox"
                    checked={fueraDePlazo}
                    onChange={(e) => setFueraDePlazo(e.target.checked)}
                  />
                  Fuera del plazo de seis meses: confirmar
                </label>
              )}
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="apl-acuerdo">
                Acuerdo (acta de la junta)
              </label>
              <input
                id="apl-acuerdo"
                className={fieldCls}
                value={acuerdo}
                onChange={(e) => setAcuerdo(e.target.value)}
                minLength={3}
                maxLength={240}
                required
              />
            </div>
            <div className="flex items-center justify-between gap-2 sm:col-span-3">
              <p
                className={`text-xs ${repartido === objetivo ? 'text-emerald-700' : 'text-amber-700'}`}
              >
                Repartido {formatEur(repartido / 100)} de{' '}
                {formatEur(objetivo / 100)}
              </p>
              <button
                type="submit"
                className={btnPrimaryCls}
                disabled={
                  ocupado || repartido !== objetivo || acuerdo.trim().length < 3
                }
              >
                {aplicar.isPending ? 'Aplicando…' : 'Aplicar el resultado'}
              </button>
            </div>
          </form>
        </Autorizado>
      )}
    </section>
  );
}

/** Cuentas anuales: balance por masas y PyG (saldos antes del cierre). */
function CuentasAnuales({ ejercicio }: { ejercicio: number }) {
  const ca = useQuery({
    queryKey: ['cierre-ejercicio', 'cuentas-anuales', ejercicio],
    queryFn: () => cierreEjercicioApi.cuentasAnuales(ejercicio),
  });
  const c = ca.data;
  const masa = (
    titulo: string,
    m: {
      total: number;
      cuentas: { cuenta: string; nombre: string; importe: number }[];
    },
  ) => (
    <details className="text-sm">
      <summary className="flex cursor-pointer justify-between gap-2 py-0.5">
        <span>{titulo}</span>
        <span className="font-semibold tabular-nums">{formatEur(m.total)}</span>
      </summary>
      <ul className="ml-4 text-xs text-gray-600">
        {m.cuentas.map((x) => (
          <li key={x.cuenta} className="flex justify-between gap-2">
            <span>
              {x.cuenta} {x.nombre}
            </span>
            <span className="tabular-nums">{formatEur(x.importe)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-sm font-semibold">
        Cuentas anuales {ejercicio}
        {c && !c.balance.cuadra && (
          <span className="ml-2 text-xs text-red-700">
            (el balance no cuadra)
          </span>
        )}
      </h2>
      {ca.isError && <ErrorBanner message={(ca.error as Error).message} />}
      {ca.isLoading && <TableSkeleton rows={4} />}
      {c && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border bg-white p-3 shadow-sm">
            <p className="mb-1 text-xs font-semibold uppercase text-gray-500">
              Activo
            </p>
            {masa('Activo no corriente', c.balance.activoNoCorriente)}
            {masa('Activo corriente', c.balance.activoCorriente)}
            <p className="mt-1 flex justify-between border-t pt-1 text-sm font-semibold">
              <span>Total activo</span>
              <span className="tabular-nums">
                {formatEur(c.balance.totalActivo)}
              </span>
            </p>
          </div>
          <div className="rounded-xl border bg-white p-3 shadow-sm">
            <p className="mb-1 text-xs font-semibold uppercase text-gray-500">
              Patrimonio neto y pasivo
            </p>
            {masa('Patrimonio neto', c.balance.patrimonioNeto)}
            <p className="ml-4 text-xs text-gray-600">
              incluye resultado del ejercicio{' '}
              {formatEur(c.balance.resultadoEjercicio)}
            </p>
            {masa('Pasivo no corriente', c.balance.pasivoNoCorriente)}
            {masa('Pasivo corriente', c.balance.pasivoCorriente)}
            <p className="mt-1 flex justify-between border-t pt-1 text-sm font-semibold">
              <span>Total PN y pasivo</span>
              <span className="tabular-nums">
                {formatEur(c.balance.totalPatrimonioNetoYPasivo)}
              </span>
            </p>
          </div>
          <div className="rounded-xl border bg-white p-3 shadow-sm">
            <p className="mb-1 text-xs font-semibold uppercase text-gray-500">
              Pérdidas y ganancias
            </p>
            {c.pyg.partidas
              .filter((x) => x.importe !== 0)
              .map((x) => (
                <p key={x.clave} className="flex justify-between gap-2 text-sm">
                  <span className="text-gray-600">{x.etiqueta}</span>
                  <span className="tabular-nums">{formatEur(x.importe)}</span>
                </p>
              ))}
            <p className="mt-1 flex justify-between border-t pt-1 text-sm">
              <span>Resultado de explotación</span>
              <span className="tabular-nums">
                {formatEur(c.pyg.resultadoExplotacion)}
              </span>
            </p>
            <p className="flex justify-between text-sm">
              <span>Resultado financiero</span>
              <span className="tabular-nums">
                {formatEur(c.pyg.resultadoFinanciero)}
              </span>
            </p>
            <p className="flex justify-between text-sm font-semibold">
              <span>Resultado del ejercicio</span>
              <span className="tabular-nums">{formatEur(c.pyg.resultado)}</span>
            </p>
          </div>
        </div>
      )}
      {c && (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="overflow-x-auto rounded-xl border bg-white p-3 shadow-sm lg:col-span-2">
            <p className="mb-1 text-xs font-semibold uppercase text-gray-500">
              Estado de cambios en el patrimonio neto
              {!c.ecpn.cuadraConBalance && (
                <span className="ml-2 text-red-700">
                  (no cuadra con el balance)
                </span>
              )}
            </p>
            <table className="w-full text-xs">
              <thead className="text-left text-gray-500">
                <tr>
                  <th className="py-1" />
                  <th className="py-1 text-right">Capital</th>
                  <th className="py-1 text-right">Reservas</th>
                  <th className="py-1 text-right">Rdos. anteriores</th>
                  <th className="py-1 text-right">Rdo. ejercicio</th>
                  <th className="py-1 text-right">Otros</th>
                  <th className="py-1 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {c.ecpn.filas.map((f) => (
                  <tr
                    key={f.clave}
                    className={`border-t border-gray-100 ${f.clave === 'saldoFinal' || f.clave === 'saldoInicial' ? 'font-semibold' : ''}`}
                  >
                    <td className="py-1 pr-2">{f.etiqueta}</td>
                    {(
                      [
                        'capital',
                        'reservas',
                        'resultadosAnteriores',
                        'resultadoEjercicio',
                        'otros',
                      ] as const
                    ).map((col) => (
                      <td key={col} className="py-1 text-right tabular-nums">
                        {f.importes[col] === 0
                          ? ''
                          : formatEur(f.importes[col])}
                      </td>
                    ))}
                    <td className="py-1 text-right font-semibold tabular-nums">
                      {formatEur(f.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-xl border bg-white p-3 shadow-sm">
            <p className="mb-1 text-xs font-semibold uppercase text-gray-500">
              Estado de flujos de efectivo
              {!c.efe.cuadra && (
                <span className="ml-2 text-red-700">(no cuadra)</span>
              )}
            </p>
            {(
              [
                ['Resultado del ejercicio', c.efe.explotacion.resultado],
                [
                  'Ajustes (amortizaciones, provisiones)',
                  c.efe.explotacion.ajustes,
                ],
                [
                  'Cambios en el capital corriente',
                  c.efe.explotacion.capitalCorriente,
                ],
              ] as const
            ).map(([e, v]) => (
              <p
                key={e}
                className="flex justify-between gap-2 text-xs text-gray-600"
              >
                <span>{e}</span>
                <span className="tabular-nums">{formatEur(v)}</span>
              </p>
            ))}
            <p className="flex justify-between text-sm">
              <span>Flujos de explotación</span>
              <span className="tabular-nums">
                {formatEur(c.efe.explotacion.total)}
              </span>
            </p>
            <p className="flex justify-between text-sm">
              <span>Flujos de inversión</span>
              <span className="tabular-nums">{formatEur(c.efe.inversion)}</span>
            </p>
            <p className="flex justify-between text-sm">
              <span>Flujos de financiación</span>
              <span className="tabular-nums">
                {formatEur(c.efe.financiacion)}
              </span>
            </p>
            <p className="mt-1 flex justify-between border-t pt-1 text-sm font-semibold">
              <span>Variación del efectivo</span>
              <span className="tabular-nums">
                {formatEur(c.efe.variacionEfectivo)}
              </span>
            </p>
            <p className="text-xs text-gray-500">
              Efectivo inicial {formatEur(c.efe.efectivoInicial)} · final{' '}
              {formatEur(c.efe.efectivoFinal)}
            </p>
          </div>
        </div>
      )}
      <ConciliacionCierre />
    </section>
  );
}

/**
 * Conciliación de cierre auxiliar ↔ mayor (devengos de avales, amortización,
 * obra en curso, provisión por pérdidas). Registrarla deja evidencia.
 */
function ConciliacionCierre() {
  const clave = useRef(nuevoUuid());
  const [guarda] = useState(crearGuardaEnvio);
  const { can } = usePermisos();
  const qc = useQueryClient();
  const toast = useToast();
  const avisarError = useAvisarError();
  const vivo = useQuery({
    queryKey: ['cierre-ejercicio', 'conciliacion'],
    queryFn: () => conciliacionApi.consultar(),
  });
  const historial = useQuery({
    queryKey: ['cierre-ejercicio', 'conciliacion', 'historial'],
    queryFn: () => conciliacionApi.historial(),
  });
  const registrar = useMutation({
    mutationFn: () => conciliacionApi.registrar(clave.current),
    onSuccess: (r) => {
      clave.current = nuevoUuid();
      toast(
        r.cuadra
          ? 'Conciliación registrada: todo cuadra'
          : `Conciliación registrada con ${r.descuadres} descuadre(s)`,
        r.cuadra ? 'success' : 'error',
      );
      void qc.invalidateQueries({
        queryKey: ['cierre-ejercicio', 'conciliacion'],
      });
    },
    onError: (e) => avisarError(e),
  });
  useEffect(() => {
    if (!registrar.isPending) guarda.liberar();
  }, [registrar.isPending, guarda]);
  const c = vivo.data;
  return (
    <div className="mt-4 rounded-xl border bg-white p-3 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase text-gray-500">
          Conciliación auxiliar ↔ mayor
          {c && (
            <span
              className={`ml-2 ${c.cuadra ? 'text-emerald-700' : 'text-red-700'}`}
            >
              {c.cuadra ? 'cuadra' : `${c.descuadres} descuadre(s)`}
            </span>
          )}
        </p>
        <Autorizado accion="cambiarEstado" recurso="contabilidad">
          <button
            type="button"
            className={btnGhostCls}
            disabled={registrar.isPending}
            onClick={() => {
              if (
                !can('cambiarEstado', 'contabilidad') ||
                registrar.isPending ||
                !guarda.intentar()
              )
                return;
              registrar.mutate();
            }}
          >
            {registrar.isPending ? 'Registrando…' : 'Registrar evidencia'}
          </button>
        </Autorizado>
      </div>
      {vivo.isError && <ErrorBanner message={(vivo.error as Error).message} />}
      {c && (
        <table className="w-full text-xs">
          <thead className="text-left text-gray-500">
            <tr>
              <th className="py-1">Partida</th>
              <th className="py-1">Cuentas</th>
              <th className="py-1 text-right">Auxiliar</th>
              <th className="py-1 text-right">Mayor</th>
              <th className="py-1 text-right">Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {c.partidas.map((p) => (
              <tr key={p.clave} className="border-t border-gray-100">
                <td className="py-1">{p.etiqueta}</td>
                <td className="py-1 text-gray-500">{p.cuentas}</td>
                <td className="py-1 text-right tabular-nums">
                  {formatEur(p.auxiliar)}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {formatEur(p.mayor)}
                </td>
                <td
                  className={`py-1 text-right tabular-nums ${p.cuadra ? 'text-emerald-700' : 'font-semibold text-red-700'}`}
                >
                  {formatEur(p.diferencia)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(historial.data ?? []).length > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          Última evidencia: {formatDate(historial.data![0].fecha)} ·{' '}
          {historial.data![0].cuadra
            ? 'cuadraba'
            : `${historial.data![0].descuadres} descuadre(s)`}
        </p>
      )}
    </div>
  );
}
