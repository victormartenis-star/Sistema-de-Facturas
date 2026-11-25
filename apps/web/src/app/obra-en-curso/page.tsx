'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  ESTADO_WIP_LABELS,
  type PropuestaWipDto,
  type WipDto,
} from '@erp/shared';
import { formatDate, formatEur, wipApi } from '@/lib/api';
import { nuevoUuid } from '@/lib/api-error';
import { usePermisos } from '@/lib/permisos';
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
} from '@/components/ui';
import { ProvisionPerdidasPanel } from './provision-perdidas-panel';

function mesAnterior(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

function conSigno(n: number) {
  return (
    <span className={n < 0 ? 'text-red-700' : undefined}>{formatEur(n)}</span>
  );
}

/** Invalida el WIP y la contabilidad tras una mutación. */
function useRefrescar() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['wip'] });
    void qc.invalidateQueries({ queryKey: ['contabilidad'] });
  };
}

export default function ObraEnCursoPage() {
  const [periodo, setPeriodo] = useState(mesAnterior);
  const [anulando, setAnulando] = useState<WipDto | null>(null);
  const { can } = usePermisos();
  const cierra = can('cambiarEstado', 'contabilidad');
  const clave = useRef(nuevoUuid());
  const toast = useToast();
  const avisarError = useAvisarError();
  const refrescar = useRefrescar();

  const propuesta = useQuery({
    queryKey: ['wip', 'propuesta', periodo],
    queryFn: () => wipApi.propuesta(periodo),
    enabled: /^\d{4}-\d{2}$/.test(periodo),
  });
  const cierres = useQuery({
    queryKey: ['wip', 'cierres', periodo],
    queryFn: () => wipApi.listar({ periodo }),
    enabled: /^\d{4}-\d{2}$/.test(periodo),
  });
  const unaObra = useMutation({
    mutationFn: (o: PropuestaWipDto) =>
      wipApi.contabilizar(periodo, o.projectId, clave.current),
    onSuccess: (w) => {
      clave.current = nuevoUuid();
      toast(
        `Obra en curso de ${w.codigo} contabilizada (${formatEur(w.regularizacion)})`,
      );
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const todas = useMutation({
    mutationFn: () => wipApi.cierre(periodo, clave.current),
    onSuccess: (r) => {
      clave.current = nuevoUuid();
      toast(
        `${r.contabilizados} obras contabilizadas (${formatEur(r.regularizacion)})` +
          (r.omitidos.length
            ? ` · ${r.omitidos.length} omitidas: ${r.omitidos[0].motivo}`
            : ''),
        r.omitidos.length ? 'error' : 'success',
      );
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const ocupado = unaObra.isPending || todas.isPending;
  const filas = propuesta.data ?? [];
  const pendientes = filas.filter((f) => !f.contabilizado);

  return (
    <div>
      <PageHeader
        title="Obra en curso (cierre)"
        subtitle="Grado de avance: producción ejecutada frente a facturado a origen. Cada cierre contabiliza solo la variación (4309 / 4389 contra 7050 de la obra)."
        count={filas.length}
      >
        <label className="flex items-center gap-1 text-xs text-gray-600">
          Periodo
          <input
            type="month"
            className={inputCls}
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
          />
        </label>
        {cierra && (
          <button
            type="button"
            className={btnPrimaryCls}
            disabled={ocupado || pendientes.length === 0}
            onClick={() => {
              if (!ocupado) todas.mutate();
            }}
          >
            {todas.isPending ? 'Cerrando…' : 'Cerrar el periodo'}
          </button>
        )}
      </PageHeader>

      {propuesta.isError && (
        <ErrorBanner message={(propuesta.error as Error).message} />
      )}
      {propuesta.isLoading && <TableSkeleton />}
      {propuesta.isSuccess && filas.length === 0 && (
        <EmptyState icon={<IconCalculator />} title="Sin obra en curso">
          Ninguna obra tiene producción, facturación ni obra en curso previa en
          este periodo.
        </EmptyState>
      )}
      {filas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">Obra</th>
                <th className="px-3 py-2 text-right">Producción a origen</th>
                <th className="px-3 py-2 text-right">Facturado a origen</th>
                <th className="px-3 py-2 text-right">Obra en curso</th>
                <th className="px-3 py-2 text-right">Anterior</th>
                <th className="px-3 py-2 text-right">A contabilizar</th>
                <th className="px-3 py-2 text-right">Margen reconocido</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filas.map((o) => (
                <tr key={o.projectId} className="border-t border-gray-100">
                  <td className="px-3 py-2">
                    <span className="font-medium">{o.codigo}</span>{' '}
                    <span className="text-gray-600">{o.nombre}</span>
                    {o.ultimoPeriodo && (
                      <span className="block text-xs text-gray-500">
                        Último cierre {o.ultimoPeriodo}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(o.produccion)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(o.facturado)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {conSigno(o.wip)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {conSigno(o.wipAnterior)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {conSigno(o.regularizacion)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {conSigno(o.margenReconocido)}
                    {o.margenReconocidoPct !== null && (
                      <span className="block text-xs text-gray-500">
                        {o.margenReconocidoPct} %
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {o.contabilizado ? (
                      <span className="text-xs text-emerald-700">
                        Contabilizado
                      </span>
                    ) : (
                      cierra && (
                        <button
                          type="button"
                          className={btnGhostCls}
                          disabled={ocupado}
                          onClick={() => {
                            if (!ocupado) unaObra.mutate(o);
                          }}
                        >
                          Contabilizar
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">Cierres del periodo</h2>
        {cierres.isError && (
          <ErrorBanner message={(cierres.error as Error).message} />
        )}
        {(cierres.data ?? []).length === 0 ? (
          <p className="rounded-xl border bg-white p-3 text-sm text-gray-500">
            Sin cierres en {periodo}.
          </p>
        ) : (
          <ul className="divide-y rounded-xl border bg-white text-sm shadow-sm">
            {(cierres.data ?? []).map((w) => (
              <li
                key={w.id}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <span
                  className={
                    w.estado === 'anulado' ? 'text-gray-400 line-through' : ''
                  }
                >
                  {w.codigo} · {formatDate(w.fechaCierre)} · obra en curso{' '}
                  {formatEur(w.wip)} · contabilizado{' '}
                  {formatEur(w.regularizacion)}
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-xs text-gray-500">
                    {ESTADO_WIP_LABELS[w.estado]}
                    {w.motivoAnulacion && ` · ${w.motivoAnulacion}`}
                  </span>
                  {cierra && w.estado === 'contabilizado' && (
                    <button
                      type="button"
                      className="text-xs text-red-700 hover:underline"
                      onClick={() => setAnulando(w)}
                    >
                      Anular
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ProvisionPerdidasPanel periodo={periodo} />

      <AnularModal w={anulando} onClose={() => setAnulando(null)} />
    </div>
  );
}

function AnularModal({
  w,
  onClose,
}: {
  w: WipDto | null;
  onClose: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const clave = useRef(nuevoUuid());
  const { can } = usePermisos();
  const toast = useToast();
  const avisarError = useAvisarError();
  const refrescar = useRefrescar();
  const m = useMutation({
    mutationFn: () =>
      wipApi.anular(w!.id, motivo.trim(), w!.version, clave.current),
    onSuccess: (r) => {
      clave.current = nuevoUuid();
      toast(`Cierre de ${r.codigo} (${r.periodo}) anulado por contra-asiento`);
      setMotivo('');
      refrescar();
      onClose();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  return (
    <Modal
      open={w !== null}
      title={w ? `Anular el cierre ${w.periodo} de ${w.codigo}` : ''}
      onClose={onClose}
    >
      {w && (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (can('cambiarEstado', 'contabilidad') && !m.isPending)
              m.mutate();
          }}
        >
          <p className="text-sm text-gray-600">
            Se contabiliza el contra-asiento con la fecha del cierre (su periodo
            debe estar abierto). Solo se anula el último cierre de la obra.
          </p>
          <div>
            <label className={labelCls} htmlFor="wip-motivo">
              Motivo
            </label>
            <input
              id="wip-motivo"
              className={fieldCls}
              value={motivo}
              minLength={3}
              maxLength={240}
              required
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className={btnGhostCls} onClick={onClose}>
              Cancelar
            </button>
            <button
              type="submit"
              className={btnPrimaryCls}
              disabled={m.isPending}
            >
              {m.isPending ? 'Anulando…' : 'Anular cierre'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
