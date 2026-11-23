/**
 * Control presupuestario activo y cuadro de márgenes por obra (SAP PS/CO,
 * Oracle PPM). Las reglas de cálculo viven en `calculo.ts`
 * (`cuadroMargenesObra`, `evaluarControlPresupuestario`,
 * `comprometidoPendiente`, `cobradoEnBase`); aquí, el contrato.
 *
 * Magnitudes por obra:
 *  - Presupuestado: presupuesto activo (si no hay, el de cada partida).
 *  - Comprometido: pedidos abiertos − lo facturado de cada uno, y
 *    subcontratas activas − lo ejecutado (nunca negativo por compromiso).
 *  - Coste real: facturas de compra (incl. subcontratas), partes de
 *    personal y maquinaria, consumo neto de almacén y amortización (681x)
 *    imputada a la obra.
 *  - Certificado, facturado (base) y cobrado (en base, prorrateado).
 */

import { z } from 'zod';
import type {
  CuadroMargenesCalculo,
  EstadoControlPresupuestario,
  EvaluacionControlPresupuestario,
  ModoControlPresupuestario,
} from './calculo';

export type {
  EstadoControlPresupuestario,
  ModoControlPresupuestario,
} from './calculo';

export const MODOS_CONTROL_PRESUPUESTARIO = [
  'observacion',
  'aviso',
  'bloqueo',
] as const satisfies readonly ModoControlPresupuestario[];

export const MODO_CONTROL_LABELS: Record<ModoControlPresupuestario, string> = {
  observacion: 'Observación (solo informa)',
  aviso: 'Aviso (permite y registra el exceso)',
  bloqueo: 'Bloqueo (rechaza el exceso)',
};

export const ESTADO_CONTROL_LABELS: Record<
  EstadoControlPresupuestario,
  string
> = {
  sin_presupuesto: 'Sin presupuesto',
  ok: 'Dentro de presupuesto',
  aviso: 'Cerca del límite',
  excedido: 'Presupuesto excedido',
};

/** Configuración por defecto de una obra sin configuración propia. */
export const CONTROL_PRESUPUESTARIO_POR_DEFECTO = {
  modo: 'observacion' as ModoControlPresupuestario,
  toleranciaPct: 0,
  umbralAvisoPct: 90,
};

/** Operaciones que comprueban el control antes de comprometer/imputar coste. */
export const OPERACIONES_CONTROL = [
  'pedido_compra',
  'consumo_almacen',
] as const;
export type OperacionControl = (typeof OPERACIONES_CONTROL)[number];

const porcentaje = z
  .number()
  .finite()
  .min(0)
  .max(100)
  .refine(
    (n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6,
    'Como máximo dos decimales',
  );

export const controlPresupuestarioUpdateSchema = z.object({
  modo: z.enum(MODOS_CONTROL_PRESUPUESTARIO),
  /** Margen sobre el presupuesto antes de considerarlo excedido. */
  toleranciaPct: porcentaje.default(0),
  /** % del presupuesto a partir del cual el estado pasa a «aviso». */
  umbralAvisoPct: porcentaje
    .refine((n) => n > 0, 'El umbral debe ser mayor que cero')
    .default(90),
});
export type ControlPresupuestarioUpdateInput = z.input<
  typeof controlPresupuestarioUpdateSchema
>;

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: AAAA-MM-DD');

/**
 * Filtros del cuadro. `desde`/`hasta` acotan los FLUJOS (coste real,
 * certificado, facturado y cobrado); presupuesto y comprometido son siempre
 * la foto a hoy.
 */
export const cuadroMargenesQuerySchema = z
  .object({
    projectId: z.string().uuid().optional(),
    estado: z.string().trim().max(20).optional(),
    q: z.string().trim().max(80).optional(),
    desde: fecha.optional(),
    hasta: fecha.optional(),
    /** Solo obras con el control en aviso o excedido. */
    soloAlertas: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
  })
  .refine((f) => !f.desde || !f.hasta || f.desde <= f.hasta, {
    path: ['hasta'],
    message: '`hasta` no puede ser anterior a `desde`',
  });
export type CuadroMargenesQuery = z.infer<typeof cuadroMargenesQuerySchema>;

export const margenesObraQuerySchema = z
  .object({ desde: fecha.optional(), hasta: fecha.optional() })
  .refine((f) => !f.desde || !f.hasta || f.desde <= f.hasta, {
    path: ['hasta'],
    message: '`hasta` no puede ser anterior a `desde`',
  });
export type MargenesObraQuery = z.infer<typeof margenesObraQuerySchema>;

/* ────────────────────────────── DTOs ────────────────────────────── */

export interface ConfigControlPresupuestarioDto {
  modo: ModoControlPresupuestario;
  toleranciaPct: number;
  umbralAvisoPct: number;
  /** 0 si la obra usa la configuración por defecto (aún sin fila). */
  version: number;
  actualizadoEn: string | null;
}

export interface EventoControlPresupuestarioDto {
  fecha: string;
  evento: 'aviso' | 'bloqueo' | 'configuracion';
  operacion: OperacionControl | null;
  importe: number | null;
  exceso: number | null;
  usuarioId: string | null;
  correlationId: string | null;
}

export interface ControlPresupuestarioDto {
  projectId: string;
  config: ConfigControlPresupuestarioDto;
  evaluacion: EvaluacionControlPresupuestario;
  /** Últimos avisos, bloqueos y cambios de configuración (de `audit_log`). */
  eventos: EventoControlPresupuestarioDto[];
}

export interface FilaMargenObraDto extends CuadroMargenesCalculo {
  projectId: string;
  codigo: string;
  nombre: string;
  estadoObra: string;
  control: {
    modo: ModoControlPresupuestario;
    estado: EstadoControlPresupuestario;
    limite: number;
    disponible: number;
  };
}

export interface CuadroMargenesDto {
  generadoEn: string;
  desde: string | null;
  hasta: string | null;
  obras: FilaMargenObraDto[];
  totales: CuadroMargenesCalculo;
}

export interface PartidaMargenDto {
  phaseId: string | null;
  codigo: string;
  nombre: string;
  /** Capítulo (prefijo del código) o null. */
  capitulo: string | null;
  presupuestado: number;
  comprometido: number;
  costeReal: number;
  consumido: number;
  desviacion: number;
  consumoPct: number | null;
  excedida: boolean;
}

export interface CapituloMargenDto {
  capitulo: string;
  presupuestado: number;
  comprometido: number;
  costeReal: number;
  consumido: number;
  desviacion: number;
  consumoPct: number | null;
  excedido: boolean;
}

export interface MargenesObraDto {
  generadoEn: string;
  desde: string | null;
  hasta: string | null;
  obra: FilaMargenObraDto;
  partidas: PartidaMargenDto[];
  capitulos: CapituloMargenDto[];
}
