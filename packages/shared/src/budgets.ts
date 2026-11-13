import { z } from 'zod';
import { type Transiciones, puedeTransitar } from './maquina-estados';

export const BUDGET_STATUSES = ['borrador', 'activo', 'cerrado'] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

export const BUDGET_STATUS_LABELS: Record<BudgetStatus, string> = {
  borrador: 'Borrador',
  activo: 'Activo',
  cerrado: 'Cerrado',
};

/**
 * Transiciones de presupuesto (usuario). Activar cierra el activo anterior de
 * la obra en la misma transacción. `cerrado` es terminal: la corrección de un
 * presupuesto activo o cerrado es una **nueva versión** (`POST /budgets/:id/duplicar`).
 */
export const BUDGET_TRANSITIONS: Transiciones<BudgetStatus> = {
  borrador: ['activo'],
  activo: ['cerrado'],
  cerrado: [],
};

export function canTransitionBudget(
  from: BudgetStatus,
  to: BudgetStatus,
): boolean {
  return puedeTransitar(BUDGET_TRANSITIONS, from, to);
}

const MENSAJE_NUEVA_VERSION =
  'Para corregirlo, duplica el presupuesto y trabaja sobre la nueva versión';

/**
 * Edición de la cabecera según estado. `campos` son los campos de
 * `budgetUpdateSchema` presentes en la petición, sin `status` (la transición
 * se valida aparte). Nombre: solo borrador; notas: borrador y activo.
 */
export function budgetEditBlockReason(
  status: BudgetStatus,
  campos: readonly string[],
): string | null {
  if (campos.length === 0 || status === 'borrador') return null;
  if (status === 'cerrado') {
    return `Un presupuesto cerrado no se puede editar. ${MENSAJE_NUEVA_VERSION}`;
  }
  if (campos.includes('name')) {
    return `El nombre de un presupuesto activo no se puede cambiar. ${MENSAJE_NUEVA_VERSION}`;
  }
  return null;
}

/** Campos de partida que no cambian importes: se pueden tocar con el presupuesto activo. */
const CAMPOS_ANALITICOS_PARTIDA: readonly string[] = ['phaseId', 'sortOrder'];

/** Edición de una partida según el estado de su presupuesto. */
export function budgetItemEditBlockReason(
  status: BudgetStatus,
  campos: readonly string[],
): string | null {
  if (campos.length === 0 || status === 'borrador') return null;
  if (status === 'cerrado') {
    return `Las partidas de un presupuesto cerrado no se pueden editar. ${MENSAJE_NUEVA_VERSION}`;
  }
  const economicos = campos.filter(
    (c) => !CAMPOS_ANALITICOS_PARTIDA.includes(c),
  );
  if (economicos.length > 0) {
    return `Los campos económicos de una partida de un presupuesto activo no se pueden editar (${economicos.join(', ')}). ${MENSAJE_NUEVA_VERSION}`;
  }
  return null;
}

/** Crear o borrar partidas: solo con el presupuesto en borrador. */
export function budgetItemStructureBlockReason(
  status: BudgetStatus,
): string | null {
  if (status === 'borrador') return null;
  return `No se pueden añadir ni borrar partidas de un presupuesto ${BUDGET_STATUS_LABELS[status].toLowerCase()}. ${MENSAJE_NUEVA_VERSION}`;
}

/** Solo se borra un presupuesto en borrador. */
export function canDeleteBudget(status: BudgetStatus): boolean {
  return status === 'borrador';
}

export const BUDGET_SOURCES = ['manual', 'bc3'] as const;
export type BudgetSource = (typeof BUDGET_SOURCES)[number];

// ─── Schemas de entrada ───────────────────────────────────────────────────────

export const budgetCreateSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(200),
  notes: z.string().trim().max(2000).optional(),
});

export const budgetUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  status: z.enum(BUDGET_STATUSES).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

/** Nueva versión (borrador) a partir de un presupuesto activo o cerrado. */
export const budgetDuplicateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
});

export const budgetItemCreateSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(500),
  unit: z.string().trim().max(20).default(''),
  unitPrice: z.number().min(0).default(0),
  quantity: z.number().min(0).default(0),
  phaseId: z.string().uuid().optional(),
  parentCode: z.string().trim().max(50).optional(),
  level: z.number().int().min(1).max(9).default(3),
  sortOrder: z.number().int().min(0).default(0),
});

export const budgetItemUpdateSchema = budgetItemCreateSchema
  .omit({ code: true })
  .partial();

// ─── DTOs de respuesta ────────────────────────────────────────────────────────

export interface BudgetItemDto {
  id: string;
  budgetId: string;
  code: string;
  name: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  totalAmount: number;
  phaseId: string | null;
  level: number;
  parentCode: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** Resumen de presupuesto (sin items). */
export interface BudgetDto {
  id: string;
  projectId: string;
  name: string;
  status: BudgetStatus;
  source: BudgetSource;
  importedAt: string | null;
  notes: string | null;
  totalAmount: number;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Presupuesto con el árbol de partidas. */
export interface BudgetDetailDto extends BudgetDto {
  items: BudgetItemDto[];
}

/** Resultado de importación BC3. */
export interface Bc3ImportResultDto {
  budget: BudgetDto;
  itemsCreated: number;
  warnings: string[];
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type BudgetCreateInput = z.infer<typeof budgetCreateSchema>;
export type BudgetDuplicateInput = z.infer<typeof budgetDuplicateSchema>;
export type BudgetUpdateInput = z.infer<typeof budgetUpdateSchema>;
export type BudgetItemCreateInput = z.infer<typeof budgetItemCreateSchema>;
export type BudgetItemUpdateInput = z.infer<typeof budgetItemUpdateSchema>;
