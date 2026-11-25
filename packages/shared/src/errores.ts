/**
 * Catálogo de códigos de error de la API (cuerpo RFC 7807, ver
 * `apps/api/src/common/filters/all-exceptions.filter.ts`). Sin dependencias
 * de Node: lo comparten API, web y MCP.
 */

export const MENSAJE_CONFLICTO_VERSION =
  'Los datos han sido modificados por otro usuario. Recarga para ver la última versión.';

export const MENSAJE_ERROR_INTERNO =
  'Error interno. Indica el correlationId a soporte.';

/** Código por defecto según el estado HTTP cuando el cuerpo no trae `code`. */
export const CODIGO_POR_ESTADO: Readonly<Record<number, string>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'UNPROCESSABLE_ENTITY',
  428: 'PRECONDITION_REQUIRED',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

/** Títulos legibles por código (los no listados usan el del estado). */
export const TITULO_POR_CODIGO: Readonly<Record<string, string>> = {
  VALIDATION_ERROR: 'Datos no válidos',
  VERSION_CONFLICT: 'Conflicto de versión',
  PRECONDITION_REQUIRED: 'Precondición requerida',
  IDEMPOTENCY_KEY_REUSED: 'Idempotency-Key reutilizada',
  IDEMPOTENCY_IN_PROGRESS: 'Petición en curso',
  INVALID_TRANSITION: 'Transición de estado no válida',
  AUDIT_CHAIN_BUSY: 'Cadena de auditoría ocupada',
  INTERNAL_ERROR: 'Error interno',
  INSUFFICIENT_STOCK: 'Stock insuficiente',
  BUDGET_EXCEEDED: 'Presupuesto de obra excedido',
  APPROVAL_REQUIRED: 'Aprobación requerida',
  APPROVAL_PENDING: 'Aprobación pendiente',
  APPROVAL_REJECTED: 'Aprobación rechazada',
  SELF_APPROVAL_FORBIDDEN: 'No puedes aprobar tu propia solicitud',
  APPROVAL_ROLE_INSUFFICIENT: 'Nivel de aprobación insuficiente',
  HOLDING_NOT_FOUND: 'Grupo no encontrado',
  HOLDING_COMPANY_ACCESS_DENIED: 'Sin acceso a una sociedad del grupo',
  HOLDING_MEMBER_DUPLICATE: 'Sociedad ya integrada en el grupo',
  INTERCOMPANY_MISMATCH: 'Descuadre intercompañía',
  CONSOLIDATION_PERIOD_CLOSED: 'Periodo de consolidación cerrado',
  MATERIAL_REQUEST_OVER_SERVED: 'Se sirve más de lo solicitado',
  WIP_ALREADY_POSTED: 'Obra en curso ya contabilizada en el periodo',
  WIP_PERIOD_OUT_OF_ORDER: 'Periodo anterior al último cierre de obra en curso',
  WIP_NOT_LATEST: 'Solo se anula el último cierre de obra en curso',
  LOSS_PROVISION_ALREADY_POSTED:
    'Provisión por pérdidas ya contabilizada en el periodo',
  LOSS_PROVISION_PERIOD_OUT_OF_ORDER:
    'Periodo anterior al último cierre de la provisión por pérdidas',
  LOSS_PROVISION_NOT_LATEST: 'Solo se anula el último cierre de la provisión',
  BANK_GUARANTEE_NOT_FOUND: 'Aval no encontrado',
  BANK_GUARANTEE_REFERENCE_DUPLICATE: 'Referencia de aval duplicada',
  BANK_GUARANTEE_NOT_ACTIVE: 'El aval no está vivo',
  BANK_GUARANTEE_AMOUNT_INVALID: 'Importe del aval no válido',
  BANK_GUARANTEE_AMOUNT_EXCEEDS_BALANCE:
    'Importe superior al saldo vivo del aval',
  BANK_GUARANTEE_DATE_INVALID: 'Fecha no válida para el aval',
  BANK_GUARANTEE_NOT_EXPIRED: 'El aval aún no ha vencido',
  BANK_GUARANTEE_EXTENSION_INVALID: 'Prórroga de aval no válida',
  BANK_GUARANTEE_COMMISSION_NOT_APPLICABLE: 'El aval no devenga comisión',
  BANK_GUARANTEE_HAS_MOVEMENTS:
    'El aval tiene movimientos y no se puede anular',
  BANK_GUARANTEE_LINK_INVALID: 'Vínculo del aval no válido',
  WAREHOUSE_INACTIVE: 'Almacén inactivo',
  STOCK_ARTICLE_INACTIVE: 'Artículo inactivo',
  DELIVERY_NOTE_ALREADY_STOCKED: 'Albarán ya recepcionado en stock',
  FISCAL_PERIOD_CLOSED: 'Período contable cerrado',
  BAD_REQUEST: 'Petición incorrecta',
  UNAUTHORIZED: 'No autenticado',
  FORBIDDEN: 'Acceso denegado',
  NOT_FOUND: 'No encontrado',
  CONFLICT: 'Conflicto',
  PAYLOAD_TOO_LARGE: 'Contenido demasiado grande',
  UNPROCESSABLE_ENTITY: 'Entidad no procesable',
  TOO_MANY_REQUESTS: 'Demasiadas peticiones',
  SERVICE_UNAVAILABLE: 'Servicio no disponible',
};

export interface ErrorCampo {
  field: string;
  message: string;
}

/** Cuerpo `application/problem+json` (RFC 7807) + miembros de compatibilidad. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  errorCode: string;
  correlationId: string | null;
  timestamp: string;
  errors: ErrorCampo[];
  /** Compatibilidad (obsoletos): = detail, errorCode, status. */
  message: string;
  code: string;
  statusCode: number;
  [extra: string]: unknown;
}
