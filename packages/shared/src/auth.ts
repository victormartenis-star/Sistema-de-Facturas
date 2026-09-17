import { z } from 'zod';

export const USER_ROLES = [
  'admin',
  'gerente',
  'administracion',
  'obra',
  'subcontrata',
  'cliente',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  gerente: 'Gerente',
  administracion: 'Administración',
  obra: 'Obra',
  subcontrata: 'Subcontrata (portal)',
  cliente: 'Cliente (portal)',
};

/** Roles de solo-portal (Fase 14): no ven la app principal, solo `apps/web/src/app/portals`. */
export const PORTAL_ROLES = ['subcontrata', 'cliente'] as const;
export type PortalRole = (typeof PORTAL_ROLES)[number];

export function isPortalRole(role: UserRole): role is PortalRole {
  return (PORTAL_ROLES as readonly UserRole[]).includes(role);
}

const email = z.string().trim().toLowerCase().email('Email no válido').max(200);

const password = z
  .string()
  .min(8, 'Mínimo 8 caracteres')
  .max(128, 'Máximo 128 caracteres');

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'La contraseña es obligatoria').max(128),
});

export const registerSchema = z.object({
  email,
  password,
  fullName: z
    .string()
    .trim()
    .min(1, 'El nombre es obligatorio')
    .max(200, 'Máximo 200 caracteres'),
  role: z.enum(USER_ROLES).default('administracion'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'El refresh token es obligatorio'),
});

/** Cambio de contraseña propia: exige la actual para confirmar identidad. */
export const changePasswordSchema = z.object({
  currentPassword: z
    .string()
    .min(1, 'La contraseña actual es obligatoria')
    .max(128),
  newPassword: password,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Reset de contraseña de otro usuario por un admin: sin la actual, solo la nueva. */
export const resetPasswordSchema = z.object({
  newPassword: password,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export type LoginInput = z.infer<typeof loginSchema>;
/** Tipo de entrada para el registro: `role` es opcional (default `'administracion'` en el servidor). */
export type RegisterInput = z.input<typeof registerSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;

export interface UserDto {
  id: string;
  companyId: string;
  email: string;
  fullName: string;
  role: UserRole;
  /** Solo relevante para role = 'subcontrata': el contacto que representa en el portal. */
  contactId: string | null;
  isActive: boolean;
  createdAt: string;
}

/** Respuesta de login / register / refresh. */
export interface AuthTokensDto {
  accessToken: string;
  /** Segundos de vida del access token. */
  expiresIn: number;
  refreshToken: string;
  user: UserDto;
}

/** Actualización de un usuario por un admin. */
export const userUpdateSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, 'El nombre es obligatorio')
    .max(200)
    .optional(),
  role: z.enum(USER_ROLES).optional(),
  /** Solo tiene efecto con role = 'subcontrata'; se ignora para el resto. */
  contactId: z.string().uuid('Contacto no válido').nullish(),
  isActive: z.boolean().optional(),
});
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

/** Creación de un usuario por un admin (con contraseña inicial). */
export const userCreateSchema = z.object({
  email,
  password,
  fullName: z
    .string()
    .trim()
    .min(1, 'El nombre es obligatorio')
    .max(200, 'Máximo 200 caracteres'),
  role: z.enum(USER_ROLES).default('administracion'),
  /** Solo tiene efecto con role = 'subcontrata'; se ignora para el resto. */
  contactId: z.string().uuid('Contacto no válido').nullish(),
});
export type UserCreateInput = z.input<typeof userCreateSchema>;

/** Claims del JWT de acceso. */
export interface AccessTokenPayload {
  sub: string;
  companyId: string;
  role: UserRole;
  email: string;
  iat: number;
  exp: number;
}
