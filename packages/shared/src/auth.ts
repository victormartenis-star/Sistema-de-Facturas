import { z } from 'zod';

export const USER_ROLES = [
  'admin',
  'gerente',
  'administracion',
  'obra',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  gerente: 'Gerente',
  administracion: 'Administración',
  obra: 'Obra',
};

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
