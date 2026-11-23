import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import {
  iniciarAvisosRespuesta,
  runWithRequestContext,
} from './request-context';

/** Cabecera con los avisos de negocio no bloqueantes de la respuesta. */
export const CABECERA_AVISOS = 'X-Budget-Warning';

/**
 * Publica la identidad del usuario autenticado (`req.user`, dejado por
 * `JwtAuthGuard`) en el `RequestContext` de la petición, para que
 * `DbService.getCompanyId()` la lea sin que cada servicio la reciba por
 * parámetro. En rutas `@Public()` (sin `req.user`) no hace nada.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.user) return next.handle();
    return runWithRequestContext(
      {
        userId: req.user.sub,
        companyId: req.user.companyId,
        role: req.user.role,
      },
      () => {
        const avisos = iniciarAvisosRespuesta();
        const res = context
          .switchToHttp()
          .getResponse<{ setHeader?: (k: string, v: string) => void }>();
        return next.handle().pipe(
          tap(() => {
            if (avisos.length > 0) {
              res.setHeader?.(CABECERA_AVISOS, avisos.join(', '));
            }
          }),
        );
      },
    );
  }
}
