import { z } from 'zod';

/**
 * Informe mensual redactado por IA (Fase 15): a diferencia de
 * `computeSavingsOpportunities` (`comparativos.ts`), aquí no hay ninguna
 * función pura que testear — el "cálculo" es una llamada a Claude con los
 * KPIs ya calculados por `DashboardService`/`CostControlService`, así que
 * este fichero solo aporta la validación Zod y los tipos compartidos entre
 * `apps/api` y `apps/web`, mismo patrón que `contract-ai` en su día.
 */

export const informeMensualQuerySchema = z.object({
  mes: z.string().regex(/^\d{4}-\d{2}$/, 'Formato de mes esperado: AAAA-MM'),
  projectId: z.string().uuid('Obra no válida').optional(),
});
export type InformeMensualQuery = z.input<typeof informeMensualQuerySchema>;

export interface InformeMensualDto {
  markdown: string;
  mes: string;
  projectId: string | null;
  generatedAt: string;
}

export const informeEmailSchema = z.object({
  markdown: z.string().trim().min(1),
  mes: z.string().regex(/^\d{4}-\d{2}$/, 'Formato de mes esperado: AAAA-MM'),
  to: z
    .array(z.string().email('Email no válido'))
    .min(1, 'Indica al menos un destinatario')
    .max(10),
});
export type InformeEmailInput = z.input<typeof informeEmailSchema>;
