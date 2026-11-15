'use client';

/**
 * Panel de Trazabilidad Fiscal y Auditoría de una factura o certificación.
 *
 * Solo muestra datos que la API devuelve: los campos fiscales vienen del DTO
 * de la entidad (`GET /invoices`, `GET /certifications`), el historial de
 * `GET /audit?entityType&entityId` (admin y gerente) y la integridad de la
 * cadena de `GET /audit/verify-integrity` (solo admin). El estado de la
 * validación XSD de Facturae no se persiste: se indica como no disponible.
 */

import { useQuery } from '@tanstack/react-query';
import {
  RECTIFICATION_MOTIVE_LABELS,
  RECTIFICATION_TYPE_LABELS,
  type AuditAction,
  type AuditLogDto,
  type RectificationMotive,
  type RectificationType,
} from '@erp/shared';
import { auditApi, formatDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { textoDeError } from '@/lib/errores';

export interface DatosFiscales {
  /** Etiqueta legible del estado de la entidad. */
  estado: string;
  /** Referencia a la original si es rectificativa (número o id). */
  rectificaA: string | null;
  motivo: RectificationMotive | null;
  tipo: RectificationType | null;
  facturaeReasonCode: string | null;
}

const ACCION: Record<AuditAction, string> = {
  create: 'Crear',
  update: 'Actualizar',
  delete: 'Eliminar',
  export: 'Exportar',
};

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string | null }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{etiqueta}</dt>
      <dd className="text-sm text-gray-900">
        {valor ?? <span className="text-gray-400">—</span>}
      </dd>
    </div>
  );
}

function IntegridadCadena() {
  const q = useQuery({
    queryKey: ['audit', 'verify-integrity'],
    queryFn: () => auditApi.verifyIntegrity(),
    staleTime: 60_000,
    retry: false,
  });
  if (q.isLoading) {
    return <p className="text-xs text-gray-500">Verificando cadena…</p>;
  }
  if (q.isError || !q.data) {
    return (
      <p className="text-xs text-amber-700">
        No se pudo verificar la cadena: {textoDeError(q.error)}
      </p>
    );
  }
  const r = q.data;
  if (r.integra) {
    return (
      <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
        Cadena de auditoría íntegra ({r.entradasVerificadas} entradas
        verificadas).
      </p>
    );
  }
  return (
    <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
      Cadena de auditoría rota
      {r.primerPuntoRoto
        ? ` en la secuencia ${r.primerPuntoRoto.sequenceNumber}: ${r.primerPuntoRoto.motivo} — ${r.primerPuntoRoto.detalle}`
        : ''}
    </p>
  );
}

function Historial({
  entityType,
  entityId,
}: {
  entityType: 'invoice' | 'certification';
  entityId: string;
}) {
  const q = useQuery({
    queryKey: ['audit', entityType, entityId],
    queryFn: () => auditApi.list({ entityType, entityId, limit: 200 }),
    retry: false,
  });
  if (q.isLoading) {
    return <p className="text-xs text-gray-500">Cargando historial…</p>;
  }
  if (q.isError) {
    return (
      <p className="text-xs text-red-600">
        No se pudo cargar el historial: {textoDeError(q.error)}
      </p>
    );
  }
  const entradas: AuditLogDto[] = [...(q.data ?? [])].sort(
    (a, b) =>
      a.sequenceNumber - b.sequenceNumber ||
      a.occurredAt.localeCompare(b.occurredAt),
  );
  if (entradas.length === 0) {
    return <p className="text-xs text-gray-500">Sin registros de auditoría.</p>;
  }
  return (
    <ol className="space-y-1.5">
      {entradas.map((e) => (
        <li
          key={e.id}
          className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs"
        >
          <span className="tabular-nums text-gray-500">
            {formatDate(e.occurredAt)}{' '}
            {new Date(e.occurredAt).toLocaleTimeString('es-ES')}
          </span>
          <span className="font-medium text-gray-800">{ACCION[e.action]}</span>
          <span className="font-mono text-[10px] text-gray-500">
            {e.correlationId ? `ref: ${e.correlationId}` : 'sin correlación'}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function TrazabilidadFiscal({
  entityType,
  entityId,
  fiscal,
}: {
  entityType: 'invoice' | 'certification';
  entityId: string;
  fiscal: DatosFiscales;
}) {
  const { user } = useAuth();
  const esAdmin = user?.role === 'admin';
  const veHistorial = esAdmin || user?.role === 'gerente';
  return (
    <section
      aria-label="Trazabilidad fiscal y auditoría"
      className="rounded-xl border border-gray-200 bg-white p-4"
    >
      <p className="mb-3 text-xs font-semibold text-gray-600 uppercase">
        Trazabilidad fiscal y auditoría
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Dato etiqueta="Estado" valor={fiscal.estado} />
        <Dato etiqueta="Rectifica a" valor={fiscal.rectificaA} />
        <Dato
          etiqueta="Motivo normativo"
          valor={
            fiscal.motivo ? RECTIFICATION_MOTIVE_LABELS[fiscal.motivo] : null
          }
        />
        <Dato
          etiqueta="Tipo"
          valor={
            fiscal.tipo
              ? `${fiscal.tipo} - ${RECTIFICATION_TYPE_LABELS[fiscal.tipo]}`
              : null
          }
        />
        <Dato etiqueta="Código Facturae" valor={fiscal.facturaeReasonCode} />
      </dl>
      <p className="mt-2 text-xs text-gray-500">
        Validación XSD Facturae: no disponible (la API no la persiste).
      </p>
      <div className="mt-4">
        <p className="mb-2 text-xs font-semibold text-gray-600 uppercase">
          Historial de auditoría
        </p>
        {veHistorial ? (
          <Historial entityType={entityType} entityId={entityId} />
        ) : (
          <p className="text-xs text-gray-500">
            El historial solo está disponible para administración y gerencia.
          </p>
        )}
      </div>
      {esAdmin && (
        <div className="mt-4">
          <IntegridadCadena />
        </div>
      )}
    </section>
  );
}
