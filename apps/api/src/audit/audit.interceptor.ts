import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { AuditService, preparePayload } from './audit.service';

/** Verbos que modifican estado. Las lecturas no se auditan: serían ruido. */
const VERBOS_DE_ESCRITURA = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * El acceso lo registra `AuthService`, no el interceptor. Es una ruta pública,
 * así que aquí no hay usuario resuelto y la entrada saldría anónima
 * precisamente en el evento que más interesa saber de quién es. Además el
 * servicio puede anotar también los intentos fallidos, que el interceptor no
 * llega a ver porque la petición termina en excepción.
 */
const RUTAS_CON_AUDITORIA_PROPIA = ['/auth/login'];

/**
 * Interceptor global de auditoría.
 *
 * Se registra aquí y no dentro de cada servicio a propósito: una auditoría
 * que depende de que alguien se acuerde de llamarla se queda con agujeros
 * justo en los sitios nuevos, que son los que más interesa vigilar. Con el
 * interceptor, un endpoint nuevo queda auditado sin hacer nada.
 *
 * Solo se anotan las operaciones que **salen bien**: un intento rechazado ya
 * lo recoge el log de errores, y mezclarlos convertiría el registro en una
 * lista de ruido donde no se encuentra lo que de verdad pasó.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    if (
      !VERBOS_DE_ESCRITURA.has(request.method) ||
      RUTAS_CON_AUDITORIA_PROPIA.includes(request.path)
    ) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse<Response>();
        const user = request.user;
        const params = (request.params ?? {}) as Record<string, string>;

        void this.audit.record({
          companyId: user?.companyId ?? null,
          userId: user?.id ?? null,
          userEmail: user?.email ?? null,
          userName: user?.fullName ?? null,
          userRole: user?.role ?? null,
          action: `${request.method} ${routePattern(request)}`,
          entity: entityOf(request),
          entityId: params.id ?? params.projectId ?? null,
          payload: preparePayload(request.body),
          statusCode: response.statusCode,
          ip: request.ip ?? null,
        });
      }),
    );
  }
}

/** Patrón de la ruta (`/variations/:id/aprobar`), no la URL con el UUID. */
function routePattern(request: Request): string {
  const route = (request as Request & { route?: { path?: string } }).route;
  return route?.path ?? request.path;
}

/** Primer segmento de la ruta: el módulo al que pertenece la operación. */
function entityOf(request: Request): string {
  return routePattern(request).split('/').filter(Boolean)[0] ?? 'desconocido';
}
