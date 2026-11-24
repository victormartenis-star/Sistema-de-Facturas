'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  ESTADO_SOLICITUD_LABELS,
  PUERTA_APROBACION_LABELS,
  ROL_APROBADOR_LABELS,
  type EstadoAprobacionDto,
  type OperacionAprobacion,
} from '@erp/shared';
import { aprobacionesApi, formatEur } from '@/lib/api';
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

const COLOR: Record<string, string> = {
  no_requerida: 'bg-gray-100 text-gray-600',
  aprobada: 'bg-emerald-100 text-emerald-700',
  pendiente: 'bg-amber-100 text-amber-800',
  rechazada: 'bg-red-100 text-red-700',
  sin_solicitud: 'bg-red-50 text-red-700',
};

const ETIQUETA: Record<string, string> = {
  no_requerida: 'No requiere aprobación',
  aprobada: 'Aprobada',
  pendiente: 'Aprobación pendiente',
  rechazada: 'Aprobación rechazada',
  sin_solicitud: 'Requiere aprobación',
};

/** Insignia del resultado de la evaluación de aprobación. */
export function BadgeAprobacion({ estado }: { estado: EstadoAprobacionDto }) {
  const r = estado.evaluacion.resultado;
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${COLOR[r]}`}
    >
      {ETIQUETA[r]}
    </span>
  );
}

/**
 * Botón «Aprobación» de un documento sujeto a umbral: abre su estado (regla
 * aplicable, solicitud y evaluación) y permite solicitar la aprobación. La
 * decisión se toma en /aprobaciones (segregación de funciones).
 */
export function AprobacionDocumento({
  operacion,
  entidadId,
}: {
  operacion: OperacionAprobacion;
  entidadId: string;
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button
        type="button"
        className="rounded-md px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50"
        onClick={() => setAbierto(true)}
      >
        Aprobación
      </button>
      {abierto && (
        <EstadoAprobacionModal
          operacion={operacion}
          entidadId={entidadId}
          onClose={() => setAbierto(false)}
        />
      )}
    </>
  );
}

function EstadoAprobacionModal({
  operacion,
  entidadId,
  onClose,
}: {
  operacion: OperacionAprobacion;
  entidadId: string;
  onClose: () => void;
}) {
  const [comentario, setComentario] = useState('');
  const clave = useRef(nuevoUuid());
  const qc = useQueryClient();
  const toast = useToast();
  const avisarError = useAvisarError();
  const { can } = usePermisos();
  const estado = useQuery({
    queryKey: ['aprobaciones', 'estado', operacion, entidadId],
    queryFn: () => aprobacionesApi.estado(operacion, entidadId),
  });
  const solicitar = useMutation({
    mutationFn: () =>
      aprobacionesApi.solicitar(
        operacion,
        entidadId,
        comentario.trim() || null,
        clave.current,
      ),
    onSuccess: () => {
      clave.current = nuevoUuid();
      toast('Aprobación solicitada');
      void qc.invalidateQueries({ queryKey: ['aprobaciones'] });
    },
    onError: (e) => avisarError(e),
  });

  const d = estado.data;
  const ev = d?.evaluacion;
  // Solicitar es una mutación: solo para roles que operan documentos.
  const puedeSolicitar =
    can('crear') &&
    ev !== undefined &&
    (ev.resultado === 'sin_solicitud' || ev.resultado === 'rechazada');

  return (
    <Modal
      open
      title={d ? `Aprobación · ${d.referencia}` : 'Aprobación'}
      onClose={onClose}
    >
      {estado.isError && (
        <ErrorBanner message={(estado.error as Error).message} />
      )}
      {estado.isLoading && <TableSkeleton rows={3} />}
      {d && ev && (
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <BadgeAprobacion estado={d} />
            <span className="text-gray-600">{formatEur(d.importe)}</span>
          </div>
          <p className="text-gray-600">{ev.motivo}</p>
          {d.regla && (
            <p className="text-gray-600">
              Regla «{d.regla.nombre}»: desde {formatEur(d.regla.importeMinimo)}{' '}
              aprueba {ROL_APROBADOR_LABELS[d.regla.rolRequerido]}. Sin
              aprobación no se puede {PUERTA_APROBACION_LABELS[operacion]}.
            </p>
          )}
          {d.solicitud && (
            <div className="rounded-lg border bg-gray-50 p-3 text-xs text-gray-700">
              Última solicitud: {ESTADO_SOLICITUD_LABELS[d.solicitud.estado]}{' '}
              por {formatEur(d.solicitud.importe)}
              {d.solicitud.motivoDecision && (
                <> · {d.solicitud.motivoDecision}</>
              )}
            </div>
          )}
          {puedeSolicitar && (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!solicitar.isPending) solicitar.mutate();
              }}
            >
              <label className={labelCls} htmlFor="ap-comentario">
                Comentario para el aprobador (opcional)
              </label>
              <input
                id="ap-comentario"
                className={fieldCls}
                maxLength={500}
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button type="button" className={btnGhostCls} onClick={onClose}>
                  Cerrar
                </button>
                <button
                  type="submit"
                  className={btnPrimaryCls}
                  disabled={solicitar.isPending}
                >
                  {solicitar.isPending ? 'Enviando…' : 'Solicitar aprobación'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}
