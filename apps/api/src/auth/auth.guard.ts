import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { USER_ROLE_LABELS, can, type Capability } from '@erp/shared';
import { AuthService } from './auth.service';
import { IS_PUBLIC, REQUIRED_CAPABILITY } from './auth.decorators';
import { TokenService } from './token.service';

/**
 * Guarda global: **deniega por defecto**.
 *
 * Es la diferencia entre olvidarse de proteger un endpoint nuevo y olvidarse
 * de abrirlo. Lo primero es una fuga de datos silenciosa; lo segundo, un 401
 * que se ve el primer día.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const controller = context.getClass();

    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        handler,
        controller,
      ])
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Necesitas iniciar sesión');
    }

    const payload = this.tokens.verify(token);
    // Se recarga el usuario en cada petición: desactivar a alguien surte
    // efecto de inmediato y no cuando caduque su token.
    const user = await this.auth.resolveUser(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Tu cuenta ya no está activa');
    }
    request.user = user;

    const capability = this.reflector.getAllAndOverride<Capability>(
      REQUIRED_CAPABILITY,
      [handler, controller],
    );
    if (capability && !can(user.role, capability)) {
      throw new ForbiddenException(
        `Tu perfil (${USER_ROLE_LABELS[user.role]}) no tiene permiso para esta acción`,
      );
    }
    return true;
  }
}

/**
 * El token viaja en la cabecera. Se acepta además por query solo en GET, para
 * que el navegador pueda abrir la descarga de un documento en una pestaña:
 * es una concesión conocida y limitada a lectura, no a escritura.
 */
function extractToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  if (request.method === 'GET' && typeof request.query.token === 'string') {
    return request.query.token;
  }
  return null;
}
