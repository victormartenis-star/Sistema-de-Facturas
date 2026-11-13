'use client';

import { useCallback } from 'react';
import { can, type AccionUi, type RecursoUi } from '@erp/shared';
import { useAuth } from '@/lib/auth';

/**
 * Permisos de interfaz del usuario actual. Solo cosmético: oculta botones
 * que acabarían en 403. La autoridad es la API.
 */
export function usePermisos() {
  const { user, soloLectura } = useAuth();
  const puede = useCallback(
    (accion: AccionUi, recurso?: RecursoUi) => can(user?.role, accion, recurso),
    [user?.role],
  );
  return { can: puede, soloLectura };
}
