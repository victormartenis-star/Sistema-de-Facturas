import { z } from 'zod';

/**
 * Copiloto IA de contratación: auditoría automática de contratos de
 * subcontrata y pliegos. Un agente LLM (mismo patrón que la extracción OCR
 * de `apps/api/src/ocr`) lee el texto del documento y devuelve una lista
 * de cláusulas de riesgo con severidad y recomendación. No sustituye la
 * revisión legal — deja constancia de lo detectado para que un humano decida.
 */

export const CONTRACT_AUDIT_RISK_LEVELS = [
  'bajo',
  'medio',
  'alto',
  'critico',
] as const;
export type ContractAuditRiskLevel =
  (typeof CONTRACT_AUDIT_RISK_LEVELS)[number];

export const CONTRACT_AUDIT_RISK_LABELS: Record<
  ContractAuditRiskLevel,
  string
> = {
  bajo: 'Riesgo bajo',
  medio: 'Riesgo medio',
  alto: 'Riesgo alto',
  critico: 'Riesgo crítico',
};

/** Una cláusula de riesgo detectada por el modelo (salida estructurada). */
export const contractAuditFindingSchema = z.object({
  clause: z
    .string()
    .describe('Cita o resumen literal de la cláusula o pasaje detectado'),
  riskLevel: z.enum(CONTRACT_AUDIT_RISK_LEVELS),
  category: z
    .string()
    .describe(
      'Categoría del riesgo: pagos, penalizaciones, responsabilidad, garantías, plazos, jurisdicción, resolución del contrato…',
    ),
  explanation: z
    .string()
    .describe('Por qué es un riesgo, en español, en una o dos frases'),
  recommendation: z
    .string()
    .describe('Qué pedir cambiar o revisar antes de firmar'),
});
export type ContractAuditFinding = z.infer<typeof contractAuditFindingSchema>;

export const contractAuditResultSchema = z.object({
  overallRisk: z.enum(CONTRACT_AUDIT_RISK_LEVELS),
  summary: z
    .string()
    .describe('Resumen ejecutivo de la auditoría en 2-4 frases, en español'),
  findings: z.array(contractAuditFindingSchema),
});
export type ContractAuditResult = z.infer<typeof contractAuditResultSchema>;

/** Petición de auditoría: o bien un documento ya subido, o texto pegado directamente. */
export const contractAuditRequestSchema = z
  .object({
    documentId: z.string().uuid('Documento no válido').nullish(),
    text: z.string().trim().max(200_000).nullish(),
    projectId: z.string().uuid('Obra no válida').nullish(),
    contactId: z.string().uuid('Contacto no válido').nullish(),
  })
  .refine((v) => Boolean(v.documentId) || Boolean(v.text), {
    message: 'Indica un documento ya subido o pega el texto del contrato',
    path: ['text'],
  });
export type ContractAuditRequestInput = z.input<
  typeof contractAuditRequestSchema
>;

export interface ContractAuditDto {
  id: string;
  projectId: string | null;
  contactId: string | null;
  contactName: string | null;
  documentId: string | null;
  model: string;
  overallRisk: ContractAuditRiskLevel;
  summary: string;
  findings: ContractAuditFinding[];
  createdAt: string;
}
