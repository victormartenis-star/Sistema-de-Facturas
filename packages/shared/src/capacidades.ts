import { isPortalRole, isReadOnlyRole, type UserRole } from './auth';

/**
 * Capacidades de interfaz por rol. SOLO COSMÉTICO: decide qué botones se
 * muestran, no qué está permitido. La autoridad es la API (`ReadOnlyGuard`,
 * `@Roles`); ninguna regla de negocio puede depender de `can()`.
 */
export const ACCIONES_UI = [
  'crear',
  'editar',
  'borrar',
  'anular',
  'rectificar',
  'devolver',
  'duplicar',
  'importar',
  /** Aprobar, pagar/cobrar, validar, facturar, activar, cerrar. */
  'cambiarEstado',
  /** Lectura (GET): permitida al lector. */
  'exportar',
] as const;
export type AccionUi = (typeof ACCIONES_UI)[number];

export const RECURSOS_UI = [
  'presupuesto',
  'certificacion',
  'albaran',
  'factura',
  'obra',
  'partida',
  /** Contabilidad general: solo admin, gerente y administración la mutan. */
  'contabilidad',
  /** Avales bancarios: tesorería; solo admin, gerente y administración los mutan. */
  'aval',
] as const;
export type RecursoUi = (typeof RECURSOS_UI)[number];

/** Roles que la API deja rectificar/devolver (espejo de `@Roles`). */
const ROLES_RECTIFICAR: readonly UserRole[] = [
  'admin',
  'gerente',
  'administracion',
];

export function can(
  rol: UserRole | null | undefined,
  accion: AccionUi,
  recurso?: RecursoUi,
): boolean {
  if (!rol) return false;
  if (isPortalRole(rol)) return false;
  if (accion === 'exportar') return true;
  if (isReadOnlyRole(rol)) return false;
  const restringida =
    (accion === 'rectificar' &&
      (recurso === 'factura' || recurso === 'certificacion')) ||
    (accion === 'devolver' && recurso === 'albaran') ||
    recurso === 'contabilidad' ||
    recurso === 'aval';
  if (restringida) return ROLES_RECTIFICAR.includes(rol);
  return true;
}
