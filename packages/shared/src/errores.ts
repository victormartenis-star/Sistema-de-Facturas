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
  BANK_GUARANTEE_LIMIT_EXCEEDED: 'Límite de la línea de avales superado',
  BANK_GUARANTEE_LINE_DUPLICATE: 'Ya hay una línea de avales para esa entidad',
  BANK_GUARANTEE_LINE_NOT_FOUND: 'Línea de avales no encontrada',
  BANK_GUARANTEE_FINANCING_NOT_APPLICABLE:
    'Solo la ejecución de un aval emitido se financia',
  FISCAL_YEAR_CLOSED: 'Ejercicio contable cerrado',
  FISCAL_YEAR_ALREADY_CLOSED: 'El ejercicio ya está cerrado',
  FISCAL_YEAR_NOT_ENDED: 'El ejercicio aún no ha terminado',
  FISCAL_YEAR_PREVIOUS_OPEN: 'El ejercicio anterior está sin cerrar',
  FISCAL_YEAR_NOT_CLOSED: 'El ejercicio no está cerrado',
  FISCAL_YEAR_NOT_LATEST: 'Solo se revierte el último ejercicio cerrado',
  FISCAL_YEAR_UNBALANCED: 'El libro del ejercicio no cuadra',
  FISCAL_YEAR_RESULT_APPLIED:
    'El resultado del ejercicio está aplicado: anula antes la aplicación',
  RESULT_ALREADY_APPLIED: 'El resultado del ejercicio ya está aplicado',
  RESULT_APPLICATION_NOT_FOUND: 'Aplicación del resultado no encontrada',
  RESULT_APPLICATION_DATE_INVALID:
    'Fecha de aplicación del resultado no válida',
  RESULT_APPLICATION_ZERO: 'El resultado del ejercicio es cero',
  RESULT_APPLICATION_INVALID_ACCOUNT: 'Destino del resultado no válido',
  RESULT_APPLICATION_UNBALANCED: 'El reparto no cuadra con el resultado',
  RESULT_APPLICATION_LEGAL_RESERVE: 'Reserva legal insuficiente',
  RESULT_APPLICATION_COMPENSATION_EXCEEDS:
    'La compensación supera las pérdidas pendientes',
  RESULT_APPLICATION_DIVIDEND_BLOCKED:
    'Dividendos con pérdidas anteriores sin compensar',
  RESULT_APPLICATION_DEADLINE_EXCEEDED:
    'Aplicación del resultado fuera del plazo de seis meses',
  RESULT_APPLICATION_EQUITY_BELOW_CAPITAL:
    'El dividendo dejaría el patrimonio neto por debajo del capital',
  BANK_GUARANTEE_ACCRUAL_PERIOD_OPEN: 'El mes del devengo aún no ha terminado',
  BANK_GUARANTEE_REFERENCE_DATE_INVALID: 'Fecha de referencia futura',
  BANK_GUARANTEE_RATE_DATE_INVALID: 'Fecha de efecto de la tasa no válida',
  CLOSE_RECONCILIATION_DATE_INVALID: 'Fecha de corte de la conciliación futura',
  AR_AP_DATE_INVALID: 'Fecha de corte o de la operación futura',
  AR_AP_ITEM_NOT_OPEN: 'La partida no está abierta',
  AR_AP_ITEM_NOT_FOUND: 'Partida no encontrada',
  AR_AP_CONTACT_MISMATCH: 'La partida es de otro tercero',
  AR_AP_ALLOCATION_INVALID: 'Imputación no válida',
  AR_AP_ALLOCATION_EXCEEDS_ITEM:
    'La imputación supera el pendiente de la partida',
  AR_AP_ALLOCATION_EXCEEDS_AVAILABLE:
    'La imputación supera el importe disponible',
  AR_AP_NETTING_UNBALANCED: 'La compensación no cuadra entre cobros y pagos',
  AR_AP_ADVANCE_NOT_FOUND: 'Anticipo no encontrado',
  AR_AP_ADVANCE_APPLIED: 'El anticipo ya se ha aplicado',
  AR_AP_ALREADY_CANCELLED: 'El documento ya está anulado',
  AR_AP_NETTING_NOT_FOUND: 'Compensación no encontrada',
  AR_AP_CLEARING_SETTLEMENT_LOCKED:
    'La liquidación es de una compensación o un anticipo: se anula desde su documento',
  CHECK_BOOK_NOT_FOUND: 'Talonario no encontrado',
  CHECK_BOOK_INACTIVE: 'El talonario está anulado',
  CHECK_BOOK_EXHAUSTED: 'El talonario está agotado',
  CHECK_BOOK_RANGE_INVALID: 'Rango del talonario no válido',
  CHECK_BOOK_OVERLAP: 'El rango se solapa con otro talonario de la cuenta',
  CHECK_NOT_FOUND: 'Talón no encontrado',
  CHECK_NUMBER_DUPLICATE: 'El número de talón ya existe',
  CHECK_INVALID_TRANSITION: 'Transición de talón no permitida',
  CHECK_DATE_INVALID: 'Fecha del talón no válida',
  CHECK_AMOUNT_INVALID: 'Importe del talón no válido',
  CHECK_DIRECTION_MISMATCH:
    'El vencimiento no corresponde a la dirección del talón',
  CHECK_SETTLEMENT_LOCKED:
    'La liquidación es de un talón: se anula desde el talón',
  CHECK_REASON_REQUIRED: 'Anular, detener o devolver un talón exige motivo',
  PS_RETENTION_NOT_OPEN: 'La retención no está pendiente',
  PS_RETENTION_ALREADY_RELEASABLE: 'La retención ya es liberable',
  PS_RETENTION_NOT_FOUND: 'Retención no encontrada',
  PS_RETENTION_MIXED: 'Las retenciones son de distinto tercero, obra o lado',
  PS_RETENTION_ALREADY_RELEASED: 'La retención ya está liberada',
  PS_GUARANTEE_INVALID: 'El aval no puede sustituir esta retención',
  PS_GUARANTEE_INSUFFICIENT: 'El aval no cubre la retención a sustituir',
  PS_GUARANTEE_SUBSTITUTING:
    'El aval sustituye retenciones y no puede reducirse',
  PS_RELEASE_NOT_FOUND: 'Liberación de retenciones no encontrada',
  PS_RELEASE_SETTLED: 'La retención liberada ya se ha cobrado o pagado',
  PS_RELEASE_ALREADY_CANCELLED: 'La liberación ya está anulada',
  PS_CHANGE_INVALID: 'Modificado de contrato no válido',
  PS_CHANGE_BELOW_CERTIFIED:
    'El contrato quedaría por debajo de lo certificado',
  P2P_LINES_REQUIRED: 'El documento de compra necesita al menos una línea',
  P2P_LINE_INVALID: 'Línea de compra no válida',
  P2P_LINE_NOT_FOUND: 'Línea de compra no encontrada',
  P2P_REQUISITION_NOT_FOUND: 'Solicitud de compra no encontrada',
  P2P_REQUISITION_NOT_APPROVED: 'La solicitud de compra no está aprobada',
  P2P_SOD_SELF_APPROVAL: 'Quien solicita la compra no puede aprobarla',
  P2P_RFQ_NOT_FOUND: 'Petición de ofertas no encontrada',
  P2P_RFQ_NOT_OPEN: 'La petición de ofertas no está abierta',
  P2P_RFQ_SUPPLIER_NOT_INVITED: 'El proveedor no está invitado a la petición',
  P2P_RFQ_QUOTE_MISSING:
    'Falta la oferta del proveedor para alguna línea adjudicada',
  P2P_RFQ_QUOTE_EXPIRED: 'La oferta del proveedor ha caducado',
  P2P_ORDER_NOT_FOUND: 'Pedido de compra no encontrado',
  P2P_ORDER_NOT_RECEIVABLE: 'El pedido no admite recepciones',
  P2P_ORDER_WITHOUT_LINES: 'El pedido no tiene líneas',
  P2P_RECEIPT_INVALID: 'Recepción no válida',
  P2P_RECEIPT_EXCEEDS_ORDER: 'La recepción supera lo pedido',
  P2P_MATCH_NOT_RECEIVED: 'Línea facturada sin recepción',
  P2P_MATCH_QUANTITY_VARIANCE: 'Cantidad facturada fuera de tolerancia',
  P2P_MATCH_PRICE_VARIANCE: 'Precio facturado fuera de tolerancia',
  P2P_MATCH_BLOCKED:
    'La factura no cuadra con el pedido y la recepción: bloqueada para pago',
  P2P_MATCH_MIXED: 'La factura mezcla albaranes y líneas de pedido',
  P2P_MATCH_OTHER_SUPPLIER: 'La línea de pedido es de otro proveedor',
  P2P_LINE_AMOUNT_MISMATCH: 'La base de la línea no es cantidad × precio',
  BATCH_SERIAL_REQUIRED: 'El artículo exige lote o número de serie',
  BATCH_SERIAL_NOT_TRACKED: 'El artículo no se gestiona por lote ni serie',
  BATCH_SERIAL_QUANTITY_MISMATCH:
    'Las cantidades por lote no suman la del movimiento',
  BATCH_SERIAL_INVALID: 'Lote o número de serie no válido',
  BATCH_SERIAL_DUPLICATE: 'El número de serie ya está en stock',
  BATCH_SERIAL_INSUFFICIENT: 'No hay cantidad suficiente del lote o serie',
  BATCH_SERIAL_NOT_FOUND: 'Lote o número de serie no encontrado',
  BATCH_SERIAL_RETURN_EXCEEDS:
    'Se devuelve más de lo consumido del lote o serie',
  BATCH_SERIAL_TRACKING_LOCKED:
    'No se cambia el seguimiento de un artículo con existencias',
  RESULT_APPLICATION_RESERVES_INSUFFICIENT:
    'Reservas insuficientes para compensar la pérdida',
  BANK_GUARANTEE_ACCRUAL_ALREADY_POSTED:
    'Devengo del aval ya contabilizado en el periodo',
  BANK_GUARANTEE_ACCRUAL_NOT_FOUND: 'Devengo del aval no encontrado',
  BANK_GUARANTEE_ACCRUAL_SETTLED:
    'El devengo ya está liquidado por el banco y no se puede anular',
  BANK_GUARANTEE_ACCRUAL_NOT_APPLICABLE:
    'El aval no devenga comisión en el periodo',
  EAC_BELOW_ACTUAL_COST: 'Estimación al cierre inferior al coste real',
  EAC_DATE_OUT_OF_ORDER: 'Fecha anterior a la estimación vigente',
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
