import { randomUUID } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Mismo patrón que `AuthenticatedRequest` en `jwt-auth.guard.ts`: tipo por
 * intersección en vez de aumentar el módulo `express` global.
 */
export type RequestWithId = Request & { id: string };

/**
 * Middleware, no interceptor: corre antes que los guards (`JwtAuthGuard`,
 * `ThrottlerGuard`), así que el ID de correlación queda fijado — y en la
 * cabecera de la respuesta — incluso en peticiones que un guard rechaza
 * (401, 429) y que nunca llegan a `LoggingInterceptor`.
 *
 * Si la petición ya trae `x-request-id` (proxy o balanceador por delante),
 * se reutiliza en vez de generar uno nuevo: mantiene la correlación de
 * punta a punta.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(REQUEST_ID_HEADER);
    const id = incoming?.trim() || randomUUID();
    (req as RequestWithId).id = id;
    res.setHeader(REQUEST_ID_HEADER, id);
    next();
  }
}
