/**
 * Filtro de acceso por obra (rol `obra`).
 *
 * `DbService.getObrasAccesibles()` en la API devuelve `null` cuando el
 * usuario no tiene restricción (cualquier rol salvo `obra`), o la lista de
 * `projectId` a los que tiene acceso explícito (tabla `user_project_access`).
 * Estas funciones puras deciden si una entidad es visible dado ese filtro,
 * para no repetir la misma lógica de nulls/listas vacías en cada servicio.
 */

/**
 * Visibilidad de una entidad ligada a una única obra (un documento, una
 * obra en sí). Sin restricción (`allowed === null`) todo es visible. Con
 * restricción, una entidad sin obra asignada (`projectId === null`) NO es
 * visible: el rol `obra` solo ve lo explícitamente vinculado a sus obras.
 */
export function isProjectAllowed(
  allowed: string[] | null,
  projectId: string | null,
): boolean {
  if (allowed === null) return true;
  if (projectId === null) return false;
  return allowed.includes(projectId);
}

/**
 * Visibilidad de una entidad ligada a varias obras a la vez: una factura por
 * las obras de sus líneas, un vencimiento por la factura que lo genera, un
 * contacto por las obras de sus pedidos/albaranes. Basta con que UNA de esas
 * obras esté entre las accesibles para considerar la entidad visible.
 */
export function hasAllowedProject(
  allowed: string[] | null,
  projectIds: (string | null)[],
): boolean {
  if (allowed === null) return true;
  return projectIds.some((id) => id !== null && allowed.includes(id));
}
