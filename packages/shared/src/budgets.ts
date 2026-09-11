import { z } from 'zod';

export const BUDGET_STATUSES = ['borrador', 'activo', 'cerrado'] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

export const BUDGET_STATUS_LABELS: Record<BudgetStatus, string> = {
  borrador: 'Borrador',
  activo: 'Activo',
  cerrado: 'Cerrado',
};

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
export type BudgetUpdateInput = z.infer<typeof budgetUpdateSchema>;
export type BudgetItemCreateInput = z.infer<typeof budgetItemCreateSchema>;
export type BudgetItemUpdateInput = z.infer<typeof budgetItemUpdateSchema>;
