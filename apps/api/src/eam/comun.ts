import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ErrorEam } from '@erp/shared';

/** Reglas EAM que son conflicto de estado (409), no de datos (422). */
const CONFLICTOS = new Set([
  'EAM_WO_INVALID_TRANSITION',
  'EAM_ASSIGNMENT_OVERLAP',
  'EAM_WO_PLAN_OPEN',
  'EAM_CODE_DUPLICATE',
  'EAM_EQUIPMENT_RETIRED',
]);

export function errorEam(code: string, message: string) {
  const cuerpo = { code, message };
  if (code.endsWith('_NOT_FOUND')) return new NotFoundException(cuerpo);
  return CONFLICTOS.has(code)
    ? new ConflictException(cuerpo)
    : new UnprocessableEntityException(cuerpo);
}

/** Rechazo de una regla pura EAM → RFC 7807 con `errorCode`. */
export function reglaEam<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ErrorEam) throw errorEam(e.code, e.message);
    throw e;
  }
}

export const n2 = (v: string | null | undefined) =>
  v === null || v === undefined ? null : Number(v);
