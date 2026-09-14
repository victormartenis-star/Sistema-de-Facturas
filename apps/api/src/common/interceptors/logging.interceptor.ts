import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { maskSensitiveData, type RequestLogEntry } from '@erp/shared';
import type { AuthenticatedRequest } from '../../auth/jwt-auth.guard';
import type { RequestWithId } from '../middleware/request-id.middleware';

/**
 * Deja una línea de log JSON por petición completada: timestamp, ID de
 * correlación (`x-request-id`, puesto por `RequestIdMiddleware`), método,
 * ruta, código de estado, latencia y usuario si lo hay. `maskSensitiveData`
 * (`@erp/shared`) protege la línea aunque en el futuro se le añadan campos
 * con datos sensibles — hoy ninguno de los campos de por sí los lleva.
 *
 * Corre en la fase de interceptores (después de los guards): una petición
 * que `JwtAuthGuard`/`ThrottlerGuard` rechazan no pasa por aquí, pero sí
 * queda con su `x-request-id` puesto por el middleware, y NestJS registra
 * la excepción por su cuenta.
 *
 * Salida a `console.log` a propósito: es la interfaz de este log (JSON a
 * stdout para que lo recoja quien orqueste el proceso), no un mensaje de
 * depuración — mismo criterio que los scripts de siembra.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest & RequestWithId>();
    const res = http.getResponse<Response>();
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => this.write(req, res.statusCode, start),
        error: (err: { status?: number }) =>
          this.write(req, err.status ?? 500, start),
      }),
    );
  }

  private write(
    req: AuthenticatedRequest & RequestWithId,
    statusCode: number,
    start: number,
  ): void {
    const entry: RequestLogEntry = {
      timestamp: new Date().toISOString(),
      requestId: req.id ?? 'sin-id',
      method: req.method,
      path: req.originalUrl ?? req.url,
      statusCode,
      latencyMs: Date.now() - start,
      userId: req.user?.sub ?? null,
    };
    // eslint-disable-next-line no-console -- JSON estructurado a stdout, ver cabecera del fichero.
    console.log(JSON.stringify(maskSensitiveData(entry)));
  }
}
