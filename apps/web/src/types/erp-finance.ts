/**
 * Interfaces de TypeScript compartidas para módulos financieros del ERP DINTEL.
 * Este archivo exporta tipos utilizados tanto en el frontend (Next.js) como en el backend (NestJS),
 * asegurando consistencia en el tipo de datos a través de la API.
 *
 * Los tipos se basan en los esquemas Drizzle ORM y DTOs definidos en @erp/shared.
 */

/**
 * Interfaces para Certificaciones de Obra
 * Basadas en CertificationDto del shared package y el esquema Drizzle.
 */

export interface CertTableRow {
  id: string;
  seq: number;
  certDate: string;
  cumulativePct: number;
  cumulativeAmount: number;
  periodAmount: number;
  retentionPct: number;
  retentionAmount: number;
  status: 'borrador' | 'facturada';
  invoiceId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fila resumida para la tabla de certificaciones */
export interface CertSummaryRow {
  seq: number;
  certDate: string;
  cumulativePct: string;
  periodAmount: string;
  retentionAmount: string;
  status: string;
}

/**
 * Interfaces para Líneas de Certificación
 * Basadas en CertificationLineDto del shared package.
 */

export interface CertLineTableRow {
  id: string;
  budgetItemId: string;
  cumulativePct: number;
  cumulativeAmount: number;
  periodAmount: number;
  notes: string | null;
}

/** Fila resumida para la tabla de líneas de certificación */
export interface CertLineSummaryRow {
  budgetItemId: string;
  cumulativePct: string;
  periodAmount: string;
  cumulativeAmount: string;
}

/**
 * Interfaces para Proveedores y Subcontratas
 * Basadas en el esquema Drizzle y DTOs del módulo de proveedores.
 */

export interface ProveedorTableRow {
  id: string;
  cifNif: string;
  tipo: 'proveedor' | 'subcontrata';
  categoriaPrincipal: string | null;
  activo: boolean;
  retencionGarantiaPct: number;
  condicionesPagoDias: number;
  createdAt: string;
  updatedAt: string;
  /** Nombre razon social - se obtiene del contacto asociado */
  razonSocial?: string;
}

/** Documento de PRL (Prevención de Riesgos Laborales) de un proveedor. */
export interface DocumentoPRL {
  id: string;
  docType:
    | 'plan_seguridad'
    | 'seguro_rc'
    | 'certificado_ss'
    | 'itinerario_formativo'
    | 'epi'
    | 'otro';
  numeroExpediente: string;
  fechaEmision: string;
  fechaVencimiento: string;
  status: 'vigente' | 'proximo_vencimiento' | 'vencido' | 'rechazado';
  storageKey: string;
  fileName: string;
  notes: string | null;
}

/** Fila resumida para tabla de proveedores */
export interface ProveedorSummaryRow {
  id: string;
  cifNif: string;
  tipo: string;
  categoriaPrincipal: string | null;
  activo: boolean;
  retencionGarantiaPct: number;
}

/**
 * Interfaces para datos de certificación vs presupuesto
 * Utilizadas en la tabla de certificaciones con información presupuestaria.
 */

export interface CertPresupuestoInfo {
  /** Presupuesto base de la obra (contrato) */
  presupuestoBase: number;
  /** Total certificado a origen acumulado */
  totalCertificado: number;
  /** Monto ejecutado en el periodo actual */
  montoEjecutadoPeriodo: number;
  /** Porcentaje ejecutado actual */
  pctEjecutado: number;
  /** Retención de garantía aplicada */
  retencionAplicada: number;
  /** Monto neto certificable (periodo - retención) */
  montoNeto: number;
}

/**
 * Interfaces para filtros y parámetros de consulta
 */

export interface CertFilters {
  projectId?: string;
  status?: 'borrador' | 'facturada';
  search?: string;
}

export interface CertLineFilters {
  certId: string;
  budgetItemId?: string;
}

/**
 * Interfaces para respuesta de validación de pago (proveedor)
 */

export interface ValidarPagoResponse {
  apto: boolean;
  razones: string[];
  /** Porcentaje de documentación cumplida */
  pctDocumentacion: number;
}

/**
 * Interfaces para estado de contrato subcontrata
 */

export interface ContratoSubcontrataInfo {
  id: string;
  numeroContrato: string;
  fechaInicio: string;
  fechaFinPrevista: string | null;
  fechaFinReal: string | null;
  importeTotal: number;
  importeEjecutado: number;
  pctEjecutado: number;
  status: 'borrador' | 'activo' | 'completado' | 'cancelado';
  retencionGarantiaPct: number;
}
