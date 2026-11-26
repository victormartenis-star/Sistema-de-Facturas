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
import type { EstadoSolicitudAprobacion } from './calculo';
import { APPROVAL_REQUEST_TRANSITIONS } from './aprobaciones';
import type { EstadoAjusteConsolidacion } from './consolidacion';
import type { EstadoSolicitudMaterial } from './calculo';
import { SOLICITUD_MATERIAL_TRANSITIONS } from './solicitudes-material';
import type { EstadoWip } from './calculo';
import { WIP_TRANSITIONS } from './wip';
import type { EstadoAval } from './calculo';
import {
  DOCUMENTO_CARTERA_TRANSITIONS,
  type EstadoDocumentoCartera,
} from './cartera';
import {
  PETICION_OFERTA_TRANSITIONS,
  SOLICITUD_COMPRA_TRANSITIONS,
  type EstadoPeticionOferta,
  type EstadoSolicitudCompra,
} from './compras';
import {
  TALONARIO_TRANSITIONS,
  TALON_TRANSITIONS,
  type EstadoTalon,
  type EstadoTalonario,
} from './talones';
import { AVAL_TRANSITIONS } from './avales';
import {
  PARTIDA_REMESA_TRANSITIONS,
  REMESA_TRANSITIONS,
  type EstadoPartidaRemesa,
  type EstadoRemesa,
} from './banca';
import type { EstadoCierreEjercicio } from './cierre-ejercicio';
import { CIERRE_EJERCICIO_TRANSITIONS } from './cierre-ejercicio';
import type { EstadoAplicacionResultado } from './aplicacion-resultado';
import { APLICACION_RESULTADO_TRANSITIONS } from './aplicacion-resultado';
import { AJUSTE_CONSOLIDACION_TRANSITIONS } from './consolidacion';
import type { EstadoActivo } from './activos';
import { ACTIVO_TRANSITIONS } from './activos';
import type { EstadoAsiento } from './contabilidad';
import { ASIENTO_TRANSITIONS } from './contabilidad';
import type { MilestoneStatus, SettlementStatus } from './treasury';
import { MILESTONE_TRANSITIONS, SETTLEMENT_TRANSITIONS } from './treasury';

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
  settlement: SettlementStatus;
  fixed_asset: EstadoActivo;
  approval_request: EstadoSolicitudAprobacion;
  consolidation_adjustment: EstadoAjusteConsolidacion;
  material_request: EstadoSolicitudMaterial;
  work_in_progress: EstadoWip;
  /** Mismo ciclo que la obra en curso: contabilizado → anulado. */
  loss_provision: EstadoWip;
  bank_guarantee: EstadoAval;
  fiscal_year_closing: EstadoCierreEjercicio;
  result_application: EstadoAplicacionResultado;
  /** Mismo ciclo que la obra en curso: contabilizado → anulado. */
  bank_guarantee_accrual: EstadoWip;
  /** Anticipos y compensaciones de la cartera: vigente → anulado. */
  third_party_advance: EstadoDocumentoCartera;
  third_party_netting: EstadoDocumentoCartera;
  /** Solicitud de compra (PR) y petición de ofertas (RFQ). */
  purchase_requisition: EstadoSolicitudCompra;
  purchase_rfq: EstadoPeticionOferta;
  /** Talón o cheque bancario y su talonario. */
  check: EstadoTalon;
  checkbook: EstadoTalonario;
  /** Liberación de retenciones (aval o hito): vigente → anulado. */
  retention_release: EstadoDocumentoCartera;
  /** Remesa SEPA: borrador → generada → remitida → devuelta, o anulada. */
  sepa_remittance: EstadoRemesa;
  sepa_remittance_item: EstadoPartidaRemesa;
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
    case 'settlement':
      return SETTLEMENT_TRANSITIONS;
    case 'fixed_asset':
      return ACTIVO_TRANSITIONS;
    case 'approval_request':
      return APPROVAL_REQUEST_TRANSITIONS;
    case 'consolidation_adjustment':
      return AJUSTE_CONSOLIDACION_TRANSITIONS;
    case 'material_request':
      return SOLICITUD_MATERIAL_TRANSITIONS;
    case 'work_in_progress':
      return WIP_TRANSITIONS;
    case 'loss_provision':
      return WIP_TRANSITIONS;
    case 'bank_guarantee':
      return AVAL_TRANSITIONS;
    case 'fiscal_year_closing':
      return CIERRE_EJERCICIO_TRANSITIONS;
    case 'result_application':
      return APLICACION_RESULTADO_TRANSITIONS;
    case 'bank_guarantee_accrual':
      return WIP_TRANSITIONS;
    case 'third_party_advance':
    case 'third_party_netting':
      return DOCUMENTO_CARTERA_TRANSITIONS;
    case 'purchase_requisition':
      return SOLICITUD_COMPRA_TRANSITIONS;
    case 'purchase_rfq':
      return PETICION_OFERTA_TRANSITIONS;
    case 'check':
      return TALON_TRANSITIONS;
    case 'checkbook':
      return TALONARIO_TRANSITIONS;
    case 'retention_release':
      return DOCUMENTO_CARTERA_TRANSITIONS;
    case 'sepa_remittance':
      return REMESA_TRANSITIONS;
    case 'sepa_remittance_item':
      return PARTIDA_REMESA_TRANSITIONS;
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
