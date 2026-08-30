import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Capability, UserRole } from '@erp/shared';

/** Usuario autenticado, tal y como lo deja la guarda en la petición. */
export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  companyId: string;
  /** Obras asignadas. Vacío en los roles transversales, que las ven todas. */
  projectIds: string[];
}

export const IS_PUBLIC = 'auth:public';
export const REQUIRED_CAPABILITY = 'auth:capability';

/** Excepción explícita a la guarda global, que deniega por defecto. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const RequireCapability = (capability: Capability) =>
  SetMetadata(REQUIRED_CAPABILITY, capability);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest().user,
);
