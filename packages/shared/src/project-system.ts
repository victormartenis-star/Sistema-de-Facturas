/**
 * Project System (SAP PS / Oracle Project Contracts): retenciones de garantía
 * de certificaciones de obra (las que nos retiene el cliente, 4301) y de
 * subcontrata (las que retenemos al subcontratista, 4001); su liberación por
 * hito o por **sustitución con aval bancario**, y los modificados del
 * contrato de subcontrata.
 *
 * Una retención es el vencimiento `retencion` de la factura (cobro o pago).
 * Liberarla adelanta su vencimiento a la fecha del hito o de la sustitución;
 * el cobro o pago lo hace después tesorería, sin asiento propio (no hay
 * duplicidad: la cuenta 4301/4001 la salda la liquidación).
 *
 * Funciones puras en céntimos `BigInt`.
 */

import { z } from 'zod';
import { fromCents, sumCents, toCents } from './dinero';

type Importe = string | number;

export const TIPOS_LIBERACION_RETENCION = ['aval', 'hito'] as const;
export type TipoLiberacionRetencion =
  (typeof TIPOS_LIBERACION_RETENCION)[number];

export const TIPO_LIBERACION_RETENCION_LABELS: Record<
  TipoLiberacionRetencion,
  string
> = {
  aval: 'Sustitución por aval bancario',
  hito: 'Hito (recepción, fin de garantía…)',
};

/** Lado de la retención: la que nos retiene el cliente o la que retenemos al proveedor. */
export const LADOS_RETENCION = ['cobro', 'pago'] as const;
export type LadoRetencion = (typeof LADOS_RETENCION)[number];

export class ErrorProyecto extends Error {
  constructor(
    readonly codigo: string,
    message: string,
  ) {
    super(message);
    this.name = 'ErrorProyecto';
  }
}

export interface RetencionLiberable {
  id: string;
  /** Pendiente vivo del vencimiento de retención (importe − liquidado). */
  pendiente: Importe;
  vencimiento: string;
}

/**
 * Plan de una liberación de retenciones: todas las retenciones elegidas
 * están abiertas y aún no vencidas a la fecha (si ya vencieron, no hay nada
 * que adelantar) y, en una sustitución por aval, el total no supera el saldo
 * vivo del aval menos lo que ya sustituye. Devuelve el total liberado.
 */
export function planLiberacionRetenciones(x: {
  fecha: string;
  retenciones: readonly RetencionLiberable[];
  aval?: { saldoVivo: Importe; yaSustituido: Importe } | null;
}): {
  total: number;
  lineas: { id: string; importe: number; vencimientoAnterior: string }[];
} {
  if (x.retenciones.length === 0) {
    throw new ErrorProyecto(
      'PS_RETENTION_NOT_OPEN',
      'Elige al menos una retención pendiente',
    );
  }
  const vistas = new Set<string>();
  const lineas = x.retenciones.map((r) => {
    if (vistas.has(r.id)) {
      throw new ErrorProyecto(
        'PS_RETENTION_NOT_OPEN',
        'Una retención se repite',
      );
    }
    vistas.add(r.id);
    const c = toCents(r.pendiente);
    if (c <= 0n) {
      throw new ErrorProyecto(
        'PS_RETENTION_NOT_OPEN',
        'La retención no tiene pendiente',
      );
    }
    if (r.vencimiento <= x.fecha) {
      throw new ErrorProyecto(
        'PS_RETENTION_ALREADY_RELEASABLE',
        `La retención ya es liberable (vence el ${r.vencimiento}): no hay nada que adelantar`,
      );
    }
    return { id: r.id, c, vencimientoAnterior: r.vencimiento };
  });
  const total = sumCents(lineas.map((l) => l.c));
  if (x.aval) {
    const disponible = toCents(x.aval.saldoVivo) - toCents(x.aval.yaSustituido);
    if (total > disponible) {
      throw new ErrorProyecto(
        'PS_GUARANTEE_INSUFFICIENT',
        `El aval cubre ${fromCents(disponible > 0n ? disponible : 0n)} y se sustituirían ${fromCents(total)}`,
      );
    }
  }
  return {
    total: fromCents(total),
    lineas: lineas.map((l) => ({
      id: l.id,
      importe: fromCents(l.c),
      vencimientoAnterior: l.vencimientoAnterior,
    })),
  };
}

/**
 * Un aval que sustituye retenciones no se libera ni se reduce por debajo de
 * lo que sustituye (las retenciones ya liberadas quedarían sin garantía).
 * Devuelve el motivo o null.
 */
export function motivoReduccionAvalSustituto(x: {
  saldoVivoTras: Importe;
  sustituido: Importe;
}): string | null {
  const tras = toCents(x.saldoVivoTras);
  const sust = toCents(x.sustituido);
  if (sust > 0n && tras < sust) {
    return `El aval sustituye ${fromCents(sust)} de retenciones: su saldo vivo no puede bajar a ${fromCents(tras)}`;
  }
  return null;
}

export interface RetencionObraEntrada {
  lado: LadoRetencion;
  importe: Importe;
  liquidado: Importe;
  vencimiento: string;
  /** Liberada por sustitución con aval (vigente). */
  sustituidaAval: boolean;
  /** Liberada por hito (vigente). */
  liberadaHito: boolean;
}

export interface ResumenRetencionLado {
  retenido: number;
  liquidado: number;
  pendiente: number;
  /** Pendiente liberable a la fecha (vencida o adelantada). */
  liberable: number;
  /** Pendiente cubierto por aval de sustitución. */
  sustituidoAval: number;
  /** Pendiente aún dentro del plazo de garantía y sin liberar. */
  enGarantia: number;
}

/** Resumen de las retenciones de la obra por lado, en céntimos exactos. */
export function resumenRetencionesObra(
  fecha: string,
  retenciones: readonly RetencionObraEntrada[],
): Record<LadoRetencion, ResumenRetencionLado> {
  const lado = (l: LadoRetencion): ResumenRetencionLado => {
    const rs = retenciones.filter((r) => r.lado === l);
    let retenido = 0n;
    let liquidado = 0n;
    let liberable = 0n;
    let sustituido = 0n;
    for (const r of rs) {
      const imp = toCents(r.importe);
      const liq = toCents(r.liquidado);
      const pend = imp - liq;
      retenido += imp;
      liquidado += liq;
      if (pend > 0n) {
        if (r.vencimiento <= fecha) liberable += pend;
        if (r.sustituidaAval) sustituido += pend;
      }
    }
    const pendiente = retenido - liquidado;
    return {
      retenido: fromCents(retenido),
      liquidado: fromCents(liquidado),
      pendiente: fromCents(pendiente),
      liberable: fromCents(liberable),
      sustituidoAval: fromCents(sustituido),
      enGarantia: fromCents(pendiente - liberable),
    };
  };
  return { cobro: lado('cobro'), pago: lado('pago') };
}

/**
 * Modificado (adenda) de un contrato de subcontrata: el importe vigente es el
 * anterior más el modificado (con signo) y no puede quedar por debajo de lo
 * ya certificado a origen ni en negativo.
 */
export function aplicarModificado(x: {
  importeVigente: Importe;
  importeModificado: Importe;
  certificadoOrigen: Importe;
}): number {
  const m = toCents(x.importeModificado);
  if (m === 0n) {
    throw new ErrorProyecto(
      'PS_CHANGE_INVALID',
      'El modificado no puede ser de importe cero',
    );
  }
  const nuevo = toCents(x.importeVigente) + m;
  if (nuevo <= 0n) {
    throw new ErrorProyecto(
      'PS_CHANGE_INVALID',
      'El contrato quedaría sin importe',
    );
  }
  if (nuevo < toCents(x.certificadoOrigen)) {
    throw new ErrorProyecto(
      'PS_CHANGE_BELOW_CERTIFIED',
      `El contrato quedaría en ${fromCents(nuevo)} y ya hay ${fromCents(toCents(x.certificadoOrigen))} certificados a origen`,
    );
  }
  return fromCents(nuevo);
}

/* ───────────────────────────── contratos ───────────────────────────── */

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: AAAA-MM-DD');

export const liberacionRetencionSchema = z
  .object({
    tipo: z.enum(TIPOS_LIBERACION_RETENCION),
    fecha,
    /** Vencimientos de retención que se liberan (enteros). */
    vencimientoIds: z.array(z.string().uuid()).min(1).max(200),
    /** Aval que sustituye la retención (obligatorio en `aval`). */
    avalId: z.string().uuid().optional(),
    motivo: z.string().trim().min(3).max(240),
  })
  .refine((l) => (l.tipo === 'aval') === Boolean(l.avalId), {
    path: ['avalId'],
    message:
      'La sustitución por aval indica el aval; la liberación por hito no lleva aval',
  });
export type LiberacionRetencionInput = z.input<
  typeof liberacionRetencionSchema
>;

export const anularLiberacionSchema = z.object({
  motivo: z.string().trim().min(3).max(240),
});
export type AnularLiberacionInput = z.input<typeof anularLiberacionSchema>;

export const modificadoSubcontrataSchema = z.object({
  fecha,
  importe: z
    .number()
    .finite()
    .refine((n) => n !== 0, 'El importe no puede ser cero')
    .refine(
      (n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6,
      'Como máximo dos decimales',
    ),
  motivo: z.string().trim().min(3).max(500),
});
export type ModificadoSubcontrataInput = z.input<
  typeof modificadoSubcontrataSchema
>;

export interface RetencionProyectoDto {
  vencimientoId: string;
  lado: LadoRetencion;
  invoiceId: string;
  invoiceNumber: string;
  contactId: string;
  contactName: string;
  importe: number;
  liquidado: number;
  pendiente: number;
  vencimiento: string;
  /** Vencimiento original (antes de adelantarlo), si se liberó. */
  vencimientoOriginal: string | null;
  liberacion: {
    id: string;
    tipo: TipoLiberacionRetencion;
    avalId: string | null;
    avalReferencia: string | null;
    fecha: string;
  } | null;
}

export interface RetencionesProyectoDto {
  projectId: string;
  fecha: string;
  resumen: Record<LadoRetencion, ResumenRetencionLado>;
  retenciones: RetencionProyectoDto[];
}

export interface LiberacionRetencionDto {
  id: string;
  tipo: TipoLiberacionRetencion;
  lado: LadoRetencion;
  projectId: string;
  contactId: string;
  avalId: string | null;
  fecha: string;
  importe: number;
  estado: 'vigente' | 'anulado';
  motivo: string;
  motivoAnulacion: string | null;
  lineas: {
    vencimientoId: string;
    importe: number;
    vencimientoAnterior: string;
  }[];
  version: number;
}

export interface ModificadoSubcontrataDto {
  id: string;
  contratoId: string;
  numero: number;
  fecha: string;
  importe: number;
  importeAnterior: number;
  importeNuevo: number;
  motivo: string;
}
