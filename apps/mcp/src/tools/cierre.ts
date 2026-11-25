import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  aplicacionResultadoAnularSchema,
  aplicacionResultadoSchema,
  cierreEjercicioRevertirSchema,
  devengoAvalesQuerySchema,
  devengoAvalesSchema,
  devengoAutomaticoSchema,
  estimacionCierreSetSchema,
  conciliacionCierreQuerySchema,
  conciliacionCierreRegistrarSchema,
  FORMATOS_EXPORTACION_CUENTAS,
  type AvalDetalleDto,
  type ConciliacionCierreDto,
  type EjecucionDevengoDto,
  type ResultadoDevengoAutomaticoDto,
  type AplicacionResultadoDto,
  type CierreEjercicioDto,
  type CuentasAnualesDto,
  type DevengoAvalDto,
  type EstimacionCierreObraDto,
  type LineaAvalDto,
  type PropuestaAplicacionResultadoDto,
  type PropuestaCierreEjercicioDto,
  type ResultadoDevengoAvalesDto,
} from '@erp/shared';
import { pedir, pedirExportacion, pedirVersionado, query } from '../api';
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

  /* ─────────── aplicación del resultado (129) y cuentas anuales ─────────── */

  server.registerTool(
    'cuentas_anuales',
    {
      title: 'Cuentas anuales (balance y PyG)',
      description:
        'Balance por masas (activo no corriente y corriente, patrimonio neto ' +
        'con el resultado, pasivo no corriente y corriente, con comprobación ' +
        'de cuadre) y PyG por partidas PGC del ejercicio, con los saldos antes ' +
        'del cierre, y la aplicación del resultado si existe.',
      inputSchema: { ejercicio },
      annotations: { readOnlyHint: true },
    },
    async ({ ejercicio: e }) =>
      ejecutar(() =>
        pedir<CuentasAnualesDto>(
          `/contabilidad/ejercicios/${e}/cuentas-anuales`,
        ),
      ),
  );

  server.registerTool(
    'propuesta_aplicacion_resultado',
    {
      title: 'Datos para aplicar el resultado de un ejercicio',
      description:
        'Resultado del ejercicio cerrado, capital, reservas, pérdidas ' +
        'pendientes, reserva legal mínima (art. 274 LSC), destinos admitidos ' +
        'según el signo y la aplicación vigente.',
      inputSchema: { ejercicio },
      annotations: { readOnlyHint: true },
    },
    async ({ ejercicio: e }) =>
      ejecutar(() =>
        pedir<PropuestaAplicacionResultadoDto>(
          `/contabilidad/ejercicios/${e}/aplicacion-resultado`,
        ),
      ),
  );

  server.registerTool(
    'aplicar_resultado',
    {
      title: 'Aplicar el resultado del ejercicio (129)',
      description:
        'Contabiliza en el ejercicio siguiente el reparto acordado: beneficio a ' +
        '1120 / 1130 / 1140 / 1200 / 1210 / 5260; pérdida a 1210 / 1130 / ' +
        '1200. Debe cuadrar al céntimo. Errores: FISCAL_YEAR_NOT_CLOSED, ' +
        'RESULT_ALREADY_APPLIED, RESULT_APPLICATION_UNBALANCED, ' +
        'RESULT_APPLICATION_LEGAL_RESERVE, RESULT_APPLICATION_DIVIDEND_BLOCKED, ' +
        'RESULT_APPLICATION_DATE_INVALID. Solo admin y gerente.',
      inputSchema: { ejercicio, ...aplicacionResultadoSchema.shape },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ ejercicio: e, ...body }) =>
      ejecutar(() =>
        pedir<AplicacionResultadoDto>(
          `/contabilidad/ejercicios/${e}/aplicar-resultado`,
          {
            method: 'POST',
            body: JSON.stringify(aplicacionResultadoSchema.parse(body)),
            headers: { 'Idempotency-Key': randomUUID() },
          },
        ),
      ),
  );

  server.registerTool(
    'anular_aplicacion_resultado',
    {
      title: 'Anular la aplicación del resultado',
      description:
        'Contra-asiento de la aplicación vigente (If-Match con su versión). ' +
        'Necesario antes de revertir el cierre del ejercicio ' +
        '(FISCAL_YEAR_RESULT_APPLIED).',
      inputSchema: { ejercicio, ...aplicacionResultadoAnularSchema.shape },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ ejercicio: e, ...body }) =>
      ejecutar(async () => {
        const datos = aplicacionResultadoAnularSchema.parse(body);
        const p = await pedir<PropuestaAplicacionResultadoDto>(
          `/contabilidad/ejercicios/${e}/aplicacion-resultado`,
        );
        const version = p.aplicacionVigente?.version ?? 0;
        return pedir<AplicacionResultadoDto>(
          `/contabilidad/ejercicios/${e}/aplicacion-resultado/anular`,
          {
            method: 'POST',
            body: JSON.stringify(datos),
            headers: {
              'Idempotency-Key': randomUUID(),
              ...(version > 0 ? { 'If-Match': `"${version}"` } : {}),
            },
          },
        );
      }),
  );

  /* ─────────── devengo de comisiones de aval ─────────── */

  server.registerTool(
    'devengos_avales',
    {
      title: 'Devengos de comisiones de aval',
      description:
        'Devengos mensuales (tramo, días, saldo base, tasa, importe, asiento y ' +
        'estado). Filtra por periodo (AAAA-MM) o aval.',
      inputSchema: devengoAvalesQuerySchema.shape,
      annotations: { readOnlyHint: true },
    },
    async (q) =>
      ejecutar(() => pedir<DevengoAvalDto[]>(`/avales/devengos${query(q)}`)),
  );

  server.registerTool(
    'devengar_comisiones_avales',
    {
      title: 'Devengar las comisiones de aval de un mes',
      description:
        'Con avalId, ese aval; sin él, todos los emitidos con tasa que ' +
        'estuvieron vivos en el mes (los rechazados se informan en ' +
        '`omitidos`). Prorrateado por tramos de saldo: Σ saldo × tasa × días ' +
        '/ 365, 6260 (obra) a 4100; el detalle va en `tramos`. Solo meses ' +
        'terminados. Errores: BANK_GUARANTEE_ACCRUAL_ALREADY_POSTED, ' +
        'BANK_GUARANTEE_ACCRUAL_NOT_APPLICABLE, ' +
        'BANK_GUARANTEE_ACCRUAL_PERIOD_OPEN, FISCAL_PERIOD_CLOSED.',
      inputSchema: devengoAvalesSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (body) =>
      ejecutar(() =>
        pedir<ResultadoDevengoAvalesDto | DevengoAvalDto>('/avales/devengos', {
          method: 'POST',
          body: JSON.stringify(devengoAvalesSchema.parse(body)),
          headers: { 'Idempotency-Key': randomUUID() },
        }),
      ),
  );

  server.registerTool(
    'devengo_automatico_avales',
    {
      title: 'Devengar todos los meses pendientes de los avales',
      description:
        'Recorre los meses terminados hasta `hasta` (por defecto, el anterior ' +
        'al actual) desde el primero en que algún aval pudo devengar (máximo ' +
        '24) y devenga lo que falte. Idempotente: lo ya devengado no se repite ' +
        'ni se informa; los rechazos reales (período cerrado) sí, en ' +
        '`periodos[].omitidos`. Es lo mismo que la tarea programada del día 1.',
      inputSchema: devengoAutomaticoSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async (body) =>
      ejecutar(() =>
        pedir<ResultadoDevengoAutomaticoDto>('/avales/devengos/automatico', {
          method: 'POST',
          body: JSON.stringify(devengoAutomaticoSchema.parse(body)),
          headers: { 'Idempotency-Key': randomUUID() },
        }),
      ),
  );

  server.registerTool(
    'ejecuciones_devengo_avales',
    {
      title: 'Ejecuciones del devengo de avales',
      description:
        'Registro de ejecuciones del devengo (manual o programada): mes, ' +
        'devengos, importe y omitidos.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      ejecutar(() =>
        pedir<EjecucionDevengoDto[]>('/avales/devengos/ejecuciones'),
      ),
  );

  /* ─────────── conciliación de cierre (auxiliar ↔ mayor) ─────────── */

  server.registerTool(
    'conciliacion_cierre',
    {
      title: 'Conciliación de cierre auxiliar ↔ mayor',
      description:
        'A una fecha de corte (`fecha`, por defecto hoy; nunca futura): ' +
        'devengos de aval pendientes ↔ 4100, amortización acumulada ↔ 281x, ' +
        'obra en curso ↔ 4309 − 4389, provisión por pérdidas ↔ 4994, ' +
        'clientes ↔ 4300 + 4301, proveedores ↔ 4000 + 4001 y almacén ↔ ' +
        'grupo 3, con diferencia y `cuadra` por partida. Error: ' +
        'CLOSE_RECONCILIATION_DATE_INVALID.',
      inputSchema: conciliacionCierreQuerySchema.shape,
      annotations: { readOnlyHint: true },
    },
    async (q) =>
      ejecutar(() =>
        pedir<ConciliacionCierreDto>(`/contabilidad/conciliacion${query(q)}`),
      ),
  );

  server.registerTool(
    'exportar_cuentas_anuales',
    {
      title: 'Exportar las cuentas anuales',
      description:
        'Balance, PyG, ECPN, EFE y memoria abreviada del ejercicio en JSON ' +
        'canónico (determinista) o CSV (`;`). Devuelve el contenido y su ' +
        'huella SHA-256, que queda en la auditoría.',
      inputSchema: {
        ejercicio,
        formato: z.enum(FORMATOS_EXPORTACION_CUENTAS).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ ejercicio: e, formato }) =>
      ejecutar(() =>
        pedirExportacion(
          `/contabilidad/ejercicios/${e}/cuentas-anuales/exportar?formato=${formato ?? 'json'}`,
        ),
      ),
  );

  server.registerTool(
    'cambiar_tasa_aval',
    {
      title: 'Cambiar la tasa de comisión de un aval',
      description:
        'Nueva tasa anual (%) con fecha de efecto (`tasaVigenteDesde`, por ' +
        'defecto hoy); null quita la comisión. El devengo del mes del cambio ' +
        'se prorratea por tramos de tasa. Lee la versión y envía If-Match. ' +
        'Error: BANK_GUARANTEE_RATE_DATE_INVALID.',
      inputSchema: {
        id: z.string().uuid().describe('Id del aval'),
        tasaComisionAnualPct: z.number().min(0).max(100).nullable(),
        tasaVigenteDesde: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ id, ...body }) =>
      ejecutar(() =>
        pedirVersionado<AvalDetalleDto>(
          `/avales/${id}`,
          { method: 'PATCH', body: JSON.stringify(body) },
          async () => (await pedir<AvalDetalleDto>(`/avales/${id}`)).version,
          'aval',
        ),
      ),
  );

  server.registerTool(
    'registrar_conciliacion_cierre',
    {
      title: 'Registrar la conciliación de cierre',
      description:
        'Ejecuta la conciliación a la fecha de corte (por defecto hoy) y la ' +
        'guarda como evidencia del cierre (auditada). Admin, gerente y ' +
        'administración.',
      inputSchema: conciliacionCierreRegistrarSchema.shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (body) =>
      ejecutar(() =>
        pedir<ConciliacionCierreDto>('/contabilidad/conciliacion', {
          method: 'POST',
          body: JSON.stringify(conciliacionCierreRegistrarSchema.parse(body)),
          headers: { 'Idempotency-Key': randomUUID() },
        }),
      ),
  );
}
