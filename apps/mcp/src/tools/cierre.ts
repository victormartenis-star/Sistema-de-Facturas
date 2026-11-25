import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  cierreEjercicioRevertirSchema,
  estimacionCierreSetSchema,
  type CierreEjercicioDto,
  type EstimacionCierreObraDto,
  type LineaAvalDto,
  type PropuestaCierreEjercicioDto,
} from '@erp/shared';
import { pedir, pedirVersionado } from '../api';
import { ejecutar } from '../comun';

const ejercicio = z.number().int().min(2000).max(2100).describe('Año');
const projectId = z.string().uuid().describe('Id de la obra');

/**
 * Cierre y apertura del ejercicio PGC, estimación al cierre (EAC) por obra y
 * líneas de avales por entidad.
 */
export function registrarCierre(server: McpServer) {
  server.registerTool(
    'propuesta_cierre_ejercicio',
    {
      title: 'Vista previa del cierre del ejercicio',
      description:
        'Sin contabilizar: ingresos (7), gastos (6), resultado (129) y los tres ' +
        'asientos (regularización 6/7 contra 1290 y cierre del balance al ' +
        '31-12; apertura al 01-01 siguiente), más los impedimentos para ' +
        'cerrar (FISCAL_YEAR_NOT_ENDED, FISCAL_YEAR_ALREADY_CLOSED, ' +
        'FISCAL_YEAR_PREVIOUS_OPEN, FISCAL_YEAR_UNBALANCED) y el cierre vigente.',
      inputSchema: { ejercicio },
      annotations: { readOnlyHint: true },
    },
    async ({ ejercicio: e }) =>
      ejecutar(() =>
        pedir<PropuestaCierreEjercicioDto>(
          `/contabilidad/ejercicios/${e}/cierre`,
        ),
      ),
  );

  server.registerTool(
    'cierres_ejercicio',
    {
      title: 'Historial de cierres de ejercicio',
      description:
        'Cierres vigentes y revertidos con resultado, asientos y meses cerrados.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      ejecutar(() => pedir<CierreEjercicioDto[]>('/contabilidad/ejercicios')),
  );

  server.registerTool(
    'cerrar_ejercicio',
    {
      title: 'Cerrar el ejercicio contable',
      description:
        'Contabiliza regularización, cierre y apertura del siguiente, cierra ' +
        'los meses y bloquea el ejercicio (FISCAL_YEAR_CLOSED en cualquier ' +
        'asiento posterior). Solo admin y gerente. Revisa antes ' +
        '`propuesta_cierre_ejercicio`.',
      inputSchema: { ejercicio },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ ejercicio: e }) =>
      ejecutar(() =>
        pedir<CierreEjercicioDto>(`/contabilidad/ejercicios/${e}/cerrar`, {
          method: 'POST',
          headers: { 'Idempotency-Key': randomUUID() },
        }),
      ),
  );

  server.registerTool(
    'revertir_cierre_ejercicio',
    {
      title: 'Revertir el cierre del ejercicio',
      description:
        'Contra-asientos de apertura, cierre y regularización y reapertura de ' +
        'los meses que cerró. Solo el último ejercicio cerrado ' +
        '(FISCAL_YEAR_NOT_LATEST). Envía If-Match con la versión leída.',
      inputSchema: { ejercicio, ...cierreEjercicioRevertirSchema.shape },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ ejercicio: e, ...body }) =>
      ejecutar(() =>
        pedirVersionado<CierreEjercicioDto>(
          `/contabilidad/ejercicios/${e}/revertir`,
          {
            method: 'POST',
            body: JSON.stringify(cierreEjercicioRevertirSchema.parse(body)),
            headers: { 'Idempotency-Key': randomUUID() },
          },
          async () => {
            const p = await pedir<PropuestaCierreEjercicioDto>(
              `/contabilidad/ejercicios/${e}/cierre`,
            );
            // Sin cierre vigente, la API responde FISCAL_YEAR_NOT_CLOSED.
            return p.cierreVigente?.version ?? 1;
          },
          'cierre del ejercicio',
        ),
      ),
  );

  server.registerTool(
    'estimacion_cierre_obra',
    {
      title: 'Estimación al cierre (EAC) de una obra',
      description:
        'Automática (mayor de presupuestado y consumido), efectiva (manual ' +
        'vigente, nunca por debajo del coste real), coste real con avales, ' +
        'margen proyectado e historial de versiones con motivo y usuario.',
      inputSchema: { projectId },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId: id }) =>
      ejecutar(() =>
        pedir<EstimacionCierreObraDto>(`/projects/${id}/estimacion-cierre`),
      ),
  );

  server.registerTool(
    'fijar_estimacion_cierre',
    {
      title: 'Fijar la estimación al cierre (EAC) de una obra',
      description:
        'Nueva versión con motivo y fecha de efecto (por defecto hoy); ' +
        '`costeEstimado: null` vuelve al cálculo automático. Alimenta el ' +
        'margen proyectado y la provisión por pérdidas. Errores: ' +
        'EAC_BELOW_ACTUAL_COST, EAC_DATE_OUT_OF_ORDER, VERSION_CONFLICT.',
      inputSchema: { projectId, ...estimacionCierreSetSchema.shape },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ projectId: id, ...body }) =>
      ejecutar(async () => {
        const datos = estimacionCierreSetSchema.parse(body);
        const actual = await pedir<EstimacionCierreObraDto>(
          `/projects/${id}/estimacion-cierre`,
        );
        // If-Match solo admite enteros positivos: sin versión previa no se envía.
        return pedir<EstimacionCierreObraDto>(
          `/projects/${id}/estimacion-cierre`,
          {
            method: 'POST',
            body: JSON.stringify(datos),
            headers: {
              'Idempotency-Key': randomUUID(),
              ...(actual.version > 0
                ? { 'If-Match': `"${actual.version}"` }
                : {}),
            },
          },
        );
      }),
  );

  server.registerTool(
    'lineas_avales',
    {
      title: 'Líneas de avales por entidad',
      description:
        'Límite concedido por cada banco, dispuesto (saldo vivo de los avales ' +
        'emitidos de la entidad), disponible y % de uso. Un alta que supere ' +
        'el disponible se rechaza con BANK_GUARANTEE_LIMIT_EXCEEDED.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => ejecutar(() => pedir<LineaAvalDto[]>('/avales/lineas')),
  );
}
