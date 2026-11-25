/**
 * Avales bancarios y garantías de obra, al estilo de SAP Treasury (Bank
 * Guarantees) y de los Project Contracts / Bonds de Oracle.
 *
 * Un aval puede ser **emitido** (el banco garantiza a un tercero —cliente,
 * administración— una obligación nuestra: definitiva, anticipo, buena
 * ejecución, licitación) o **recibido** (un subcontratista o proveedor nos
 * garantiza la suya). Mientras está vivo es un riesgo contingente: no hay
 * asiento de balance (se informa en la memoria), solo de su coste
 * (comisiones, 6260 a 5720) y, si llega, de su ejecución (emitido: 6780 a
 * 5720; recibido: 5720 a 7780), ambos imputados a la obra.
 *
 * Ciclo: vigente → liberado_parcial (liberaciones o ejecuciones parciales) →
 * liberado / ejecutado (saldo vivo 0) o vencido; anulado solo si se dio de
 * alta por error y no tiene movimientos. Reglas puras en `calculo.ts`
 * (`aplicarMovimientoAval`, `comisionAval`, `resumenAvales`, asientos).
 */

import { z } from 'zod';
import type {
  DireccionAval,
  EstadoAval,
  ResumenAvalesCalculo,
  SaldoAval,
} from './calculo';
import type { Transiciones } from './maquina-estados';

export type { DireccionAval, EstadoAval } from './calculo';

export const TIPOS_AVAL = [
  'garantia_definitiva',
  'garantia_provisional',
  'anticipo',
  'buena_ejecucion',
  'oferta_licitacion',
  'retencion_garantia',
  'otro',
] as const;
export type TipoAval = (typeof TIPOS_AVAL)[number];

export const TIPO_AVAL_LABELS: Record<TipoAval, string> = {
  garantia_definitiva: 'Garantía definitiva',
  garantia_provisional: 'Garantía provisional',
  anticipo: 'Devolución de anticipo',
  buena_ejecucion: 'Buena ejecución',
  oferta_licitacion: 'Oferta / licitación',
  retencion_garantia: 'Sustitución de retención',
  otro: 'Otro',
};

export const DIRECCIONES_AVAL = [
  'emitido',
  'recibido',
] as const satisfies readonly DireccionAval[];

export const DIRECCION_AVAL_LABELS: Record<DireccionAval, string> = {
  emitido: 'Emitido (a nuestro cargo)',
  recibido: 'Recibido (de terceros)',
};

export const ESTADOS_AVAL = [
  'vigente',
  'liberado_parcial',
  'liberado',
  'ejecutado',
  'vencido',
  'anulado',
] as const satisfies readonly EstadoAval[];

export const ESTADO_AVAL_LABELS: Record<EstadoAval, string> = {
  vigente: 'Vigente',
  liberado_parcial: 'Reducido parcialmente',
  liberado: 'Liberado',
  ejecutado: 'Ejecutado',
  vencido: 'Vencido',
  anulado: 'Anulado',
};

/** Estados con saldo vivo (exposición). */
export const ESTADOS_AVAL_VIVOS = ['vigente', 'liberado_parcial'] as const;

/**
 * Liberaciones y ejecuciones parciales mantienen el aval en
 * `liberado_parcial` (transición a sí mismo); al agotarse el saldo pasa a
 * `liberado` o `ejecutado`. Solo un aval sin movimientos se anula.
 */
export const AVAL_TRANSITIONS: Transiciones<EstadoAval> = {
  vigente: ['liberado_parcial', 'liberado', 'ejecutado', 'vencido', 'anulado'],
  liberado_parcial: ['liberado_parcial', 'liberado', 'ejecutado', 'vencido'],
  liberado: [],
  ejecutado: [],
  vencido: [],
  anulado: [],
};

export const TIPOS_MOVIMIENTO_AVAL = [
  'alta',
  'liberacion',
  'ejecucion',
  'prorroga',
  'comision',
  'vencimiento',
  'anulacion',
] as const;
export type TipoMovimientoAval = (typeof TIPOS_MOVIMIENTO_AVAL)[number];

export const TIPO_MOVIMIENTO_AVAL_LABELS: Record<TipoMovimientoAval, string> = {
  alta: 'Alta',
  liberacion: 'Liberación',
  ejecucion: 'Ejecución',
  prorroga: 'Prórroga',
  comision: 'Comisión',
  vencimiento: 'Vencimiento',
  anulacion: 'Anulación',
};

/** Cuentas PGC que mueve el módulo (el aval vivo no tiene asiento). */
export const CUENTAS_AVAL = {
  comision: '6260',
  gastoEjecucion: '6780',
  ingresoEjecucion: '7780',
  bancos: '5720',
} as const;

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: AAAA-MM-DD');

const importe = z
  .number()
  .finite()
  .max(9_999_999_999.99)
  .refine(
    (n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6,
    'Como máximo dos decimales',
  );
const importePositivo = importe.refine(
  (n) => n > 0,
  'El importe debe ser mayor que cero',
);

const tasa = z
  .number()
  .finite()
  .min(0)
  .max(100)
  .refine(
    (n) => Math.abs(Math.round(n * 10_000) - n * 10_000) < 1e-6,
    'Como máximo cuatro decimales',
  );

const motivo = z.string().trim().min(3).max(240);

/** Campos del alta sin las reglas cruzadas (para `inputSchema` del MCP). */
export const avalCreateObjectSchema = z.object({
  /** Número o referencia del aval en la entidad (único por empresa y entidad). */
  referencia: z.string().trim().min(1).max(60),
  tipo: z.enum(TIPOS_AVAL),
  direccion: z.enum(DIRECCIONES_AVAL),
  /** Entidad avalista (banco o aseguradora de caución). */
  entidad: z.string().trim().min(1).max(120),
  projectId: z.string().uuid().nullish(),
  /** Beneficiario (emitido) o avalado (recibido). */
  contactId: z.string().uuid().nullish(),
  contratoObraId: z.string().uuid().nullish(),
  certificationId: z.string().uuid().nullish(),
  /** Cuenta propia con la que se liquidan comisiones y ejecuciones. */
  bankAccountId: z.string().uuid().nullish(),
  importe: importePositivo,
  fechaEmision: fecha,
  /** Null: aval indefinido (hasta su cancelación). */
  fechaVencimiento: fecha.nullish(),
  /** Comisión de riesgo anual (%) sobre el saldo vivo (solo emitidos). */
  tasaComisionAnualPct: tasa.nullish(),
  /** Cada cuántos meses se liquida la comisión (1, 3, 6, 12). */
  periodicidadComisionMeses: z.number().int().min(1).max(12).nullish(),
  notas: z.string().trim().max(1000).nullish(),
});

export const avalCreateSchema = avalCreateObjectSchema
  .refine((a) => !a.fechaVencimiento || a.fechaVencimiento >= a.fechaEmision, {
    path: ['fechaVencimiento'],
    message: 'El vencimiento no puede ser anterior a la emisión',
  })
  .refine(
    (a) =>
      a.direccion === 'emitido' || (a.tasaComisionAnualPct ?? null) === null,
    {
      path: ['tasaComisionAnualPct'],
      message: 'Solo los avales emitidos devengan comisión a nuestro cargo',
    },
  );
export type AvalCreateInput = z.input<typeof avalCreateSchema>;

/** Datos descriptivos editables (PATCH con If-Match); lo económico va por acciones. */
export const avalUpdateSchema = z
  .object({
    entidad: z.string().trim().min(1).max(120).optional(),
    contactId: z.string().uuid().nullish(),
    contratoObraId: z.string().uuid().nullish(),
    certificationId: z.string().uuid().nullish(),
    bankAccountId: z.string().uuid().nullish(),
    tasaComisionAnualPct: tasa.nullish(),
    periodicidadComisionMeses: z.number().int().min(1).max(12).nullish(),
    notas: z.string().trim().max(1000).nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Indica al menos un campo a modificar',
  });
export type AvalUpdateInput = z.input<typeof avalUpdateSchema>;

/** Liberación (devolución del aval por el beneficiario). Sin importe: total. */
export const avalLiberarSchema = z.object({
  fecha,
  importe: importePositivo.nullish(),
  motivo,
});
export type AvalLiberarInput = z.input<typeof avalLiberarSchema>;

export const LIQUIDACIONES_EJECUCION_AVAL = [
  'tesoreria',
  'financiacion',
] as const;
export type LiquidacionEjecucionAval =
  (typeof LIQUIDACIONES_EJECUCION_AVAL)[number];

export const LIQUIDACION_EJECUCION_AVAL_LABELS: Record<
  LiquidacionEjecucionAval,
  string
> = {
  tesoreria: 'Cargo en cuenta (5720)',
  financiacion: 'Financiada por el banco (5200)',
};

/**
 * Ejecución o incautación. Sin importe: total. Se contabiliza en `fecha`.
 * Un aval emitido puede liquidarse con cargo en cuenta (5720) o financiado
 * por el banco como préstamo a corto plazo (5200).
 */
export const avalEjecutarSchema = z.object({
  fecha,
  importe: importePositivo.nullish(),
  motivo,
  liquidacion: z.enum(LIQUIDACIONES_EJECUCION_AVAL).default('tesoreria'),
});
export type AvalEjecutarInput = z.input<typeof avalEjecutarSchema>;

export const avalProrrogaSchema = z.object({
  fecha,
  nuevaFechaVencimiento: fecha,
  motivo: motivo.optional(),
});
export type AvalProrrogaInput = z.input<typeof avalProrrogaSchema>;

/**
 * Comisión liquidada por el banco. Sin importe se calcula con la tasa del aval
 * sobre el saldo vivo por `meses` (por defecto, su periodicidad).
 */
export const avalComisionSchema = z.object({
  fecha,
  importe: importePositivo.nullish(),
  meses: z.number().int().min(1).max(12).nullish(),
});
export type AvalComisionInput = z.input<typeof avalComisionSchema>;

export const avalVencerSchema = z.object({ fecha });
export type AvalVencerInput = z.input<typeof avalVencerSchema>;

export const avalAnularSchema = z.object({ motivo });
export type AvalAnularInput = z.input<typeof avalAnularSchema>;

export const avalesQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  estado: z.enum(ESTADOS_AVAL).optional(),
  tipo: z.enum(TIPOS_AVAL).optional(),
  direccion: z.enum(DIRECCIONES_AVAL).optional(),
  /** Solo avales vivos (vigente o reducido). */
  vivos: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  /** Vivos que vencen en los próximos N días (incluye ya vencidos sin cerrar). */
  venceEnDias: z.coerce.number().int().min(0).max(3650).optional(),
  q: z.string().trim().max(60).optional(),
  /** Fecha de referencia (por defecto, hoy). */
  hoy: fecha.optional(),
});
export type AvalesQuery = z.infer<typeof avalesQuerySchema>;

export const avalesResumenQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  dias: z.coerce.number().int().min(0).max(3650).default(30),
  hoy: fecha.optional(),
});
export type AvalesResumenQuery = z.infer<typeof avalesResumenQuerySchema>;

/** Avisa en la bandeja de los avales vivos que vencen en los próximos días. */
export const avalesAvisosSchema = z.object({
  dias: z.number().int().min(0).max(365).default(30),
  hoy: fecha.optional(),
});
export type AvalesAvisosInput = z.input<typeof avalesAvisosSchema>;

/* ────────────────────────────── DTOs ────────────────────────────── */

export interface AvalDto extends SaldoAval {
  id: string;
  referencia: string;
  tipo: TipoAval;
  direccion: DireccionAval;
  entidad: string;
  projectId: string | null;
  projectCodigo: string | null;
  contactId: string | null;
  contactNombre: string | null;
  contratoObraId: string | null;
  certificationId: string | null;
  bankAccountId: string | null;
  fechaEmision: string;
  fechaVencimiento: string | null;
  /** Días hasta el vencimiento respecto a hoy (negativo si pasó; null si indefinido). */
  diasHastaVencimiento: number | null;
  tasaComisionAnualPct: number | null;
  periodicidadComisionMeses: number | null;
  comisiones: number;
  estado: EstadoAval;
  motivo: string | null;
  notas: string | null;
  version: number;
}

/* ─────────────────────── líneas de avales por entidad ─────────────────────── */

const limite = importe.refine((n) => n >= 0, 'El límite no puede ser negativo');

export const lineaAvalCreateSchema = z.object({
  /** Debe coincidir con la `entidad` de los avales que consumen la línea. */
  entidad: z.string().trim().min(1).max(120),
  limite,
  fechaVencimiento: fecha.nullish(),
  notas: z.string().trim().max(1000).nullish(),
});
export type LineaAvalCreateInput = z.input<typeof lineaAvalCreateSchema>;

export const lineaAvalUpdateSchema = z
  .object({
    limite: limite.optional(),
    activa: z.boolean().optional(),
    fechaVencimiento: fecha.nullish(),
    notas: z.string().trim().max(1000).nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Indica al menos un campo a modificar',
  });
export type LineaAvalUpdateInput = z.input<typeof lineaAvalUpdateSchema>;

export interface LineaAvalDto {
  id: string;
  entidad: string;
  limite: number;
  /** Saldo vivo de los avales emitidos de la entidad. */
  dispuesto: number;
  disponible: number;
  usoPct: number | null;
  activa: boolean;
  fechaVencimiento: string | null;
  notas: string | null;
  version: number;
}

export interface MovimientoAvalDto {
  id: string;
  tipo: TipoMovimientoAval;
  fecha: string;
  importe: number;
  /** Ejecución financiada por el banco (5200) en lugar de cargo en cuenta. */
  financiada: boolean;
  /** Saldo vivo tras el movimiento. */
  saldoVivo: number;
  fechaVencimiento: string | null;
  motivo: string | null;
  asientoId: string | null;
  createdAt: string;
}

export interface AvalDetalleDto extends AvalDto {
  movimientos: MovimientoAvalDto[];
}

export interface ResumenAvalesDto extends ResumenAvalesCalculo {
  hoy: string;
  dias: number;
}

export interface ResultadoAvisosAvalesDto {
  hoy: string;
  dias: number;
  /** Avisos nuevos (los ya enviados para ese vencimiento no se repiten). */
  avisados: number;
  revisados: number;
}
