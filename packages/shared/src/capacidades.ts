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
  /** Cierre y reversión del ejercicio: solo admin y gerente (segregación). */
  'cierre_ejercicio',
  /** Estimación al cierre por obra: también el jefe de obra (en sus obras). */
  'estimacion_cierre',
  /** Cartera AR/AP (anticipos, compensaciones): admin, gerente y administración. */
  'cartera',
  /** Artículos con lote o serie y su trazabilidad (almacén). */
  'lote',
  /** Solicitud de compra: la crea también el jefe de obra; aprobarla es de `compra`. */
  'solicitud_compra',
  /** Aprobar solicitudes, peticiones de ofertas, adjudicar y pedidos: admin, gerente y administración. */
  'compra',
  /** Recepción de mercancías y servicios: también el jefe de obra. */
  'recepcion',
  /** Talonarios y talones bancarios: admin, gerente y administración. */
  'talon',
  /** Liberación y sustitución de retenciones, modificados de contrato: admin, gerente y administración. */
  'retencion',
  /** Remesas SEPA y conciliación bancaria: admin, gerente y administración. */
  'banca',
  /** Ficha, jerarquía, planes preventivos y órdenes de trabajo: admin, gerente y administración. */
  'mantenimiento',
  /** Aviso de avería y lectura de contadores: también el jefe de obra. */
  'aviso_averia',
  /** Políticas SoD, niveles de aprobación, delegaciones ajenas y escalado: admin, gerente y administración. */
  'gobierno',
  /** Centros de coste, ciclos de reparto y escenarios (y ejecutar repartos): admin y gerente. */
  'control_analitico',
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
  if (recurso === 'cierre_ejercicio' || recurso === 'control_analitico')
    return rol === 'admin' || rol === 'gerente';
  const restringida =
    (accion === 'rectificar' &&
      (recurso === 'factura' || recurso === 'certificacion')) ||
    (accion === 'devolver' && recurso === 'albaran') ||
    recurso === 'contabilidad' ||
    recurso === 'aval' ||
    recurso === 'cartera' ||
    recurso === 'compra' ||
    recurso === 'talon' ||
    recurso === 'retencion' ||
    recurso === 'banca' ||
    recurso === 'mantenimiento' ||
    recurso === 'gobierno';
  if (restringida) return ROLES_RECTIFICAR.includes(rol);
  return true;
}
