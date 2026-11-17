'use client';

/**
 * Panel de Trazabilidad Fiscal y Auditoría de una factura o certificación.
 *
 * Solo muestra datos que la API devuelve: los campos fiscales vienen del DTO
 * de la entidad (`GET /invoices`, `GET /certifications`), el historial de
 * `GET /audit?entityType&entityId` (admin y gerente) y la integridad de la
 * cadena de `GET /audit/verify-integrity` (solo admin). La validación XSD de
 * Facturae se lee de `facturaeXsdStatus` (persistida al generar el XML).
 *
 * El anclaje diario (WORM simulado: firma HMAC de la ancla y exportación en
 * modo append fuera de la BD) sale del mismo informe de integridad: última
 * ancla, estado de su firma, fecha del bloque y sincronización.
 */

import { useQuery } from '@tanstack/react-query';
import {
  RECTIFICATION_MOTIVE_LABELS,
  RECTIFICATION_TYPE_LABELS,
  type AuditAction,
  type AuditIntegrityReportDto,
  type AuditLogDto,
  type FacturaeXsdStatus,
  type RectificationMotive,
  type RectificationType,
} from '@erp/shared';
import { auditApi, formatDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { textoDeError } from '@/lib/errores';
import {
  etiquetaFirmaAncla,
  etiquetaXsd,
  hashCorto,
  resumirAnclaje,
  type TonoEstado,
} from '@/lib/trazabilidad';

export interface DatosFiscales {
  /** Etiqueta legible del estado de la entidad. */
  estado: string;
  /** Referencia a la original si es rectificativa (nº de factura o "Certificación nº X"). */
  rectificaA: string | null;
  motivo: RectificationMotive | null;
  tipo: RectificationType | null;
  facturaeReasonCode: string | null;
  /** Validación XSD persistida; null/ausente = no evaluado. */
  facturaeXsd?: FacturaeXsdStatus | null;
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
  return (
    <>
      {r.integra ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          Cadena de auditoría íntegra ({r.entradasVerificadas} entradas
          verificadas).
        </p>
      ) : (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          Cadena de auditoría rota
          {r.primerPuntoRoto
            ? ` en la secuencia ${r.primerPuntoRoto.sequenceNumber}: ${r.primerPuntoRoto.motivo} — ${r.primerPuntoRoto.detalle}`
            : ''}
        </p>
      )}
      <AnclajeExterno informe={r} />
    </>
  );
}

const TONO: Record<TonoEstado, string> = {
  ok: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  aviso: 'bg-amber-50 text-amber-800 ring-amber-200',
  error: 'bg-red-50 text-red-700 ring-red-200',
  neutro: 'bg-gray-50 text-gray-600 ring-gray-200',
};

function Insignia({ texto, tono }: { texto: string; tono: TonoEstado }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TONO[tono]}`}
    >
      {texto}
    </span>
  );
}

function SinDato() {
  return <span className="text-gray-400">—</span>;
}

/** Último anclaje diario: firma HMAC, fecha del bloque y sincronización externa. */
function AnclajeExterno({ informe }: { informe: AuditIntegrityReportDto }) {
  const r = resumirAnclaje(informe);
  return (
    <div aria-label="Anclaje externo de la auditoría" className="mt-3">
      <p className="mb-2 text-xs font-semibold text-gray-600 uppercase">
        Anclaje criptográfico diario
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-gray-500">Último bloque</dt>
          <dd className="text-sm text-gray-900">
            {r.ultima ? formatDate(r.ultima.fecha) : <SinDato />}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Firma HMAC</dt>
          <dd className="text-sm">
            {r.firma ? (
              <Insignia texto={r.firma.texto} tono={r.firma.tono} />
            ) : (
              <SinDato />
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Almacenamiento externo</dt>
          <dd className="text-sm">
            <Insignia
              texto={r.sincronizacion.texto}
              tono={r.sincronizacion.tono}
            />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Hash anclado</dt>
          <dd className="font-mono text-xs text-gray-700">
            {r.ultima ? (
              <span title={r.ultima.entryHash}>
                #{r.ultima.sequenceNumber} · {hashCorto(r.ultima.entryHash)}
              </span>
            ) : (
              <SinDato />
            )}
          </dd>
        </div>
      </dl>
      {r.ultimaValidada && (
        <p className="mt-2 text-xs text-amber-700">
          Última ancla con firma válida: {formatDate(r.ultimaValidada)}.
        </p>
      )}
      {r.invalidas > 0 && (
        <p className="mt-2 text-xs text-red-700">
          {r.invalidas === 1
            ? 'Hay 1 ancla con firma no válida.'
            : `Hay ${r.invalidas} anclas con firma no válida.`}
        </p>
      )}
      {r.historial.length > 1 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-gray-600">
            Historial de anclajes ({r.historial.length} más recientes)
          </summary>
          <ol className="mt-1.5 space-y-1">
            {r.historial.map((a) => {
              const f = etiquetaFirmaAncla(a.firma);
              return (
                <li
                  key={a.fecha}
                  className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs"
                >
                  <span className="tabular-nums text-gray-600">
                    {formatDate(a.fecha)}
                  </span>
                  <span className="font-mono text-[10px] text-gray-500">
                    #{a.sequenceNumber} · {hashCorto(a.entryHash)}
                  </span>
                  <Insignia texto={f.texto} tono={f.tono} />
                </li>
              );
            })}
          </ol>
        </details>
      )}
      <p className="mt-2 text-[11px] text-gray-400">
        WORM simulado: la firma HMAC detecta alteraciones de las anclas, pero no
        es un sellado de tiempo cualificado.
      </p>
    </div>
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
      <p className="mt-2 flex items-center gap-2 text-xs text-gray-500">
        Validación XSD Facturae:
        <Insignia
          texto={etiquetaXsd(fiscal.facturaeXsd)}
          tono={
            fiscal.facturaeXsd === 'valido'
              ? 'ok'
              : fiscal.facturaeXsd === 'no_valido'
                ? 'error'
                : 'neutro'
          }
        />
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
