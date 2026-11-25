'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  ESTADO_WIP_LABELS,
  type PropuestaProvisionPerdidasDto,
  type ProvisionPerdidasDto,
} from '@erp/shared';
import { formatDate, formatEur, provisionPerdidasApi } from '@/lib/api';
import { nuevoUuid } from '@/lib/api-error';
import { usePermisos } from '@/lib/permisos';
import { useAvisarError, useToast } from '@/components/toast';
import {
  ErrorBanner,
  Modal,
  TableSkeleton,
  btnGhostCls,
  btnPrimaryCls,
  fieldCls,
  labelCls,
} from '@/components/ui';

function conSigno(n: number) {
  return (
    <span className={n < 0 ? 'text-emerald-700' : n > 0 ? 'text-red-700' : ''}>
      {formatEur(n)}
    </span>
  );
}

/** Invalida la provisión y la contabilidad tras una mutación. */
function useRefrescar() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['provision-perdidas'] });
    void qc.invalidateQueries({ queryKey: ['contabilidad'] });
  };
}

/**
 * Provisión por pérdidas previstas (contratos onerosos, NRV 14) del periodo:
 * pérdida total = coste estimado al cierre − contrato, menos la ya reconocida
 * por el grado de avance; cada cierre contabiliza solo el ajuste (6954 / 4994
 * o 4994 / 7954).
 */
export function ProvisionPerdidasPanel({ periodo }: { periodo: string }) {
  const [anulando, setAnulando] = useState<ProvisionPerdidasDto | null>(null);
  const { can } = usePermisos();
  const cierra = can('cambiarEstado', 'contabilidad');
  const clave = useRef(nuevoUuid());
  const toast = useToast();
  const avisarError = useAvisarError();
  const refrescar = useRefrescar();
  const valido = /^\d{4}-\d{2}$/.test(periodo);

  const propuesta = useQuery({
    queryKey: ['provision-perdidas', 'propuesta', periodo],
    queryFn: () => provisionPerdidasApi.propuesta(periodo),
    enabled: valido,
  });
  const cierres = useQuery({
    queryKey: ['provision-perdidas', 'cierres', periodo],
    queryFn: () => provisionPerdidasApi.listar({ periodo }),
    enabled: valido,
  });
  const unaObra = useMutation({
    mutationFn: (o: PropuestaProvisionPerdidasDto) =>
      provisionPerdidasApi.contabilizar(periodo, o.projectId, clave.current),
    onSuccess: (p) => {
      clave.current = nuevoUuid();
      toast(
        `Provisión de ${p.codigo} contabilizada (ajuste ${formatEur(p.ajuste)})`,
      );
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const todas = useMutation({
    mutationFn: () => provisionPerdidasApi.cierre(periodo, clave.current),
    onSuccess: (r) => {
      clave.current = nuevoUuid();
      toast(
        `${r.contabilizados} provisiones contabilizadas (ajuste ${formatEur(r.ajuste)})` +
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
    <section className="mt-8">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">
            Provisión por pérdidas previstas
          </h2>
          <p className="text-xs text-gray-500">
            Contratos onerosos: la pérdida prevista se reconoce entera; se
            provisiona la parte que el grado de avance aún no ha llevado a
            resultados (6954 / 4994; exceso 4994 / 7954).
          </p>
        </div>
        {cierra && (
          <button
            type="button"
            className={btnPrimaryCls}
            disabled={ocupado || pendientes.length === 0}
            onClick={() => {
              if (!ocupado && can('cambiarEstado', 'contabilidad'))
                todas.mutate();
            }}
          >
            {todas.isPending ? 'Provisionando…' : 'Provisionar el periodo'}
          </button>
        )}
      </div>

      {propuesta.isError && (
        <ErrorBanner message={(propuesta.error as Error).message} />
      )}
      {propuesta.isLoading && <TableSkeleton />}
      {propuesta.isSuccess && filas.length === 0 && (
        <p className="rounded-xl border bg-white p-3 text-sm text-gray-500">
          Ninguna obra con contrato prevé pérdidas ni tiene provisión vigente en{' '}
          {periodo}.
        </p>
      )}
      {filas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">Obra</th>
                <th className="px-3 py-2 text-right">Contrato</th>
                <th className="px-3 py-2 text-right">Coste estimado</th>
                <th className="px-3 py-2 text-right">Pérdida total</th>
                <th className="px-3 py-2 text-right">Ya reconocida</th>
                <th className="px-3 py-2 text-right">Provisión</th>
                <th className="px-3 py-2 text-right">Anterior</th>
                <th className="px-3 py-2 text-right">Ajuste</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filas.map((o) => (
                <tr key={o.projectId} className="border-t border-gray-100">
                  <td className="px-3 py-2">
                    <span className="font-medium">{o.codigo}</span>{' '}
                    <span className="text-gray-600">{o.nombre}</span>
                    {(o.ultimoPeriodo || o.obraTerminada) && (
                      <span className="block text-xs text-gray-500">
                        {o.obraTerminada && 'Obra terminada · '}
                        {o.ultimoPeriodo && `Último cierre ${o.ultimoPeriodo}`}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {o.contrato === null ? '—' : formatEur(o.contrato)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(o.costeEstimadoCierre)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(o.perdidaTotal)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(o.perdidaReconocida)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formatEur(o.provisionNecesaria)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEur(o.provisionAnterior)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {conSigno(o.ajuste)}
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
                            if (
                              !ocupado &&
                              can('cambiarEstado', 'contabilidad')
                            )
                              unaObra.mutate(o);
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

      <h3 className="mt-4 mb-2 text-xs font-semibold text-gray-600">
        Cierres de provisión del periodo
      </h3>
      {cierres.isError && (
        <ErrorBanner message={(cierres.error as Error).message} />
      )}
      {(cierres.data ?? []).length === 0 ? (
        <p className="rounded-xl border bg-white p-3 text-sm text-gray-500">
          Sin cierres de provisión en {periodo}.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border bg-white text-sm shadow-sm">
          {(cierres.data ?? []).map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <span
                className={
                  p.estado === 'anulado' ? 'text-gray-400 line-through' : ''
                }
              >
                {p.codigo} · {formatDate(p.fechaCierre)} · provisión{' '}
                {formatEur(p.provisionNecesaria)} · ajuste {formatEur(p.ajuste)}
              </span>
              <span className="flex items-center gap-3">
                <span className="text-xs text-gray-500">
                  {ESTADO_WIP_LABELS[p.estado]}
                  {p.motivoAnulacion && ` · ${p.motivoAnulacion}`}
                </span>
                {cierra && p.estado === 'contabilizado' && (
                  <button
                    type="button"
                    className="text-xs text-red-700 hover:underline"
                    onClick={() => setAnulando(p)}
                  >
                    Anular
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <AnularProvisionModal p={anulando} onClose={() => setAnulando(null)} />
    </section>
  );
}

function AnularProvisionModal({
  p,
  onClose,
}: {
  p: ProvisionPerdidasDto | null;
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
      provisionPerdidasApi.anular(
        p!.id,
        motivo.trim(),
        p!.version,
        clave.current,
      ),
    onSuccess: (r) => {
      clave.current = nuevoUuid();
      toast(
        `Provisión de ${r.codigo} (${r.periodo}) anulada por contra-asiento`,
      );
      setMotivo('');
      refrescar();
      onClose();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  return (
    <Modal
      open={p !== null}
      title={p ? `Anular la provisión ${p.periodo} de ${p.codigo}` : ''}
      onClose={onClose}
    >
      {p && (
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
            debe estar abierto). Solo se anula el último cierre de la obra; la
            provisión vigente vuelve a ser la del cierre anterior.
          </p>
          <div>
            <label className={labelCls} htmlFor="provision-motivo">
              Motivo
            </label>
            <input
              id="provision-motivo"
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
              {m.isPending ? 'Anulando…' : 'Anular provisión'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
