import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import { SQL, eq, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { DbOrTx } from '@erp/db';

/**
 * Concurrencia optimista (cabecera `If-Match`).
 *
 * Cada fila de las entidades editables lleva `version` (empieza en 1, +1 en
 * TODA mutación, también las transiciones de estado). El cliente devuelve la
 * versión leída en `If-Match: "3"` (o `3`); el UPDATE lleva `AND version = 3`
 * y es atómico: si otra petición ganó la carrera no toca filas y se responde
 * 409 `{ code: 'VERSION_CONFLICT', versionActual }`.
 *
 * Política (`EXIGIR_VERSION`, se lee en cada petición):
 *  - Por defecto (variable sin definir) y con `true`: las ediciones y borrados
 *    sin If-Match responden 428 `PRECONDITION_REQUIRED`.
 *  - `false` (solo si vale exactamente 'false'): sin If-Match se acepta, pero se
 *    incrementa. Es la vía de escape para clientes antiguos.
 * Las acciones POST (aprobar, pagar, anular…) nunca exigen If-Match; se valida
 * solo si llega.
 */

export const CODIGO_VERSION_CONFLICT = 'VERSION_CONFLICT';

/** Tabla con columna `version` (y `id`). */
export type TablaVersionada = PgTable & { id: PgColumn; version: PgColumn };

function exigirVersionActivo(): boolean {
  // Default seguro: se exige salvo que se desactive explícitamente.
  return process.env.EXIGIR_VERSION !== 'false';
}

/** Parsea el valor de `If-Match`: `"3"` o `3`; entero positivo o 400. */
export function parsearIfMatch(
  cabecera: string | string[] | undefined,
): number | undefined {
  if (cabecera === undefined) return undefined;
  const crudo = (Array.isArray(cabecera) ? cabecera.join(',') : cabecera)
    .trim()
    .replace(/^W\//, '');
  const m = /^"?([1-9]\d{0,8})"?$/.exec(crudo);
  if (!m) {
    throw new BadRequestException(
      'Cabecera If-Match no válida: se espera la versión como entero positivo, p. ej. "3"',
    );
  }
  return Number(m[1]);
}

/**
 * Decorador de parámetro: versión esperada leída de `If-Match`
 * (`number | undefined`; 400 si no es un entero positivo). Con
 * `{ exigible: true }` (ediciones y borrados) responde 428 si falta y
 * `EXIGIR_VERSION=true`.
 */
export const VersionEsperada = createParamDecorator(
  (opciones: { exigible?: boolean } | undefined, ctx: ExecutionContext) => {
    const req = ctx
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const version = parsearIfMatch(req.headers['if-match']);
    if (version === undefined && opciones?.exigible && exigirVersionActivo()) {
      throw new HttpException(
        {
          code: 'PRECONDITION_REQUIRED',
          message: 'Falta la cabecera If-Match con la versión del recurso',
        },
        428,
      );
    }
    return version;
  },
);

export function conflictoVersion(versionActual: number): ConflictException {
  return new ConflictException({
    code: CODIGO_VERSION_CONFLICT,
    versionActual,
  });
}

/** Condición `version = esperada` para el WHERE (undefined si no hay versión). */
export function condicionVersion(
  tabla: { version: PgColumn },
  esperada: number | undefined,
): SQL | undefined {
  return esperada === undefined ? undefined : eq(tabla.version, esperada);
}

/** Fragmento SET `version = version + 1`. */
export function incrementarVersion(tabla: { version: PgColumn }): SQL {
  return sql`${tabla.version} + 1`;
}

/** Fail-fast con la fila ya leída: 409 si la versión no coincide. */
export function verificarVersion(
  actual: number,
  esperada: number | undefined,
): void {
  if (esperada !== undefined && actual !== esperada) {
    throw conflictoVersion(actual);
  }
}

/**
 * Un UPDATE condicionado no tocó filas: se relee para distinguir 404 (no
 * existe), VERSION_CONFLICT (otra petición cambió la versión) o el error de
 * negocio original (`otro`, p. ej. el estado ya no es el esperado).
 */
export async function falloActualizacion(
  tx: DbOrTx,
  tabla: TablaVersionada,
  id: string,
  esperada: number | undefined,
  otro: () => Error,
  noEncontrado = 'Recurso no encontrado',
): Promise<never> {
  const [fila] = await tx
    .select({ version: tabla.version })
    .from(tabla)
    .where(eq(tabla.id, id))
    .limit(1);
  if (!fila) throw new NotFoundException(noEncontrado);
  const actual = Number(fila.version);
  if (esperada !== undefined && actual !== esperada) {
    throw conflictoVersion(actual);
  }
  throw otro();
}
