import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { and, eq, lt, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { catchError, from, mergeMap, Observable, of, throwError } from 'rxjs';
import { getDb, idempotencyKeys } from '@erp/db';
import { jsonCanonico } from '@erp/shared';
import type { AuthenticatedRequest } from '../../auth/jwt-auth.guard';

/** SHA-256 hex (64 caracteres) del JSON canónico del cuerpo. */
export function hashCuerpo(cuerpo: unknown): string {
  return createHash('sha256').update(jsonCanonico(cuerpo)).digest('hex');
}

export const CODIGO_CLAVE_REUTILIZADA = 'IDEMPOTENCY_KEY_REUSED';
export const CODIGO_EN_CURSO = 'IDEMPOTENCY_IN_PROGRESS';

const MAX_LONGITUD_CLAVE = 255;
/** Tiempo que una petición "procesando" se considera viva. */
const BLOQUEO_SEGUNDOS = 60;
/** Vigencia de una clave. */
const VIGENCIA_HORAS = 24;
/** Máximo de filas caducadas que borra cada petición con clave. */
const LIMPIEZA_LOTE = 50;

type Adquisicion =
  { id: string } | { replay: { status: number; body: unknown } };

/**
 * Idempotencia por cabecera `Idempotency-Key` (se aplica con `@Idempotente()`).
 *
 * Una clave repetida (misma empresa) dentro de 24 h devuelve la respuesta
 * original guardada, con su código HTTP y la cabecera `Idempotent-Replayed:
 * true`, sin reejecutar la lógica de negocio. Algoritmo:
 *  1. INSERT ... ON CONFLICT (company_id, key) DO NOTHING: quien inserta es
 *     el dueño y ejecuta el handler (2xx -> 'completada' con la respuesta;
 *     error -> se borra la fila, el reintento se reevalúa).
 *  2. Si la clave ya existe: otro método/ruta/cuerpo -> 409
 *     IDEMPOTENCY_KEY_REUSED; 'completada' -> replay; 'procesando' vigente ->
 *     409 IDEMPOTENCY_IN_PROGRESS (+ Retry-After: 1); 'procesando' caducada ->
 *     se retoma con un UPDATE condicional (solo uno gana); expires_at vencida
 *     -> se trata como inexistente.
 *
 * Limpieza: cada petición con clave borra, de forma acotada (LIMIT 50, con
 * el índice en expires_at), filas caducadas. Sin cron adicional.
 *
 * LIMITACIÓN CONOCIDA: la clave se escribe FUERA de la transacción de
 * negocio. Si el proceso muere entre el commit del negocio y el guardado de
 * la respuesta, la fila queda 'procesando' y, al caducar el bloqueo (60 s),
 * un reintento reejecuta el handler (posible duplicado). Las claves
 * naturales (número de factura, etc.) siguen protegiendo contra ello.
 *
 * Nota: los interceptores se ejecutan antes que los pipes, así que un 400 de
 * validación llega aquí como error del handler y libera la clave.
 */
@Injectable()
export class IdempotenciaInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotenciaInterceptor.name);

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest & Request>();
    const res = http.getResponse<Response>();

    const cabecera = req.headers['idempotency-key'];
    const clave = (Array.isArray(cabecera) ? cabecera[0] : cabecera)?.trim();
    if (!clave) return next.handle();
    if (clave.length > MAX_LONGITUD_CLAVE) {
      throw new BadRequestException(
        `Idempotency-Key supera ${MAX_LONGITUD_CLAVE} caracteres`,
      );
    }
    // Sin identidad (ruta pública) no hay ámbito de empresa: sin cambios.
    const companyId = req.user?.companyId;
    if (!companyId) return next.handle();

    const metodo = req.method.toUpperCase();
    const ruta = (req.originalUrl ?? req.url).split('?')[0];
    const hash = hashCuerpo(req.body);
    const db = getDb();

    await this.limpiarCaducadas();

    const adq = await this.adquirir(
      companyId,
      req.user?.sub ?? null,
      clave,
      metodo,
      ruta,
      hash,
      res,
    );
    if ('replay' in adq) {
      res.setHeader('Idempotent-Replayed', 'true');
      res.status(adq.replay.status);
      return of(adq.replay.body);
    }
    const id = adq.id;
    const codigoOk: number =
      Reflect.getMetadata('__httpCode__', context.getHandler()) ?? 201;

    return next.handle().pipe(
      mergeMap((cuerpo: unknown) =>
        from(
          (async () => {
            try {
              // Round-trip JSON: lo guardado es lo que el cliente recibió.
              const guardado: unknown = JSON.parse(
                JSON.stringify(cuerpo ?? null),
              );
              // Estado propio de la fila de idempotencia (no es el de un
              // documento de negocio): se construye aparte para no confundir
              // al test de arquitectura de `cambiar-estado.ts`.
              const completada: Partial<typeof idempotencyKeys.$inferInsert> = {
                status: 'completada',
                responseStatus: codigoOk,
                responseBody: guardado,
                lockedUntil: null,
              };
              await db
                .update(idempotencyKeys)
                .set(completada)
                .where(eq(idempotencyKeys.id, id));
            } catch (e) {
              // El negocio ya hizo commit: no se falla la respuesta por esto.
              this.logger.error(
                `No se pudo guardar la respuesta idempotente: ${String(e)}`,
              );
            }
            return cuerpo;
          })(),
        ),
      ),
      catchError((err: unknown) =>
        from(
          db
            .delete(idempotencyKeys)
            .where(eq(idempotencyKeys.id, id))
            .then(() => undefined)
            .catch((e: unknown) =>
              this.logger.error(`No se pudo liberar la clave: ${String(e)}`),
            ),
        ).pipe(mergeMap(() => throwError(() => err))),
      ),
    );
  }

  private async limpiarCaducadas(): Promise<void> {
    try {
      await getDb().execute(sql`
        DELETE FROM idempotency_keys WHERE id IN (
          SELECT id FROM idempotency_keys
          WHERE expires_at < now() LIMIT ${LIMPIEZA_LOTE}
        )`);
    } catch (e) {
      this.logger.warn(`Limpieza de claves caducadas fallida: ${String(e)}`);
    }
  }

  /** Id de la fila de la que esta petición es dueña, o la respuesta a repetir. */
  private async adquirir(
    companyId: string,
    userId: string | null,
    clave: string,
    metodo: string,
    ruta: string,
    hash: string,
    res: Response,
  ): Promise<Adquisicion> {
    const db = getDb();
    const bloqueo = sql`now() + ${BLOQUEO_SEGUNDOS} * interval '1 second'`;
    for (let intento = 0; intento < 3; intento++) {
      const [propia] = await db
        .insert(idempotencyKeys)
        .values({
          companyId,
          userId,
          key: clave,
          method: metodo,
          path: ruta,
          requestHash: hash,
          status: 'procesando',
          lockedUntil: bloqueo,
          expiresAt: sql`now() + ${VIGENCIA_HORAS} * interval '1 hour'`,
        })
        .onConflictDoNothing({
          target: [idempotencyKeys.companyId, idempotencyKeys.key],
        })
        .returning({ id: idempotencyKeys.id });
      if (propia) return { id: propia.id };

      const [existente] = await db
        .select({
          id: idempotencyKeys.id,
          method: idempotencyKeys.method,
          path: idempotencyKeys.path,
          requestHash: idempotencyKeys.requestHash,
          status: idempotencyKeys.status,
          responseStatus: idempotencyKeys.responseStatus,
          responseBody: idempotencyKeys.responseBody,
          caducada: sql<boolean>`${idempotencyKeys.expiresAt} < now()`,
          bloqueoVigente: sql<boolean>`coalesce(${idempotencyKeys.lockedUntil} > now(), false)`,
        })
        .from(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.companyId, companyId),
            eq(idempotencyKeys.key, clave),
          ),
        )
        .limit(1);
      if (!existente) continue; // borrada entre el INSERT y el SELECT

      if (existente.caducada) {
        await db
          .delete(idempotencyKeys)
          .where(
            and(
              eq(idempotencyKeys.id, existente.id),
              lt(idempotencyKeys.expiresAt, sql`now()`),
            ),
          );
        continue;
      }
      if (
        existente.method !== metodo ||
        existente.path !== ruta ||
        existente.requestHash !== hash
      ) {
        throw new ConflictException({
          code: CODIGO_CLAVE_REUTILIZADA,
          message:
            'La Idempotency-Key ya se usó con otra petición (método, ruta o cuerpo distintos)',
        });
      }
      if (existente.status === 'completada') {
        return {
          replay: {
            status: existente.responseStatus ?? 200,
            body: existente.responseBody,
          },
        };
      }
      if (!existente.bloqueoVigente) {
        const [tomada] = await db
          .update(idempotencyKeys)
          .set({ lockedUntil: bloqueo })
          .where(
            and(
              eq(idempotencyKeys.id, existente.id),
              eq(idempotencyKeys.status, 'procesando'),
              lt(idempotencyKeys.lockedUntil, sql`now()`),
            ),
          )
          .returning({ id: idempotencyKeys.id });
        if (tomada) return { id: tomada.id };
      }
      res.setHeader('Retry-After', '1');
      throw new ConflictException({
        code: CODIGO_EN_CURSO,
        message: 'Hay una petición con esta Idempotency-Key en curso',
      });
    }
    res.setHeader('Retry-After', '1');
    throw new ConflictException({
      code: CODIGO_EN_CURSO,
      message: 'No se pudo adquirir la Idempotency-Key, reintente',
    });
  }
}
