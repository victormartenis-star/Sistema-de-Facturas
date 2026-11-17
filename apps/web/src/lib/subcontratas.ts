import {
  isPortalRole,
  isReadOnlyRole,
  type CertSubcontrataDto,
  type CertSubcontrataStatus,
  type UserRole,
} from '@erp/shared';

/**
 * Reglas de presentación de la vista de subcontratas. SOLO COSMÉTICO: la
 * autoridad es la API (`@Roles` y reglas del servicio). Espejo de
 * `ROLES_MEDICION` y `ROLES_FINANZAS` en `subcontratas.controller.ts`.
 */
const ROLES_FINANZAS: readonly UserRole[] = [
  'admin',
  'gerente',
  'administracion',
];

export function puedeMedir(rol: UserRole | null | undefined): boolean {
  return !!rol && !isPortalRole(rol) && !isReadOnlyRole(rol);
}

export function puedeGestionarDinero(
  rol: UserRole | null | undefined,
): boolean {
  return !!rol && ROLES_FINANZAS.includes(rol);
}

export type AccionCert = 'editar' | 'eliminar' | 'aprobar' | 'pagar' | 'anular';

/**
 * Acciones visibles para una certificación. `anular` en una aprobada solo
 * si es la última no anulada del contrato (la API responde 409 si no).
 */
export function accionesCert(
  cert: Pick<CertSubcontrataDto, 'id' | 'numero' | 'status'>,
  todas: readonly Pick<CertSubcontrataDto, 'numero' | 'status'>[],
  rol: UserRole | null | undefined,
): AccionCert[] {
  const acciones: AccionCert[] = [];
  const medir = puedeMedir(rol);
  const dinero = puedeGestionarDinero(rol);
  if (cert.status === 'borrador') {
    if (medir) acciones.push('editar', 'eliminar');
    if (dinero) acciones.push('aprobar');
  }
  if (cert.status === 'aprobada' && dinero) {
    acciones.push('pagar');
    const esUltima = !todas.some(
      (c) => c.numero > cert.numero && c.status !== 'anulada',
    );
    if (esUltima) acciones.push('anular');
  }
  return acciones;
}

export const TONO_ESTADO_CERT: Record<CertSubcontrataStatus, string> = {
  borrador: 'bg-gray-100 text-gray-600',
  aprobada: 'bg-blue-100 text-blue-700',
  pagada: 'bg-emerald-100 text-emerald-700',
  anulada: 'bg-red-100 text-red-700',
};

/** Ancho (0-100) de la barra de ejecución del contrato. */
export function anchoEjecucion(pct: number): number {
  if (!Number.isFinite(pct) || pct < 0) return 0;
  return Math.min(100, pct);
}
