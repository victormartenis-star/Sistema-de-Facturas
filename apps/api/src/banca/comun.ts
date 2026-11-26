import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ErrorBanca } from '@erp/shared';

/** Códigos de regla de banca que son conflicto de estado (409), no de datos (422). */
const CONFLICTOS = new Set([
  'SEPA_INVALID_TRANSITION',
  'SEPA_DUE_IN_REMITTANCE',
  'SEPA_SETTLEMENT_LOCKED',
  'SEPA_ITEM_NOT_RETURNABLE',
  'BANK_RECON_TARGET_TAKEN',
  'BANK_MOVEMENT_ALREADY_RECONCILED',
  'BANK_MOVEMENT_NOT_RECONCILED',
]);

/** Rechazo de una regla pura de banca → RFC 7807 con `errorCode`. */
export function reglaBanca<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ErrorBanca) throw errorBanca(e.code, e.message, e.detalle);
    throw e;
  }
}

export function errorBanca(
  code: string,
  message: string,
  detalle?: Record<string, unknown>,
) {
  const { errores, ...resto } = (detalle ?? {}) as {
    errores?: { partida: string | null; campo: string; mensaje: string }[];
  };
  // Datos SEPA no válidos: cada uno como error de campo RFC 7807.
  const cuerpo = {
    code,
    message,
    ...resto,
    ...(errores && {
      errors: errores.map((x) => ({
        field: x.partida ? `${x.partida}.${x.campo}` : x.campo,
        message: x.mensaje,
      })),
    }),
  };
  if (code.endsWith('_NOT_FOUND')) return new NotFoundException(cuerpo);
  return CONFLICTOS.has(code)
    ? new ConflictException(cuerpo)
    : new UnprocessableEntityException(cuerpo);
}
