import { CONTRACT_AUDIT_RISK_LEVELS } from '@erp/shared';

/**
 * Esquema JSON de la salida estructurada del modelo, escrito a mano por el
 * mismo motivo que `apps/api/src/ocr/extraction.schema.ts`: el SDK requiere
 * Zod 4 para derivarlo automáticamente y el monorepo va con Zod 3. La
 * respuesta se valida igual contra `contractAuditResultSchema` de
 * `@erp/shared` antes de persistirla, así que no se pierde seguridad.
 */

export const CONTRACT_AI_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['overallRisk', 'summary', 'findings'],
  properties: {
    overallRisk: {
      type: 'string',
      enum: [...CONTRACT_AUDIT_RISK_LEVELS],
      description: 'Riesgo global del contrato, el peor de sus hallazgos',
    },
    summary: {
      type: 'string',
      description:
        'Resumen ejecutivo de la auditoría en 2-4 frases, en español',
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'clause',
          'riskLevel',
          'category',
          'explanation',
          'recommendation',
        ],
        properties: {
          clause: {
            type: 'string',
            description:
              'Cita o resumen literal de la cláusula o pasaje detectado',
          },
          riskLevel: {
            type: 'string',
            enum: [...CONTRACT_AUDIT_RISK_LEVELS],
          },
          category: {
            type: 'string',
            description:
              'Categoría del riesgo: pagos, penalizaciones, responsabilidad, garantías, plazos, jurisdicción, resolución del contrato…',
          },
          explanation: {
            type: 'string',
            description:
              'Por qué es un riesgo, en español, en una o dos frases',
          },
          recommendation: {
            type: 'string',
            description: 'Qué pedir cambiar o revisar antes de firmar',
          },
        },
      },
    },
  },
} as const;
