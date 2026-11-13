/**
 * Máquinas de estado de los documentos: tablas de transición puras.
 *
 * Cada documento declara su tabla y sus predicados en su fichero
 * (`budgets.ts`, `delivery-notes.ts`, `invoices.ts`, `certifications.ts`).
 * Las reglas son aritmética de estados, sin base de datos ni reloj, para
 * poder comprobarlas con tests exhaustivos (matriz estado × estado).
 */

/** Para cada estado, los estados a los que se puede pasar. */
export type Transiciones<S extends string> = Readonly<Record<S, readonly S[]>>;

export function puedeTransitar<S extends string>(
  t: Transiciones<S>,
  de: S,
  a: S,
): boolean {
  return t[de].includes(a);
}

/** `null` si la transición es válida; si no, mensaje listo para el 409. */
export function motivoTransicionInvalida<S extends string>(
  t: Transiciones<S>,
  de: S,
  a: S,
  etiquetas: Record<S, string>,
  documento: string,
): string | null {
  if (puedeTransitar(t, de, a)) return null;
  if (t[de].length === 0) {
    return `${documento} está en estado terminal «${etiquetas[de]}» y no admite cambios de estado`;
  }
  return `${documento} no puede pasar de «${etiquetas[de]}» a «${etiquetas[a]}»`;
}
