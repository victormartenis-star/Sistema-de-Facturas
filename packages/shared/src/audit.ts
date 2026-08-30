/**
 * Registro de auditoría.
 *
 * El log guarda la ruta y el verbo tal cual (`POST /variations/:id/aprobar`),
 * porque es lo único que no se puede olvidar de anotar. La traducción a
 * lenguaje llano se hace al leerlo, aquí, y no al escribirlo: así una
 * etiqueta mal puesta se corrige sin reescribir el histórico.
 */

/** Nombre legible de cada módulo. */
export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  projects: 'Obras',
  contacts: 'Contactos',
  documents: 'Documentos',
  invoices: 'Facturas',
  'delivery-notes': 'Albaranes',
  'purchase-orders': 'Pedidos',
  certifications: 'Certificaciones',
  treasury: 'Tesorería',
  variations: 'Modificados',
  permits: 'Licencias y acometidas',
  checklist: 'Apertura de obra',
  forecast: 'Previsión económica',
  phases: 'Partidas',
  auth: 'Usuarios y acceso',
  validacion: 'Validación de documentos',
  compliance: 'Homologación',
};

/**
 * Acciones cuyo nombre llano merece la pena fijar, porque son las que alguien
 * va a buscar en el registro. El resto se describe con el verbo genérico.
 */
const ACTION_LABELS: [RegExp, string][] = [
  [/^POST \/auth\/login/, 'Inicio de sesión'],
  [/^POST \/auth\/users/, 'Alta de usuario'],
  [/^PATCH \/auth\/users/, 'Cambio en un usuario'],
  [/^POST \/variations\/.*\/aprobar/, 'Firma de un modificado'],
  [/^POST \/variations\/.*\/rechazar/, 'Rechazo de un modificado'],
  [/^POST \/variations\/.*\/reabrir/, 'Reapertura de un modificado'],
  [/^POST \/purchase-orders\/.*\/cerrar/, 'Cierre de pedido'],
  [/^POST \/purchase-orders\/.*\/anular/, 'Anulación de pedido'],
  [/^POST \/purchase-orders/, 'Emisión de pedido'],
  [/^POST \/delivery-notes\/.*\/validar/, 'Validación de albarán'],
  [/^POST \/invoices\/.*\/aprobar/, 'Aprobación de factura'],
  [/^POST \/invoices\/.*\/anular/, 'Anulación de factura'],
  [/^PATCH \/projects\/.*\/responsables/, 'Asignación de responsables'],
  [/^PUT \/forecast\/.*\/plan/, 'Cambio de planificación económica'],
  [/^POST \/forecast\/.*\/previsiones/, 'Declaración de coste pendiente'],
  [/^POST \/checklist/, 'Punto del checklist de apertura'],
];

const VERB_LABELS: Record<string, string> = {
  POST: 'Alta',
  PATCH: 'Modificación',
  PUT: 'Sustitución',
  DELETE: 'Baja',
};

/** Descripción en lenguaje llano de una acción registrada. */
export function auditActionLabel(action: string): string {
  for (const [pattern, label] of ACTION_LABELS) {
    if (pattern.test(action)) return label;
  }
  const [verb] = action.split(' ');
  return VERB_LABELS[verb] ?? action;
}

export function auditEntityLabel(entity: string): string {
  return AUDIT_ENTITY_LABELS[entity] ?? entity;
}

export interface AuditQuery {
  entity?: string;
  entityId?: string;
  userId?: string;
  /** Fecha ISO inclusive. */
  from?: string;
  to?: string;
  limit?: number;
}

export interface AuditEntryDto {
  id: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  userRole: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  payload: Record<string, unknown> | null;
  statusCode: number;
  ip: string | null;
  createdAt: string;
}
