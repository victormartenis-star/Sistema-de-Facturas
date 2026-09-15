import { z } from 'zod';
import { round2 } from './calculo';

/**
 * ESG, huella de carbono y sostenibilidad (Fase 14).
 *
 * Cálculo de emisiones de combustibles, energía y materiales por obra, para
 * alimentar los informes de sostenibilidad que piden certificaciones como
 * BREEAM o LEED. El cálculo es siempre `cantidad × factor de emisión`; los
 * factores forman un catálogo editable (cada empresa u obra puede usar la
 * tabla de factores que le exija el certificador) en vez de venir fijos en
 * código.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD');

export const ESG_CATEGORIAS = [
  'combustible',
  'energia',
  'agua',
  'material',
  'residuo',
] as const;
export type EsgCategoria = (typeof ESG_CATEGORIAS)[number];

export const ESG_CATEGORIA_LABELS: Record<EsgCategoria, string> = {
  combustible: 'Combustible',
  energia: 'Energía',
  agua: 'Agua',
  material: 'Material',
  residuo: 'Residuo',
};

/* ────────────────────── factores de emisión ────────────────────── */

export const esgFactorCreateSchema = z.object({
  categoria: z.enum(ESG_CATEGORIAS),
  nombre: z
    .string()
    .trim()
    .min(1, 'El nombre del factor es obligatorio')
    .max(200, 'Máximo 200 caracteres'),
  unidad: z
    .string()
    .trim()
    .min(1, 'La unidad es obligatoria')
    .max(20, 'Máximo 20 caracteres'),
  factorKgCo2e: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .nonnegative('No puede ser negativo')
    .max(1_000_000),
  fuente: z.string().trim().max(200).nullish(),
  activo: z.boolean().default(true),
});

export const esgFactorUpdateSchema = esgFactorCreateSchema.partial();

export type EsgFactorCreateInput = z.input<typeof esgFactorCreateSchema>;
export type EsgFactorUpdateInput = z.input<typeof esgFactorUpdateSchema>;

export interface EsgFactorDto {
  id: string;
  categoria: EsgCategoria;
  nombre: string;
  unidad: string;
  factorKgCo2e: number;
  fuente: string | null;
  activo: boolean;
  createdAt: string;
}

/* ────────────────────── registros de consumo/emisión ────────────────────── */

export const esgRegistroCreateSchema = z.object({
  projectId: z.string().uuid('La obra es obligatoria'),
  phaseId: z.string().uuid('Fase no válida').nullish(),
  factorId: z.string().uuid('El factor de emisión es obligatorio'),
  fecha: isoDate,
  cantidad: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .positive('La cantidad debe ser mayor que cero')
    .max(999_999_999),
  documentId: z.string().uuid('Documento no válido').nullish(),
  notas: z.string().trim().max(1000).nullish(),
});

export const esgRegistroUpdateSchema = esgRegistroCreateSchema
  .omit({ projectId: true, factorId: true })
  .partial();

export type EsgRegistroCreateInput = z.input<typeof esgRegistroCreateSchema>;
export type EsgRegistroUpdateInput = z.input<typeof esgRegistroUpdateSchema>;

export interface EsgRegistroEmisionDto {
  id: string;
  projectId: string;
  phaseId: string | null;
  factorId: string;
  factorNombre: string;
  categoria: EsgCategoria;
  unidad: string;
  fecha: string;
  cantidad: number;
  emisionesKgCo2e: number;
  documentId: string | null;
  notas: string | null;
  createdAt: string;
}

/* ────────────────────── informe (BREEAM/LEED) ────────────────────── */

export interface EsgInformeCategoriaDto {
  categoria: EsgCategoria;
  emisionesKgCo2e: number;
}

export interface EsgInformeDto {
  projectId: string;
  desde: string | null;
  hasta: string | null;
  totalKgCo2e: number;
  totalToneladasCo2e: number;
  porCategoria: EsgInformeCategoriaDto[];
}

/* ────────────────────── cálculo puro ────────────────────── */

/** Emisiones de un registro: cantidad consumida × factor de emisión. */
export function computeEmisionesKgCo2e(
  cantidad: number,
  factorKgCo2e: number,
): number {
  return Math.round(cantidad * factorKgCo2e * 1000) / 1000;
}

/** Agrega un conjunto de registros en el informe por categoría + total. */
export function summarizeEmisiones(
  registros: { categoria: EsgCategoria; emisionesKgCo2e: number }[],
): { totalKgCo2e: number; porCategoria: EsgInformeCategoriaDto[] } {
  const porCategoriaMap = new Map<EsgCategoria, number>();
  for (const registro of registros) {
    porCategoriaMap.set(
      registro.categoria,
      (porCategoriaMap.get(registro.categoria) ?? 0) + registro.emisionesKgCo2e,
    );
  }
  const porCategoria = ESG_CATEGORIAS.filter((c) => porCategoriaMap.has(c))
    .map((categoria) => ({
      categoria,
      emisionesKgCo2e: round2(porCategoriaMap.get(categoria)!),
    }))
    .sort((a, b) => b.emisionesKgCo2e - a.emisionesKgCo2e);
  const totalKgCo2e = round2(
    porCategoria.reduce((sum, c) => sum + c.emisionesKgCo2e, 0),
  );
  return { totalKgCo2e, porCategoria };
}
