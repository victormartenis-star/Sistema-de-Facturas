'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  ESTADO_CIERRE_EJERCICIO_LABELS,
  type AsientoCierrePropuestoDto,
} from '@erp/shared';
import { cierreEjercicioApi, formatDate, formatEur } from '@/lib/api';
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
