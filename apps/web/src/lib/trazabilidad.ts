import type {
  AuditAnclaDto,
  AuditFirmaEstado,
  AuditIntegrityReportDto,
  AuditSincronizacion,
  FacturaeXsdStatus,
} from '@erp/shared';

/** Texto del panel de trazabilidad para la validación XSD persistida de Facturae. */
export function etiquetaXsd(
  status: FacturaeXsdStatus | null | undefined,
): string {
  if (status === 'valido') return 'Válido';
  if (status === 'no_valido') return 'No válido';
  return 'No disponible';
}

/** Referencia a la certificación original de una rectificativa. */
export function etiquetaCertificacionOriginal(
  seq: number | null | undefined,
): string | null {
  return seq == null ? null : `Certificación nº ${seq}`;
}

export type TonoEstado = 'ok' | 'aviso' | 'error' | 'neutro';

const FIRMA: Record<AuditFirmaEstado, { texto: string; tono: TonoEstado }> = {
  valida: { texto: 'Firmada (HMAC válida)', tono: 'ok' },
  invalida: { texto: 'Firma no válida', tono: 'error' },
  sin_clave: { texto: 'Sin firma verificable', tono: 'aviso' },
};

const SINCRONIZACION: Record<
  AuditSincronizacion,
  { texto: string; tono: TonoEstado }
> = {
  sincronizada: { texto: 'Sincronizada', tono: 'ok' },
  atrasada: { texto: 'Atrasada', tono: 'aviso' },
  sin_anclas: { texto: 'Sin anclas todavía', tono: 'neutro' },
};

/** Texto y tono del estado de la firma HMAC de un ancla. */
export function etiquetaFirmaAncla(firma: AuditFirmaEstado): {
  texto: string;
  tono: TonoEstado;
} {
  return FIRMA[firma];
}

/** Texto y tono del estado de sincronización del anclaje externo. */
export function etiquetaSincronizacion(estado: AuditSincronizacion): {
  texto: string;
  tono: TonoEstado;
} {
  return SINCRONIZACION[estado];
}

/** Hash abreviado para mostrar (los 12 primeros caracteres). */
export function hashCorto(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;
}

export interface ResumenAnclaje {
  /** Ancla más reciente (la API las devuelve de la más reciente a la más antigua). */
  ultima: AuditAnclaDto | null;
  firma: { texto: string; tono: TonoEstado } | null;
  sincronizacion: { texto: string; tono: TonoEstado };
  /** Fecha de la última ancla con firma válida, si no es la más reciente. */
  ultimaValidada: string | null;
  /** Las `max` anclas más recientes, para el historial. */
  historial: AuditAnclaDto[];
  /** Nº de anclas cuya firma no es válida. */
  invalidas: number;
}

/**
 * Resume las anclas de `GET /audit/verify-integrity` para el panel de
 * trazabilidad. Pura: no reordena por su cuenta más allá de garantizar el
 * orden descendente por fecha.
 */
export function resumirAnclaje(
  informe: Pick<
    AuditIntegrityReportDto,
    'anclas' | 'ultimaAnclaValidada' | 'estadoSincronizacion'
  >,
  max = 7,
): ResumenAnclaje {
  const anclas = [...informe.anclas].sort((a, b) =>
    b.fecha.localeCompare(a.fecha),
  );
  const ultima = anclas[0] ?? null;
  const validada = informe.ultimaAnclaValidada?.fecha ?? null;
  return {
    ultima,
    firma: ultima ? etiquetaFirmaAncla(ultima.firma) : null,
    sincronizacion: etiquetaSincronizacion(informe.estadoSincronizacion),
    ultimaValidada: validada && validada !== ultima?.fecha ? validada : null,
    historial: anclas.slice(0, max),
    invalidas: anclas.filter((a) => a.firma === 'invalida').length,
  };
}
