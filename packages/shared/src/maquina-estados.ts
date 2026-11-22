/**
 * Máquinas de estado de los documentos: tablas de transición puras.
 *
 * Cada documento declara su tabla y sus predicados en su fichero
 * (`budgets.ts`, `delivery-notes.ts`, `invoices.ts`, `certifications.ts`).
 * Las reglas son aritmética de estados, sin base de datos ni reloj, para
 * poder comprobarlas con tests exhaustivos (matriz estado × estado).
 */

import type { BudgetStatus } from './budgets';
import { BUDGET_TRANSITIONS } from './budgets';
import type { CertStatus } from './certifications';
import { CERT_TRANSITIONS } from './certifications';
import type { CertSubcontrataStatus } from './certificaciones-subcontrata';
import { CERT_SUBCONTRATA_TRANSITIONS } from './certificaciones-subcontrata';
import type { DeliveryNoteStatus } from './delivery-notes';
import { DELIVERY_NOTE_TRANSITIONS } from './delivery-notes';
import type { InvoiceStatus } from './invoices';
import { INVOICE_TRANSITIONS } from './invoices';
import type { PurchaseOrderStatus } from './purchase-orders';
import { PURCHASE_ORDER_TRANSITIONS } from './purchase-orders';
import type { EstadoAsiento } from './contabilidad';
import { ASIENTO_TRANSITIONS } from './contabilidad';
import type { MilestoneStatus } from './treasury';
import { MILESTONE_TRANSITIONS } from './treasury';

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

/* ───────────── transición única, con error tipado ───────────── */

/** Entidades con máquina de estados y el tipo de su estado. */
export interface EstadoPorEntidad {
  invoice: InvoiceStatus;
  budget: BudgetStatus;
  certification: CertStatus;
  delivery_note: DeliveryNoteStatus;
  purchase_order: PurchaseOrderStatus;
  milestone: MilestoneStatus;
  cert_subcontrata: CertSubcontrataStatus;
  journal_entry: EstadoAsiento;
}

export type EntidadConEstado = keyof EstadoPorEntidad;

/** Transición no permitida por la máquina de estados (la API la mapea a 409). */
export class TransicionInvalidaError extends Error {
  readonly codigo = 'TRANSICION_INVALIDA';

  constructor(
    readonly entidad: EntidadConEstado,
    readonly de: string,
    readonly a: string,
  ) {
    super(
      `Transición no permitida en ${entidad}: «${de}» → «${a}»` +
        (tablaDe(entidad)[de]?.length === 0 ? ' (estado terminal)' : ''),
    );
    this.name = 'TransicionInvalidaError';
  }
}

/**
 * Búsqueda perezosa (no un objeto a nivel de módulo): los ficheros de cada
 * entidad importan este módulo, y un registro evaluado al cargar vería
 * tablas aún sin definir según el orden de importación.
 */
function tablaDe(entidad: EntidadConEstado): Record<string, readonly string[]> {
  switch (entidad) {
    case 'invoice':
      return INVOICE_TRANSITIONS;
    case 'budget':
      return BUDGET_TRANSITIONS;
    case 'certification':
      return CERT_TRANSITIONS;
    case 'delivery_note':
      return DELIVERY_NOTE_TRANSITIONS;
    case 'purchase_order':
      return PURCHASE_ORDER_TRANSITIONS;
    case 'milestone':
      return MILESTONE_TRANSITIONS;
    case 'cert_subcontrata':
      return CERT_SUBCONTRATA_TRANSITIONS;
    case 'journal_entry':
      return ASIENTO_TRANSITIONS;
  }
}

/**
 * Devuelve `a` si pasar de `de` a `a` es legal para la entidad; si no,
 * lanza `TransicionInvalidaError`. Punto único de validación de estados.
 */
export function transicion<E extends EntidadConEstado>(
  entidad: E,
  de: EstadoPorEntidad[E],
  a: EstadoPorEntidad[E],
): EstadoPorEntidad[E] {
  const permitidas = tablaDe(entidad)[de];
  if (!permitidas?.includes(a)) {
    throw new TransicionInvalidaError(entidad, de, a);
  }
  return a;
}
