'use client';

import type { ReactNode } from 'react';
import type { AccionUi, RecursoUi } from '@erp/shared';
import { usePermisos } from '@/lib/permisos';

/** Pinta `children` solo si el rol puede la acción (si no, `alternativa`). */
export function Autorizado({
  accion,
  recurso,
  children,
  alternativa = null,
}: {
  accion: AccionUi;
  recurso?: RecursoUi;
  children: ReactNode;
  alternativa?: ReactNode;
}) {
  const { can } = usePermisos();
  return <>{can(accion, recurso) ? children : alternativa}</>;
}
