import { z } from 'zod';

/**
 * Visor BIM 3D: modelos IFC subidos por obra y el vínculo entre cada
 * elemento del modelo (por su GlobalId IFC) y una partida de presupuesto.
 * El parseo/render del `.ifc` ocurre en el navegador
 * (`apps/web/src/components/bim`, `web-ifc` + `three`); el backend solo
 * guarda metadatos, el fichero original y los vínculos.
 */

export const bimModelCreateMetaSchema = z.object({
  projectId: z.string().uuid('Obra no válida'),
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(200),
});
export type BimModelCreateMeta = z.input<typeof bimModelCreateMetaSchema>;

export interface BimModelDto {
  id: string;
  projectId: string;
  projectCode: string;
  name: string;
  fileName: string;
  fileSize: number;
  ifcSchema: string | null;
  createdAt: string;
  updatedAt: string;
}

export const bimElementLinkUpsertSchema = z.object({
  ifcElementName: z.string().trim().max(300).nullish(),
  ifcElementType: z.string().trim().max(100).nullish(),
  budgetItemId: z.string().uuid('Partida no válida').nullish(),
  notes: z.string().trim().max(2000).nullish(),
});
export type BimElementLinkUpsertInput = z.input<
  typeof bimElementLinkUpsertSchema
>;

export interface BimElementLinkDto {
  id: string;
  bimModelId: string;
  ifcGlobalId: string;
  ifcElementName: string | null;
  ifcElementType: string | null;
  budgetItemId: string | null;
  budgetItemCode: string | null;
  budgetItemName: string | null;
  /**
   * % certificado a origen de la partida vinculada, tomado de la última
   * certificación de la obra (null si el elemento no está vinculado o la
   * partida todavía no se ha certificado nunca). Alimenta el color del
   * elemento en el visor.
   */
  certifiedPct: number | null;
  notes: string | null;
  updatedAt: string;
}
