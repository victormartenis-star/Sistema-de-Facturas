import { z } from 'zod';

/**
 * Roles y permisos.
 *
 * Los roles son los del organigrama del manual de procesos, no una escala
 * genérica de "admin / usuario". Cada uno existe porque en la empresa hay
 * alguien que hace exactamente eso, y sus permisos salen del reparto de
 * responsabilidades del apartado 5.2.
 */

export const USER_ROLES = [
  'direccion',
  'jefe_grupo',
  'jefe_obra',
  'encargado',
  'estudios',
  'compras',
  'administracion',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  direccion: 'Dirección técnica y económica',
  jefe_grupo: 'Jefe de Grupo',
  jefe_obra: 'Jefe de Obra',
  encargado: 'Encargado',
  estudios: 'Estudios',
  compras: 'Compras',
  administracion: 'Administración',
};

export const USER_ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  direccion:
    'Ve todas las obras, aprueba modificados y gestiona los usuarios del sistema',
  jefe_grupo:
    'Responde del resultado económico de su grupo de obras y contrasta el coste probable de sus jefes de obra',
  jefe_obra:
    'Ejecución, medición y certificación, solicitud de compra y previsión de coste de sus obras',
  encargado:
    'Recepción de material y validación de albaranes en las obras que lleva',
  estudios:
    'Presupuesto de venta, coste objetivo y planificación económica inicial',
  compras:
    'Ofertas, emisión de pedidos y control documental de las subcontratas',
  administracion: 'Certificaciones, facturas, vencimientos, cobros y pagos',
};

/* ─────────────────────────── capacidades ─────────────────────────── */

/**
 * Se comprueba la capacidad, no el rol. Añadir un rol nuevo no obliga a
 * repasar cada endpoint buscando comparaciones con nombres de puesto.
 */
export const CAPABILITIES = [
  'usuarios.gestionar',
  /** Consultar el registro de auditoría. */
  'auditoria.ver',
  /** Ver márgenes, coste probable y desviaciones. */
  'economico.ver',
  /** Ver todas las obras de la empresa, no solo las asignadas. */
  'obras.ver.todas',
  'obras.gestionar',
  /** Presupuesto de venta, coste objetivo y planificación mensual. */
  'presupuesto.definir',
  /** Declarar el coste pendiente de contratar y ejecutar. */
  'prevision.declarar',
  /** Emitir pedidos: centralizado en el Departamento de Compras. */
  'pedidos.emitir',
  /** Validar albaranes contra su pedido. */
  'albaranes.validar',
  'facturas.gestionar',
  'certificaciones.gestionar',
  'tesoreria.gestionar',
  /** Registrar una modificación; aprobarla es otra capacidad. */
  'modificados.registrar',
  /** Registrar las firmas de la DF y de la Propiedad. */
  'modificados.aprobar',
  'contactos.gestionar',
  'homologacion.gestionar',
  /** Licencias, acometidas y suministros. */
  'tramites.gestionar',
  /** Expedientes de cese de obra: el manual se lo asigna al Jefe de Obra. */
  'paradas.gestionar',
  'documentos.subir',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * Reparto de capacidades por rol.
 *
 * Dos criterios que conviene no perder de vista:
 *
 * - **Compras emite, obra solicita.** La regla de oro exige centralizar las
 *   compras, así que el jefe de obra no puede emitir pedidos por su cuenta.
 * - **Quien registra un modificado no lo aprueba.** Las firmas de la DF y de
 *   la Propiedad las recoge Dirección; si el jefe de obra pudiera darlas por
 *   buenas, el control desaparecería.
 */
const ROLE_CAPABILITIES: Record<UserRole, readonly Capability[]> = {
  direccion: CAPABILITIES,

  jefe_grupo: [
    'economico.ver',
    'obras.gestionar',
    'presupuesto.definir',
    'prevision.declarar',
    'certificaciones.gestionar',
    'modificados.registrar',
    'contactos.gestionar',
    'tramites.gestionar',
    'paradas.gestionar',
    'documentos.subir',
  ],

  jefe_obra: [
    'economico.ver',
    'prevision.declarar',
    'certificaciones.gestionar',
    'modificados.registrar',
    'albaranes.validar',
    'tramites.gestionar',
    'paradas.gestionar',
    'documentos.subir',
  ],

  // El encargado controla la puerta de la obra: recibe material y valida
  // albaranes. No ve márgenes ni tesorería de la empresa.
  encargado: ['albaranes.validar', 'documentos.subir'],

  estudios: [
    'obras.ver.todas',
    'obras.gestionar',
    'presupuesto.definir',
    'economico.ver',
    'documentos.subir',
  ],

  compras: [
    'obras.ver.todas',
    'pedidos.emitir',
    'contactos.gestionar',
    'homologacion.gestionar',
    'economico.ver',
    'documentos.subir',
  ],

  administracion: [
    'obras.ver.todas',
    'economico.ver',
    'facturas.gestionar',
    'certificaciones.gestionar',
    'tesoreria.gestionar',
    'contactos.gestionar',
    // Tasas y avales de los trámites los lleva Administración
    'tramites.gestionar',
    'documentos.subir',
  ],
};

export function can(role: UserRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

export function capabilitiesOf(role: UserRole): Capability[] {
  return [...ROLE_CAPABILITIES[role]];
}

/* ────────────────────── alcance por obra ────────────────────── */

/**
 * Roles cuyo acceso se limita a las obras que tienen asignadas. El resto de
 * roles son transversales: Compras trabaja con todas las obras a la vez, y
 * Administración factura todas.
 */
export function isProjectScoped(role: UserRole): boolean {
  return !can(role, 'obras.ver.todas') && role !== 'direccion';
}

/* ────────────────────── esquemas y DTOs ────────────────────── */

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email no válido'),
  password: z.string().min(1, 'La contraseña es obligatoria'),
});

export type LoginInput = z.input<typeof loginSchema>;

export const userCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email no válido'),
  fullName: z.string().trim().min(1, 'El nombre es obligatorio').max(120),
  role: z.enum(USER_ROLES),
  password: z
    .string()
    .min(10, 'La contraseña debe tener al menos 10 caracteres')
    .max(200),
});

export type UserCreateInput = z.input<typeof userCreateSchema>;

export const userUpdateSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  role: z.enum(USER_ROLES).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(10, 'Mínimo 10 caracteres').max(200).optional(),
});

export type UserUpdateInput = z.input<typeof userUpdateSchema>;

export interface UserDto {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  /** Obras en las que interviene, con el papel que ocupa en cada una. */
  projects: { id: string; code: string; as: ProjectAssignment }[];
  lastLoginAt: string | null;
  createdAt: string;
}

export const PROJECT_ASSIGNMENTS = [
  'jefe_grupo',
  'jefe_obra',
  'encargado',
] as const;

export type ProjectAssignment = (typeof PROJECT_ASSIGNMENTS)[number];

export const PROJECT_ASSIGNMENT_LABELS: Record<ProjectAssignment, string> = {
  jefe_grupo: 'Jefe de Grupo',
  jefe_obra: 'Jefe de Obra',
  encargado: 'Encargado',
};

/** Asignación de responsables a una obra (hito E1 del ciclo de vida). */
export const projectStaffSchema = z.object({
  groupManagerId: z.string().uuid('Jefe de Grupo no válido').nullish(),
  siteManagerId: z.string().uuid('Jefe de Obra no válido').nullish(),
  foremanId: z.string().uuid('Encargado no válido').nullish(),
});

export type ProjectStaffInput = z.input<typeof projectStaffSchema>;

export interface SessionDto {
  token: string;
  user: UserDto;
  capabilities: Capability[];
}
