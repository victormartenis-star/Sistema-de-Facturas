import { z } from 'zod';

/**
 * Promoción inmobiliaria, comercialización y postventa: unidades en venta
 * de una promoción (obra), su reserva/venta a un comprador, el plan de
 * cobros pactado, el acta de entrega de llaves y las incidencias de
 * postventa/garantía una vez entregada. El comprador es un `contact` más
 * (mismo maestro que proveedores/clientes) — no hay un tipo de contacto
 * "comprador" aparte.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD');

/* ────────────────────── unidades ────────────────────── */

export const REAL_ESTATE_UNIT_KINDS = [
  'vivienda',
  'local',
  'garaje',
  'trastero',
  'otro',
] as const;
export type RealEstateUnitKind = (typeof REAL_ESTATE_UNIT_KINDS)[number];

export const REAL_ESTATE_UNIT_KIND_LABELS: Record<RealEstateUnitKind, string> =
  {
    vivienda: 'Vivienda',
    local: 'Local',
    garaje: 'Garaje',
    trastero: 'Trastero',
    otro: 'Otro',
  };

export const REAL_ESTATE_UNIT_STATUSES = [
  'disponible',
  'reservada',
  'vendida',
  'entregada',
] as const;
export type RealEstateUnitStatus = (typeof REAL_ESTATE_UNIT_STATUSES)[number];

export const REAL_ESTATE_UNIT_STATUS_LABELS: Record<
  RealEstateUnitStatus,
  string
> = {
  disponible: 'Disponible',
  reservada: 'Reservada',
  vendida: 'Vendida',
  entregada: 'Entregada',
};

export const realEstateUnitCreateSchema = z.object({
  projectId: z.string().uuid('Obra no válida'),
  code: z.string().trim().min(1, 'El identificador es obligatorio').max(30),
  kind: z.enum(REAL_ESTATE_UNIT_KINDS).default('vivienda'),
  surfaceM2: z.number().positive('Debe ser mayor que 0').nullish(),
  salePrice: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .nonnegative('No puede ser negativo')
    .max(999_999_999.99),
  notes: z.string().trim().max(2000).nullish(),
});
export const realEstateUnitUpdateSchema = realEstateUnitCreateSchema
  .omit({ projectId: true })
  .partial();

export type RealEstateUnitCreateInput = z.input<
  typeof realEstateUnitCreateSchema
>;
export type RealEstateUnitUpdateInput = z.input<
  typeof realEstateUnitUpdateSchema
>;

export interface RealEstateUnitDto {
  id: string;
  projectId: string;
  projectCode: string;
  code: string;
  kind: RealEstateUnitKind;
  surfaceM2: number | null;
  salePrice: number;
  status: RealEstateUnitStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ────────────────────── reservas ────────────────────── */

export const REAL_ESTATE_RESERVATION_STATUSES = [
  'reservada',
  'contrato_firmado',
  'escriturada',
  'cancelada',
] as const;
export type RealEstateReservationStatus =
  (typeof REAL_ESTATE_RESERVATION_STATUSES)[number];

export const REAL_ESTATE_RESERVATION_STATUS_LABELS: Record<
  RealEstateReservationStatus,
  string
> = {
  reservada: 'Reservada',
  contrato_firmado: 'Contrato privado firmado',
  escriturada: 'Escriturada',
  cancelada: 'Cancelada',
};

export const realEstateReservationCreateSchema = z.object({
  unitId: z.string().uuid('Unidad no válida'),
  buyerContactId: z.string().uuid('Comprador no válido'),
  reservationDate: isoDate,
  agreedPrice: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .positive('Debe ser mayor que 0')
    .max(999_999_999.99),
  signalAmount: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .nonnegative('No puede ser negativo')
    .default(0),
  notes: z.string().trim().max(2000).nullish(),
});
export type RealEstateReservationCreateInput = z.input<
  typeof realEstateReservationCreateSchema
>;

export const realEstateReservationCancelSchema = z.object({
  reason: z.string().trim().max(500).nullish(),
});
export type RealEstateReservationCancelInput = z.input<
  typeof realEstateReservationCancelSchema
>;

export const realEstateReservationContractSchema = z.object({
  contractDate: isoDate,
});
export type RealEstateReservationContractInput = z.input<
  typeof realEstateReservationContractSchema
>;

export const realEstateReservationDeedSchema = z.object({
  deedDate: isoDate,
});
export type RealEstateReservationDeedInput = z.input<
  typeof realEstateReservationDeedSchema
>;

export interface RealEstateReservationDto {
  id: string;
  unitId: string;
  unitCode: string;
  buyerContactId: string;
  buyerName: string;
  status: RealEstateReservationStatus;
  reservationDate: string;
  agreedPrice: number;
  signalAmount: number;
  contractDate: string | null;
  deedDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ────────────────────── plan de cobros ────────────────────── */

export const REAL_ESTATE_PAYMENT_STATUSES = ['previsto', 'cobrado'] as const;
export type RealEstatePaymentStatus =
  (typeof REAL_ESTATE_PAYMENT_STATUSES)[number];

export const realEstatePaymentMilestoneCreateSchema = z.object({
  concept: z.string().trim().min(1, 'El concepto es obligatorio').max(200),
  dueDate: isoDate,
  amount: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .positive('Debe ser mayor que 0')
    .max(999_999_999.99),
});
export type RealEstatePaymentMilestoneCreateInput = z.input<
  typeof realEstatePaymentMilestoneCreateSchema
>;

export interface RealEstatePaymentMilestoneDto {
  id: string;
  reservationId: string;
  concept: string;
  dueDate: string;
  amount: number;
  status: RealEstatePaymentStatus;
  paidAt: string | null;
}

/* ────────────────────── entrega de llaves ────────────────────── */

export const realEstateKeyHandoverCreateSchema = z.object({
  handoverDate: isoDate,
  documentId: z.string().uuid('Documento no válido').nullish(),
  notes: z.string().trim().max(2000).nullish(),
});
export type RealEstateKeyHandoverCreateInput = z.input<
  typeof realEstateKeyHandoverCreateSchema
>;

export interface RealEstateKeyHandoverDto {
  id: string;
  reservationId: string;
  handoverDate: string;
  documentId: string | null;
  notes: string | null;
  createdAt: string;
}

/* ────────────────────── postventa ────────────────────── */

export const POSTVENTA_INCIDENT_CATEGORIES = [
  'albanileria',
  'fontaneria',
  'electricidad',
  'carpinteria',
  'climatizacion',
  'otros',
] as const;
export type PostventaIncidentCategory =
  (typeof POSTVENTA_INCIDENT_CATEGORIES)[number];

export const POSTVENTA_INCIDENT_CATEGORY_LABELS: Record<
  PostventaIncidentCategory,
  string
> = {
  albanileria: 'Albañilería',
  fontaneria: 'Fontanería',
  electricidad: 'Electricidad',
  carpinteria: 'Carpintería',
  climatizacion: 'Climatización',
  otros: 'Otros',
};

export const POSTVENTA_INCIDENT_STATUSES = [
  'abierta',
  'en_reparacion',
  'cerrada',
] as const;
export type PostventaIncidentStatus =
  (typeof POSTVENTA_INCIDENT_STATUSES)[number];

export const POSTVENTA_INCIDENT_STATUS_LABELS: Record<
  PostventaIncidentStatus,
  string
> = {
  abierta: 'Abierta',
  en_reparacion: 'En reparación',
  cerrada: 'Cerrada',
};

export const postventaIncidentCreateSchema = z.object({
  unitId: z.string().uuid('Unidad no válida'),
  reportedByContactId: z.string().uuid('Contacto no válido').nullish(),
  category: z.enum(POSTVENTA_INCIDENT_CATEGORIES).default('otros'),
  description: z
    .string()
    .trim()
    .min(1, 'La descripción es obligatoria')
    .max(2000),
  reportedAt: isoDate,
  warrantyDeadline: isoDate.nullish(),
  notes: z.string().trim().max(2000).nullish(),
});
export type PostventaIncidentCreateInput = z.input<
  typeof postventaIncidentCreateSchema
>;

export const postventaIncidentUpdateStatusSchema = z.object({
  status: z.enum(POSTVENTA_INCIDENT_STATUSES),
  notes: z.string().trim().max(2000).nullish(),
});
export type PostventaIncidentUpdateStatusInput = z.input<
  typeof postventaIncidentUpdateStatusSchema
>;

export interface PostventaIncidentDto {
  id: string;
  unitId: string;
  unitCode: string;
  reportedByContactId: string | null;
  reportedByName: string | null;
  category: PostventaIncidentCategory;
  description: string;
  status: PostventaIncidentStatus;
  reportedAt: string;
  resolvedAt: string | null;
  warrantyDeadline: string | null;
  /** true si `warrantyDeadline` ya pasó y la incidencia sigue abierta. */
  warrantyExpired: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ────────────────────── cálculo puro ────────────────────── */

/** % de la promoción vendido/entregado, para el panel de comercialización. */
export function computeCommercializationPct(
  units: { status: RealEstateUnitStatus }[],
): { vendidasPct: number; entregadasPct: number } {
  if (units.length === 0) return { vendidasPct: 0, entregadasPct: 0 };
  const vendidas = units.filter(
    (u) => u.status === 'vendida' || u.status === 'entregada',
  ).length;
  const entregadas = units.filter((u) => u.status === 'entregada').length;
  return {
    vendidasPct: Math.round((vendidas / units.length) * 1000) / 10,
    entregadasPct: Math.round((entregadas / units.length) * 1000) / 10,
  };
}
