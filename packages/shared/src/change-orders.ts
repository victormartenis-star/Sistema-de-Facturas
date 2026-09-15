import { z } from 'zod';
import { round2 } from './calculo';

/**
 * Contradictorios y modificados (Fase 14).
 *
 * Workflow de aprobación de precios contradictorios/modificados con la
 * Dirección Facultativa: `borrador` (editable) → `enviado_df` (esperando
 * resolución) → `aprobado`/`rechazado` (cerrado, ya no se edita). No toca
 * `budget_items` directamente: la certificación del modificado aprobado
 * sigue el circuito normal de certificaciones, igual que cualquier partida.
 */

export const CHANGE_ORDER_TIPOS = ['contradictorio', 'modificado'] as const;
export type ChangeOrderTipo = (typeof CHANGE_ORDER_TIPOS)[number];

export const CHANGE_ORDER_TIPO_LABELS: Record<ChangeOrderTipo, string> = {
  contradictorio: 'Precio contradictorio',
  modificado: 'Modificado de obra',
};

export const CHANGE_ORDER_ESTADOS = [
  'borrador',
  'enviado_df',
  'aprobado',
  'rechazado',
] as const;
export type ChangeOrderEstado = (typeof CHANGE_ORDER_ESTADOS)[number];

export const CHANGE_ORDER_ESTADO_LABELS: Record<ChangeOrderEstado, string> = {
  borrador: 'Borrador',
  enviado_df: 'Enviado a Dirección Facultativa',
  aprobado: 'Aprobado',
  rechazado: 'Rechazado',
};

/* ─────────────────────────── numeración ─────────────────────────── */

/**
 * Número del contradictorio/modificado: código de obra + correlativo propio
 * de esa obra, mismo criterio que `buildOrderNumber` de pedidos.
 *
 *   OBR-045 + 7 → OBR-045-CO-0007
 */
export function buildChangeOrderNumber(
  projectCode: string,
  seq: number,
): string {
  return `${projectCode}-CO-${String(seq).padStart(4, '0')}`;
}

/* ────────────────────── líneas ────────────────────── */

export const changeOrderLineaSchema = z.object({
  budgetItemId: z.string().uuid('Partida no válida').nullish(),
  descripcion: z
    .string()
    .trim()
    .min(1, 'La descripción es obligatoria')
    .max(500),
  unidad: z.string().trim().min(1, 'La unidad es obligatoria').max(20),
  cantidad: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .positive('La cantidad debe ser mayor que cero')
    .max(999_999_999),
  precioUnitario: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .nonnegative('No puede ser negativo')
    .max(999_999_999),
});

export type ChangeOrderLineaInput = z.input<typeof changeOrderLineaSchema>;

export interface ChangeOrderLineaDto {
  id: string;
  budgetItemId: string | null;
  descripcion: string;
  unidad: string;
  cantidad: number;
  precioUnitario: number;
  importe: number;
}

/* ────────────────────── cabecera ────────────────────── */

export const changeOrderCreateSchema = z.object({
  projectId: z.string().uuid('La obra es obligatoria'),
  phaseId: z.string().uuid('Fase no válida').nullish(),
  tipo: z.enum(CHANGE_ORDER_TIPOS).default('contradictorio'),
  titulo: z
    .string()
    .trim()
    .min(1, 'El título es obligatorio')
    .max(200, 'Máximo 200 caracteres'),
  descripcion: z
    .string()
    .trim()
    .min(1, 'La descripción es obligatoria')
    .max(4000),
  motivo: z.string().trim().max(1000).nullish(),
  direccionFacultativaContactId: z
    .string()
    .uuid('Contacto no válido')
    .nullish(),
  documentId: z.string().uuid('Documento no válido').nullish(),
  notas: z.string().trim().max(1000).nullish(),
  lineas: z.array(changeOrderLineaSchema).default([]),
});

export const changeOrderUpdateSchema = changeOrderCreateSchema
  .omit({ projectId: true })
  .partial();

export type ChangeOrderCreateInput = z.input<typeof changeOrderCreateSchema>;
export type ChangeOrderUpdateInput = z.input<typeof changeOrderUpdateSchema>;

/** Envía el borrador a la Dirección Facultativa: exige tener a quién enviarlo. */
export const changeOrderEnviarSchema = z.object({
  direccionFacultativaContactId: z
    .string()
    .uuid('Selecciona el contacto de Dirección Facultativa'),
});
export type ChangeOrderEnviarInput = z.input<typeof changeOrderEnviarSchema>;

/** Resuelve un contradictorio/modificado enviado: aprueba o rechaza. */
export const changeOrderResolverSchema = z.object({
  estado: z.enum(['aprobado', 'rechazado']),
  importeAprobado: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .nonnegative('No puede ser negativo')
    .max(999_999_999)
    .nullish(),
  comentarioResolucion: z.string().trim().max(2000).nullish(),
});
export type ChangeOrderResolverInput = z.input<
  typeof changeOrderResolverSchema
>;

export interface ChangeOrderDto {
  id: string;
  projectId: string;
  phaseId: string | null;
  phaseCode: string | null;
  phaseName: string | null;
  numero: string;
  tipo: ChangeOrderTipo;
  estado: ChangeOrderEstado;
  titulo: string;
  descripcion: string;
  motivo: string | null;
  direccionFacultativaContactId: string | null;
  direccionFacultativaNombre: string | null;
  importeEstimado: number;
  importeAprobado: number | null;
  documentId: string | null;
  fechaEnvio: string | null;
  fechaResolucion: string | null;
  comentarioResolucion: string | null;
  notas: string | null;
  lineas: ChangeOrderLineaDto[];
  createdAt: string;
  updatedAt: string;
}

/* ────────────────────── cálculo puro ────────────────────── */

export function computeLineaImporte(
  cantidad: number,
  precioUnitario: number,
): number {
  return round2(cantidad * precioUnitario);
}

export function computeChangeOrderTotal(lineas: { importe: number }[]): number {
  return round2(lineas.reduce((sum, l) => sum + l.importe, 0));
}

/** Solo un borrador se puede editar o enviar; un enviado solo se resuelve. */
export function canEditChangeOrder(estado: ChangeOrderEstado): boolean {
  return estado === 'borrador';
}
export function canResolveChangeOrder(estado: ChangeOrderEstado): boolean {
  return estado === 'enviado_df';
}
