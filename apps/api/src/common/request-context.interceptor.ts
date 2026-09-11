import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { runWithRequestContext } from './request-context';

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
      () => next.handle(),
    );
  }
}
