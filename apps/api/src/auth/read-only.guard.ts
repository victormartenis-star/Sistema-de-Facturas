import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isReadOnlyRole } from '@erp/shared';
import type { AuthenticatedRequest } from './jwt-auth.guard';

export const ALLOW_READ_ONLY_KEY = 'permiteLector';

/**
 * Marca una escritura (por verbo) que un usuario de solo lectura sí puede
 * hacer porque no modifica datos de negocio (p. ej. cambiar su contraseña).
 */
export const PermiteLector = () => SetMetadata(ALLOW_READ_ONLY_KEY, true);

const METODOS_DE_LECTURA = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Guard global (ver `AuthModule`): deniega por defecto toda escritura
 * (POST/PUT/PATCH/DELETE) a los roles de solo lectura (`lector`). Un endpoint
 * de escritura nuevo queda bloqueado sin que nadie tenga que acordarse; solo
 * pasa si lleva `@PermiteLector()`. Debe ir después de `JwtAuthGuard`
 * (necesita `req.user`).
 */
@Injectable()
export class ReadOnlyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // Sin usuario = ruta `@Public()` (login, refresh, logout...): no aplica.
    if (!req.user) return true;
    if (!isReadOnlyRole(req.user.role)) return true;
    if (METODOS_DE_LECTURA.has(req.method.toUpperCase())) return true;

    const permitido = this.reflector.getAllAndOverride<boolean | undefined>(
      ALLOW_READ_ONLY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (permitido) return true;

    throw new ForbiddenException({
      code: 'READ_ONLY_PROFILE',
      message: 'Tu perfil es de solo lectura',
    });
  }
}
