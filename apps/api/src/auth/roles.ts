import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessTokenPayload, isPortalRole, UserRole } from '@erp/shared';
import type { AuthenticatedRequest } from './jwt-auth.guard';

export const ROLES_KEY = 'roles';

/** Restringe un handler/controlador a los roles indicados (requiere JwtAuthGuard antes). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** Inyecta los claims del usuario autenticado (`req.user`). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessTokenPayload =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user,
);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // Los roles de portal (Fase 14: `subcontrata`, `cliente`) son opt-in:
    // a diferencia del resto de roles, sin un `@Roles(...)` que los
    // mencione explícitamente quedan fuera. Así un endpoint interno nuevo
    // que se olvide de anotar `@Roles` no queda abierto sin querer a un
    // usuario de portal — lo contrario del resto de roles, donde no poner
    // `@Roles` significa "cualquier usuario autenticado".
    if (user && isPortalRole(user.role)) {
      if (!required || !required.includes(user.role)) {
        throw new ForbiddenException('No tienes permiso para esta operación');
      }
      return true;
    }

    if (!required || required.length === 0) return true;
    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException('No tienes permiso para esta operación');
    }
    return true;
  }
}
