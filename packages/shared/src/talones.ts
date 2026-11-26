/**
 * Talones y cheques bancarios (SAP Bank Accounting / Check Management,
 * Oracle Payments Check Processing).
 *
 * - Talonarios por cuenta bancaria: rango de números, siguiente número y
 *   estado (activo, agotado, anulado). Los rangos de una cuenta no se solapan
 *   y un número no se repite.
 * - Ciclo del talón: emitido → entregado → cobrado (compensado por el banco);
 *   antes de cobrarse se puede anular o detener; un talón cobrado o entregado
 *   puede volver devuelto (impagado).
 * - Contabilidad sin duplicidades: el talón liquida un vencimiento con
 *   contrapartida 5729 (talones en tránsito); al compensarse, 5729 ↔ 5720.
 *   Anular, detener o devolver revierte lo contabilizado (la compensación y
 *   la liquidación) a la fecha de la operación.
 *
 * Funciones puras, sin base de datos y sin reloj.
 */

import { z } from 'zod';
import { toCents } from './dinero';
import type { Transiciones } from './maquina-estados';

export const DIRECCIONES_TALON = ['emitido', 'recibido'] as const;
export type DireccionTalon = (typeof DIRECCIONES_TALON)[number];

export const DIRECCION_TALON_LABELS: Record<DireccionTalon, string> = {
  emitido: 'Emitido (pago a proveedor)',
  recibido: 'Recibido (cobro de cliente)',
};

export const ESTADOS_TALON = [
  'emitido',
  'entregado',
  'cobrado',
  'anulado',
  'detenido',
  'devuelto',
] as const;
export type EstadoTalon = (typeof ESTADOS_TALON)[number];

export const ESTADO_TALON_LABELS: Record<EstadoTalon, string> = {
  emitido: 'Emitido',
  entregado: 'Entregado / depositado',
  cobrado: 'Cobrado (compensado)',
  anulado: 'Anulado',
  detenido: 'Detenido (orden de no pago)',
  devuelto: 'Devuelto (impagado)',
};

export const TALON_TRANSITIONS: Transiciones<EstadoTalon> = {
  emitido: ['entregado', 'cobrado', 'anulado'],
  entregado: ['cobrado', 'anulado', 'detenido', 'devuelto'],
  cobrado: ['devuelto'],
  anulado: [],
  detenido: [],
  devuelto: [],
};

export const ESTADOS_TALONARIO = ['activo', 'agotado', 'anulado'] as const;
export type EstadoTalonario = (typeof ESTADOS_TALONARIO)[number];

/** Un talonario se agota al usar su último número o se anula sin usar más. */
export const TALONARIO_TRANSITIONS: Transiciones<EstadoTalonario> = {
  activo: ['agotado', 'anulado'],
  agotado: [],
  anulado: [],
};

/** Subcuenta de talones en tránsito (cheques emitidos o recibidos no compensados). */
export const CUENTA_TALONES_TRANSITO = '5729';

export class ErrorTalon extends Error {
  constructor(
    readonly codigo: string,
    message: string,
  ) {
    super(message);
    this.name = 'ErrorTalon';
  }
}

/** Valida el rango de un talonario y que no se solape con otros de la cuenta. */
export function validarTalonario(
  t: { primero: number; ultimo: number },
  existentes: readonly { primero: number; ultimo: number }[] = [],
): void {
  if (
    !Number.isInteger(t.primero) ||
    !Number.isInteger(t.ultimo) ||
    t.primero < 1 ||
    t.ultimo < t.primero
  ) {
    throw new ErrorTalon(
      'CHECK_BOOK_RANGE_INVALID',
      'El rango del talonario no es válido (primero ≤ último, enteros positivos)',
    );
  }
  if (t.ultimo - t.primero + 1 > 10_000) {
    throw new ErrorTalon(
      'CHECK_BOOK_RANGE_INVALID',
      'Un talonario tiene como máximo 10.000 talones',
    );
  }
  const solapa = existentes.find(
    (e) => t.primero <= e.ultimo && e.primero <= t.ultimo,
  );
  if (solapa) {
    throw new ErrorTalon(
      'CHECK_BOOK_OVERLAP',
      `El rango ${t.primero}–${t.ultimo} se solapa con el talonario ${solapa.primero}–${solapa.ultimo} de la cuenta`,
    );
  }
}

/** Número legible de un talón: prefijo + secuencia con ceros a la izquierda. */
export function numeroTalon(
  prefijo: string,
  secuencia: number,
  digitos = 7,
): string {
  return `${prefijo}${String(secuencia).padStart(digitos, '0')}`;
}

/** Siguiente número del talonario y si queda agotado tras usarlo. */
export function siguienteTalon(t: {
  estado: EstadoTalonario;
  siguiente: number;
  ultimo: number;
}): { secuencia: number; agotadoTras: boolean } {
  if (t.estado === 'anulado') {
    throw new ErrorTalon('CHECK_BOOK_INACTIVE', 'El talonario está anulado');
  }
  if (t.estado === 'agotado' || t.siguiente > t.ultimo) {
    throw new ErrorTalon('CHECK_BOOK_EXHAUSTED', 'El talonario está agotado');
  }
  return { secuencia: t.siguiente, agotadoTras: t.siguiente === t.ultimo };
}

/** Efectos contables de una transición del talón. */
export interface EfectosTalon {
  /** Asiento de compensación 5729 ↔ 5720. */
  compensar: boolean;
  /** Revertir la compensación ya contabilizada. */
  revertirCompensacion: boolean;
  /** Anular la liquidación del vencimiento (la deuda vuelve a quedar viva). */
  anularLiquidacion: boolean;
}

export function efectosTransicionTalon(
  de: EstadoTalon,
  a: EstadoTalon,
): EfectosTalon {
  if (!TALON_TRANSITIONS[de].includes(a)) {
    throw new ErrorTalon(
      'CHECK_INVALID_TRANSITION',
      `Un talón ${ESTADO_TALON_LABELS[de].toLowerCase()} no puede pasar a ${ESTADO_TALON_LABELS[a].toLowerCase()}`,
    );
  }
  return {
    compensar: a === 'cobrado',
    revertirCompensacion: de === 'cobrado' && a === 'devuelto',
    anularLiquidacion: a === 'anulado' || a === 'detenido' || a === 'devuelto',
  };
}

/**
 * Fechas coherentes: la entrega y la compensación no son anteriores a la
 * emisión, y un talón con fecha de pago (diferido) no se compensa antes de
 * ella. Ninguna fecha puede ser futura.
 */
export function validarFechaTalon(x: {
  hoy: string;
  emision: string;
  vencimiento?: string | null;
  fecha: string;
  operacion: 'emitir' | 'entregar' | 'cobrar' | 'anular';
}): void {
  if (x.fecha > x.hoy) {
    throw new ErrorTalon('CHECK_DATE_INVALID', 'La fecha no puede ser futura');
  }
  if (x.operacion !== 'emitir' && x.fecha < x.emision) {
    throw new ErrorTalon(
      'CHECK_DATE_INVALID',
      `La fecha no puede ser anterior a la emisión (${x.emision})`,
    );
  }
  if (x.operacion === 'cobrar' && x.vencimiento && x.fecha < x.vencimiento) {
    throw new ErrorTalon(
      'CHECK_DATE_INVALID',
      `El talón es de fecha ${x.vencimiento}: no se compensa antes`,
    );
  }
}

/** Importe positivo en céntimos exactos. */
export function importeTalon(importe: string | number): bigint {
  const c = toCents(importe);
  if (c <= 0n)
    throw new ErrorTalon(
      'CHECK_AMOUNT_INVALID',
      'El importe del talón debe ser mayor que cero',
    );
  return c;
}

/* ───────────────────────────── contratos ───────────────────────────── */

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: AAAA-MM-DD');
const motivo = z.string().trim().min(3).max(240);

export const talonarioCreateSchema = z.object({
  bankAccountId: z.string().uuid(),
  prefijo: z
    .string()
    .trim()
    .max(10)
    .regex(/^[A-Z0-9-]*$/i, 'Solo letras, números y guiones')
    .default(''),
  primero: z.number().int().min(1).max(99_999_999),
  ultimo: z.number().int().min(1).max(99_999_999),
});
export type TalonarioCreateInput = z.input<typeof talonarioCreateSchema>;

/** Emitir un talón (pago) o registrar uno recibido (cobro) contra un vencimiento. */
export const talonCreateSchema = z
  .object({
    direccion: z.enum(DIRECCIONES_TALON),
    vencimientoId: z.string().uuid(),
    importe: z
      .number()
      .finite()
      .positive()
      .max(9_999_999_999.99)
      .refine(
        (n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6,
        'Como máximo dos decimales',
      ),
    fechaEmision: fecha,
    /** Fecha de pago del talón (diferido); sin ella, a la vista. */
    fechaVencimiento: fecha.nullish(),
    /** Emitido: talonario del que sale el número. */
    talonarioId: z.string().uuid().optional(),
    /** Recibido: cuenta donde se deposita y número del cheque del cliente. */
    bankAccountId: z.string().uuid().optional(),
    numero: z.string().trim().min(1).max(30).optional(),
    concepto: z.string().trim().max(240).nullish(),
  })
  .refine(
    (t) =>
      t.direccion === 'emitido'
        ? Boolean(t.talonarioId)
        : Boolean(t.bankAccountId && t.numero),
    {
      message:
        'Un talón emitido sale de un talonario; uno recibido lleva cuenta de depósito y número',
    },
  )
  .refine((t) => !t.fechaVencimiento || t.fechaVencimiento >= t.fechaEmision, {
    path: ['fechaVencimiento'],
    message: 'La fecha de pago no puede ser anterior a la emisión',
  });
export type TalonCreateInput = z.input<typeof talonCreateSchema>;

export const talonAccionSchema = z.object({
  accion: z.enum(['entregar', 'cobrar', 'anular', 'detener', 'devolver']),
  fecha,
  motivo: motivo.optional(),
});
export type TalonAccionInput = z.input<typeof talonAccionSchema>;

export const talonesQuerySchema = z.object({
  direccion: z.enum(DIRECCIONES_TALON).optional(),
  estado: z.enum(ESTADOS_TALON).optional(),
  bankAccountId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
});
export type TalonesQuery = z.infer<typeof talonesQuerySchema>;

export interface TalonarioDto {
  id: string;
  bankAccountId: string;
  bankAccountName: string;
  prefijo: string;
  primero: number;
  ultimo: number;
  siguiente: number;
  disponibles: number;
  estado: EstadoTalonario;
  version: number;
}

export interface TalonDto {
  id: string;
  direccion: DireccionTalon;
  numero: string;
  talonarioId: string | null;
  bankAccountId: string;
  contactId: string;
  contactName: string;
  vencimientoId: string;
  invoiceNumber: string;
  importe: number;
  fechaEmision: string;
  fechaVencimiento: string | null;
  fechaEntrega: string | null;
  fechaCobro: string | null;
  fechaBaja: string | null;
  estado: EstadoTalon;
  motivo: string | null;
  concepto: string | null;
  liquidacionId: string | null;
  asientoCompensacionId: string | null;
  version: number;
}
