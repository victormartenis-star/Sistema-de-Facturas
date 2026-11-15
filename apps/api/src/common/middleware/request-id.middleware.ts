import { randomUUID } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../logging/logger';
import { runWithCorrelation } from '../request-context';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Cabecera entrante aceptada: 8-64 caracteres seguros (sin saltos de línea). */
export const REQUEST_ID_VALIDO = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Mismo patrón que `AuthenticatedRequest` en `jwt-auth.guard.ts`: tipo por
 * intersección en vez de aumentar el módulo `express` global.
 */
export type RequestWithId = Request & {
  id: string;
  user?: { sub: string; companyId: string };
};

/**
 * Middleware, no interceptor: corre antes que los guards, así que el ID de
 * correlación queda fijado — y en la cabecera de la respuesta — incluso en
 * 401, 404, 429 y 500.
 *
 * Una cabecera `x-request-id` entrante se respeta solo si cumple
 * `REQUEST_ID_VALIDO`; si no, se genera un UUID v4 (evita inyección en logs
 * y cabeceras reflejadas). Abre el contexto ALS y deja una línea de log de
 * acceso por petición al terminar la respuesta (`finish`), también cuando un
 * guard la rechaza. El log de acceso no incluye query string ni cuerpos.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(REQUEST_ID_HEADER);
    const id =
      incoming !== undefined && REQUEST_ID_VALIDO.test(incoming)
        ? incoming
        : randomUUID();
    const r = req as RequestWithId;
    r.id = id;
    res.setHeader('X-Request-Id', id);
    const inicio = process.hrtime.bigint();

    res.once('finish', () => {
      const route =
        req.route?.path !== undefined
          ? `${req.baseUrl}${String(req.route.path)}`
          : 'unmatched';
      // `req.user` lo deja JwtAuthGuard; no depende del ALS en el evento.
      logger.info(
        {
          correlationId: id,
          companyId: r.user?.companyId ?? null,
          userId: r.user?.sub ?? null,
          method: req.method,
          route,
          statusCode: res.statusCode,
          latencyMs: Math.round(Number(process.hrtime.bigint() - inicio) / 1e6),
        },
        'http.request',
      );
    });

    runWithCorrelation(id, () => next());
  }
}
