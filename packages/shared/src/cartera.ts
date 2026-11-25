/**
 * Cartera de clientes y proveedores (subledgers AR / AP): partidas abiertas
 * por tercero y documento, antigüedad de saldos por tramos, imputación de
 * cobros, pagos y anticipos, compensación cobro ↔ pago y conciliación por
 * tercero frente al mayor. Al estilo de SAP FI-AR / FI-AP (FBL5N / FBL1N,
 * F-32 / F-44) y Oracle Receivables / Payables.
 *
 * Funciones puras en céntimos `BigInt`, sin base de datos y sin reloj: la
 * fecha de corte entra siempre como parámetro.
 */

import { z } from 'zod';
import { fromCents, sumCents, toCents } from './dinero';

type Importe = string | number;

/* ───────────────────────────── catálogos ───────────────────────────── */

export const TIPOS_CARTERA = ['clientes', 'proveedores'] as const;
export type TipoCartera = (typeof TIPOS_CARTERA)[number];

/** Dirección del vencimiento de cada cartera. */
export const DIRECCION_CARTERA: Record<TipoCartera, 'cobro' | 'pago'> = {
  clientes: 'cobro',
  proveedores: 'pago',
};

export const TRAMOS_ANTIGUEDAD = [
  'al_corriente',
  'd1_30',
  'd31_60',
  'd61_90',
  'mas_90',
] as const;
export type TramoAntiguedad = (typeof TRAMOS_ANTIGUEDAD)[number];

export const TRAMO_ANTIGUEDAD_LABELS: Record<TramoAntiguedad, string> = {
  al_corriente: 'Al corriente',
  d1_30: '1–30 días',
  d31_60: '31–60 días',
  d61_90: '61–90 días',
  mas_90: 'Más de 90 días',
};

/** Origen de una liquidación: caja (tesorería) o no monetaria. */
export const ORIGENES_LIQUIDACION = [
  'tesoreria',
  'anticipo',
  'compensacion',
] as const;
export type OrigenLiquidacion = (typeof ORIGENES_LIQUIDACION)[number];

export const ESTADOS_DOCUMENTO_CARTERA = ['vigente', 'anulado'] as const;
export type EstadoDocumentoCartera = (typeof ESTADOS_DOCUMENTO_CARTERA)[number];

/** Anticipo o compensación: solo se anula (terminal). */
export const DOCUMENTO_CARTERA_TRANSITIONS: Record<
  EstadoDocumentoCartera,
  readonly EstadoDocumentoCartera[]
> = { vigente: ['anulado'], anulado: [] };

/* ───────────────────────────── reglas ───────────────────────────── */

/** Días entre dos fechas ISO (b − a), sin zonas horarias. */
export function diasEntre(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** Tramo de antigüedad según los días vencidos (≤ 0: al corriente). */
export function tramoAntiguedad(diasVencido: number): TramoAntiguedad {
  if (diasVencido <= 0) return 'al_corriente';
  if (diasVencido <= 30) return 'd1_30';
  if (diasVencido <= 60) return 'd31_60';
  if (diasVencido <= 90) return 'd61_90';
  return 'mas_90';
}

export interface PartidaEntrada {
  id: string;
  contactId: string;
  contactName: string;
  invoiceId: string;
  invoiceNumber: string;
  kind: 'ordinario' | 'retencion';
  vencimiento: string;
  importe: Importe;
  /** Liquidado vigente hasta la fecha de corte (caja, anticipos y compensaciones). */
  liquidado: Importe;
}

export interface PartidaAbiertaDto {
  id: string;
  contactId: string;
  contactName: string;
  invoiceId: string;
  invoiceNumber: string;
  kind: 'ordinario' | 'retencion';
  vencimiento: string;
  importe: number;
  liquidado: number;
  pendiente: number;
  diasVencido: number;
  tramo: TramoAntiguedad;
}

/**
 * Partidas abiertas a la fecha: pendiente = importe − liquidado ≠ 0 (los
 * saldos de signo contrario —abonos, sobrecobros— se conservan). Orden:
 * tercero, vencimiento y documento.
 */
export function partidasAbiertas(
  partidas: readonly PartidaEntrada[],
  fecha: string,
): PartidaAbiertaDto[] {
  return partidas
    .map((p) => {
      const pendiente = toCents(p.importe) - toCents(p.liquidado);
      const diasVencido = diasEntre(p.vencimiento, fecha);
      return {
        id: p.id,
        contactId: p.contactId,
        contactName: p.contactName,
        invoiceId: p.invoiceId,
        invoiceNumber: p.invoiceNumber,
        kind: p.kind,
        vencimiento: p.vencimiento,
        importe: fromCents(toCents(p.importe)),
        liquidado: fromCents(toCents(p.liquidado)),
        pendiente: fromCents(pendiente),
        diasVencido,
        tramo: tramoAntiguedad(diasVencido),
        _p: pendiente,
      };
    })
    .filter((p) => p._p !== 0n)
    .sort(
      (a, b) =>
        a.contactName.localeCompare(b.contactName) ||
        a.contactId.localeCompare(b.contactId) ||
        a.vencimiento.localeCompare(b.vencimiento) ||
        a.invoiceNumber.localeCompare(b.invoiceNumber) ||
        a.id.localeCompare(b.id),
    )
    .map(({ _p, ...p }) => p);
}

export type ImportesPorTramo = Record<TramoAntiguedad, number>;

export interface AntiguedadTerceroDto {
  contactId: string;
  contactName: string;
  tramos: ImportesPorTramo;
  /** Retención de garantía pendiente (incluida en los tramos por su liberación). */
  retencion: number;
  vencido: number;
  total: number;
  partidas: number;
}

export interface AntiguedadDto {
  tipo: TipoCartera;
  fecha: string;
  terceros: AntiguedadTerceroDto[];
  totales: Omit<AntiguedadTerceroDto, 'contactId' | 'contactName'>;
}

const tramosCero = (): Record<TramoAntiguedad, bigint> => ({
  al_corriente: 0n,
  d1_30: 0n,
  d31_60: 0n,
  d61_90: 0n,
  mas_90: 0n,
});

/**
 * Antigüedad de saldos por tercero y tramo, en céntimos exactos: la suma de
 * los tramos de cada tercero es su total y la de los terceros, el total
 * general (lo comprueba un test).
 */
export function antiguedadSaldos(
  tipo: TipoCartera,
  fecha: string,
  partidas: readonly PartidaAbiertaDto[],
): AntiguedadDto {
  const porTercero = new Map<
    string,
    {
      contactName: string;
      tramos: Record<TramoAntiguedad, bigint>;
      retencion: bigint;
      partidas: number;
    }
  >();
  for (const p of partidas) {
    const t = porTercero.get(p.contactId) ?? {
      contactName: p.contactName,
      tramos: tramosCero(),
      retencion: 0n,
      partidas: 0,
    };
    const c = toCents(p.pendiente);
    t.tramos[p.tramo] += c;
    if (p.kind === 'retencion') t.retencion += c;
    t.partidas += 1;
    porTercero.set(p.contactId, t);
  }
  const salida = (
    tr: Record<TramoAntiguedad, bigint>,
    retencion: bigint,
    n: number,
  ) => {
    const total = sumCents(TRAMOS_ANTIGUEDAD.map((k) => tr[k]));
    return {
      tramos: Object.fromEntries(
        TRAMOS_ANTIGUEDAD.map((k) => [k, fromCents(tr[k])]),
      ) as ImportesPorTramo,
      retencion: fromCents(retencion),
      vencido: fromCents(total - tr.al_corriente),
      total: fromCents(total),
      partidas: n,
    };
  };
  const terceros = [...porTercero.entries()]
    .map(([contactId, t]) => ({
      contactId,
      contactName: t.contactName,
      ...salida(t.tramos, t.retencion, t.partidas),
    }))
    .sort(
      (a, b) =>
        a.contactName.localeCompare(b.contactName) ||
        a.contactId.localeCompare(b.contactId),
    );
  const tot = tramosCero();
  let ret = 0n;
  let n = 0;
  for (const t of porTercero.values()) {
    for (const k of TRAMOS_ANTIGUEDAD) tot[k] += t.tramos[k];
    ret += t.retencion;
    n += t.partidas;
  }
  return { tipo, fecha, terceros, totales: salida(tot, ret, n) };
}

export class ErrorCartera extends Error {
  constructor(
    readonly codigo:
      | 'AR_AP_ALLOCATION_INVALID'
      | 'AR_AP_ALLOCATION_EXCEEDS_ITEM'
      | 'AR_AP_ALLOCATION_EXCEEDS_AVAILABLE'
      | 'AR_AP_ITEM_NOT_OPEN'
      | 'AR_AP_ITEM_NOT_FOUND'
      | 'AR_AP_NETTING_UNBALANCED',
    message: string,
  ) {
    super(message);
    this.name = 'ErrorCartera';
  }
}

export interface PartidaImputable {
  id: string;
  vencimiento: string;
  /** Pendiente actual (positivo para imputar). */
  pendiente: Importe;
}

export interface Imputacion {
  vencimientoId: string;
  importe: number;
}

/**
 * Imputa un importe disponible (cobro, pago, anticipo o compensación) a
 * partidas abiertas. Con `explicitas`, valida cada una (partida conocida y
 * abierta, importe > 0 sin superar su pendiente, sin repetir) y que el total
 * no supere el disponible. Sin ellas, reparte por antigüedad (vencimiento
 * más antiguo primero, como la compensación automática de SAP F.13) hasta
 * agotar el disponible. Nunca deja una partida con signo contrario.
 */
export function imputarPartidas(x: {
  disponible: Importe;
  partidas: readonly PartidaImputable[];
  explicitas?: readonly { vencimientoId: string; importe: Importe }[];
}): Imputacion[] {
  const disponible = toCents(x.disponible);
  if (disponible <= 0n) {
    throw new ErrorCartera(
      'AR_AP_ALLOCATION_INVALID',
      'El importe a imputar debe ser mayor que cero',
    );
  }
  const porId = new Map(x.partidas.map((p) => [p.id, p]));
  if (x.explicitas && x.explicitas.length > 0) {
    const vistos = new Set<string>();
    let total = 0n;
    const out: Imputacion[] = [];
    for (const e of x.explicitas) {
      const p = porId.get(e.vencimientoId);
      if (!p) {
        throw new ErrorCartera(
          'AR_AP_ITEM_NOT_FOUND',
          `La partida ${e.vencimientoId} no es de este tercero o no está abierta`,
        );
      }
      if (vistos.has(e.vencimientoId)) {
        throw new ErrorCartera(
          'AR_AP_ALLOCATION_INVALID',
          'Una partida no se imputa dos veces en la misma operación',
        );
      }
      vistos.add(e.vencimientoId);
      const c = toCents(e.importe);
      const pend = toCents(p.pendiente);
      if (pend <= 0n) {
        throw new ErrorCartera(
          'AR_AP_ITEM_NOT_OPEN',
          'La partida no tiene pendiente que saldar',
        );
      }
      if (c <= 0n) {
        throw new ErrorCartera(
          'AR_AP_ALLOCATION_INVALID',
          'Cada imputación debe ser mayor que cero',
        );
      }
      if (c > pend) {
        throw new ErrorCartera(
          'AR_AP_ALLOCATION_EXCEEDS_ITEM',
          `La imputación (${fromCents(c)}) supera el pendiente de la partida (${fromCents(pend)})`,
        );
      }
      total += c;
      out.push({ vencimientoId: e.vencimientoId, importe: fromCents(c) });
    }
    if (total > disponible) {
      throw new ErrorCartera(
        'AR_AP_ALLOCATION_EXCEEDS_AVAILABLE',
        `Se imputan ${fromCents(total)} y solo hay ${fromCents(disponible)} disponibles`,
      );
    }
    return out;
  }
  let resto = disponible;
  const out: Imputacion[] = [];
  const ordenadas = [...x.partidas]
    .filter((p) => toCents(p.pendiente) > 0n)
    .sort(
      (a, b) =>
        a.vencimiento.localeCompare(b.vencimiento) || a.id.localeCompare(b.id),
    );
  for (const p of ordenadas) {
    if (resto === 0n) break;
    const c = toCents(p.pendiente) < resto ? toCents(p.pendiente) : resto;
    out.push({ vencimientoId: p.id, importe: fromCents(c) });
    resto -= c;
  }
  if (out.length === 0) {
    throw new ErrorCartera(
      'AR_AP_ITEM_NOT_OPEN',
      'No hay partidas abiertas a las que imputar',
    );
  }
  return out;
}

/**
 * Plan de una compensación cobro ↔ pago de un mismo tercero (cliente y
 * proveedor a la vez): el importe es el indicado o, por defecto, el menor de
 * los dos pendientes; cada lado se imputa por antigüedad (o explícitamente) y
 * ambos lados suman exactamente el importe compensado.
 */
export function planCompensacion(x: {
  importe?: Importe | null;
  cobros: readonly PartidaImputable[];
  pagos: readonly PartidaImputable[];
  explicitasCobros?: readonly { vencimientoId: string; importe: Importe }[];
  explicitasPagos?: readonly { vencimientoId: string; importe: Importe }[];
}): { importe: number; cobros: Imputacion[]; pagos: Imputacion[] } {
  const total = (ps: readonly PartidaImputable[]) =>
    sumCents(ps.map((p) => toCents(p.pendiente)).filter((c) => c > 0n));
  const maximo = (() => {
    const a = total(x.cobros);
    const b = total(x.pagos);
    return a < b ? a : b;
  })();
  if (maximo <= 0n) {
    throw new ErrorCartera(
      'AR_AP_ITEM_NOT_OPEN',
      'El tercero no tiene a la vez partidas a cobrar y a pagar abiertas',
    );
  }
  const importe =
    x.importe === undefined || x.importe === null ? maximo : toCents(x.importe);
  if (importe <= 0n) {
    throw new ErrorCartera(
      'AR_AP_ALLOCATION_INVALID',
      'El importe a compensar debe ser mayor que cero',
    );
  }
  if (importe > maximo) {
    throw new ErrorCartera(
      'AR_AP_ALLOCATION_EXCEEDS_AVAILABLE',
      `Como máximo se compensan ${fromCents(maximo)} (el menor de los dos pendientes)`,
    );
  }
  const lado = (
    partidas: readonly PartidaImputable[],
    explicitas?: readonly { vencimientoId: string; importe: Importe }[],
  ) => {
    const imp = imputarPartidas({
      disponible: fromCents(importe),
      partidas,
      explicitas,
    });
    const suma = sumCents(imp.map((i) => toCents(i.importe)));
    if (suma !== importe) {
      throw new ErrorCartera(
        'AR_AP_NETTING_UNBALANCED',
        `Un lado de la compensación suma ${fromCents(suma)} y se compensan ${fromCents(importe)}`,
      );
    }
    return imp;
  };
  return {
    importe: fromCents(importe),
    cobros: lado(x.cobros, x.explicitasCobros),
    pagos: lado(x.pagos, x.explicitasPagos),
  };
}

export interface ConciliacionTerceroDto {
  /** null = apuntes del mayor sin tercero (manuales). */
  contactId: string | null;
  contactName: string;
  /** Auxiliar: partidas abiertas ordinarias + retenciones − anticipos pendientes. */
  ordinario: number;
  retencion: number;
  anticipos: number;
  auxiliar: number;
  mayor: number;
  diferencia: number;
  cuadra: boolean;
}

/**
 * Conciliación auxiliar ↔ mayor por tercero (SAP FBL5N/FBL1N frente a FAGLB03
 * por partner; Oracle Receivables/Payables to GL reconciliation). El auxiliar
 * neto es ordinario + retención − anticipos pendientes de aplicar (en la
 * orientación de la cartera: deudor en clientes, acreedor en proveedores); el
 * mayor, el saldo de 430x/438x (o 400x/407x) con ese tercero en la línea.
 * Los apuntes sin tercero quedan en una fila propia, que solo cuadra a cero.
 */
export function conciliarTerceros(
  auxiliar: readonly {
    contactId: string;
    contactName: string;
    ordinario: Importe;
    retencion: Importe;
    anticipos: Importe;
  }[],
  mayor: readonly {
    contactId: string | null;
    contactName?: string;
    saldo: Importe;
  }[],
): { terceros: ConciliacionTerceroDto[]; cuadra: boolean; descuadres: number } {
  const filas = new Map<
    string,
    {
      contactId: string | null;
      contactName: string;
      ord: bigint;
      ret: bigint;
      ant: bigint;
      mayor: bigint;
    }
  >();
  const clave = (id: string | null) => id ?? '∅';
  for (const a of auxiliar) {
    const f = filas.get(clave(a.contactId)) ?? {
      contactId: a.contactId,
      contactName: a.contactName,
      ord: 0n,
      ret: 0n,
      ant: 0n,
      mayor: 0n,
    };
    f.ord += toCents(a.ordinario);
    f.ret += toCents(a.retencion);
    f.ant += toCents(a.anticipos);
    filas.set(clave(a.contactId), f);
  }
  for (const m of mayor) {
    const f = filas.get(clave(m.contactId)) ?? {
      contactId: m.contactId,
      contactName:
        m.contactId === null
          ? 'Sin tercero (apuntes manuales)'
          : (m.contactName ?? ''),
      ord: 0n,
      ret: 0n,
      ant: 0n,
      mayor: 0n,
    };
    f.mayor += toCents(m.saldo);
    filas.set(clave(m.contactId), f);
  }
  const terceros = [...filas.values()]
    .map((f) => {
      const aux = f.ord + f.ret - f.ant;
      return {
        contactId: f.contactId,
        contactName: f.contactName,
        ordinario: fromCents(f.ord),
        retencion: fromCents(f.ret),
        anticipos: fromCents(f.ant),
        auxiliar: fromCents(aux),
        mayor: fromCents(f.mayor),
        diferencia: fromCents(f.mayor - aux),
        cuadra: f.mayor === aux,
      };
    })
    .filter((t) => t.contactId !== null || t.mayor !== 0 || t.auxiliar !== 0)
    .sort((a, b) =>
      a.contactId === null
        ? 1
        : b.contactId === null
          ? -1
          : a.contactName.localeCompare(b.contactName) ||
            a.contactId.localeCompare(b.contactId),
    );
  const descuadres = terceros.filter((t) => !t.cuadra).length;
  return { terceros, cuadra: descuadres === 0, descuadres };
}

/* ─────────────── detalle de cobros y pagos en el EFE ───────────────
 * El EFE indirecto cuadra con la variación de 57x por partida doble. Este
 * detalle reparte esa misma variación según el origen de cada apunte de
 * tesorería (cobros de clientes y anticipos recibidos, pagos a proveedores y
 * anticipos entregados, otros), de modo que la suma es exactamente la
 * variación de 57x por construcción.
 */

export interface CobrosPagosEfe {
  cobrosClientes: number;
  pagosProveedores: number;
  otros: number;
  total: number;
  /** total = variación de 57x del EFE. */
  cuadra: boolean;
}

export function cobrosPagosEfe(
  filas: readonly {
    origen: string;
    tipo: 'cobro' | 'pago' | null;
    importe: Importe;
  }[],
  variacionEfectivo: Importe,
): CobrosPagosEfe {
  let cobros = 0n;
  let pagos = 0n;
  let total = 0n;
  for (const f of filas) {
    const c = toCents(f.importe);
    total += c;
    if (
      f.origen === 'cobro' ||
      (f.origen === 'anticipo' && f.tipo === 'cobro')
    ) {
      cobros += c;
    } else if (
      f.origen === 'pago' ||
      (f.origen === 'anticipo' && f.tipo === 'pago')
    ) {
      pagos += c;
    }
  }
  return {
    cobrosClientes: fromCents(cobros),
    pagosProveedores: fromCents(pagos),
    otros: fromCents(total - cobros - pagos),
    total: fromCents(total),
    cuadra: total === toCents(variacionEfectivo),
  };
}

/* ───────────────────────────── contratos ───────────────────────────── */

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
const importePositivo = importe.refine((n) => n > 0, 'Debe ser mayor que cero');
const imputacion = z.object({
  vencimientoId: z.string().uuid(),
  importe: importePositivo,
});
const motivo = z.string().trim().min(3).max(240);

export const carteraQuerySchema = z.object({
  tipo: z.enum(TIPOS_CARTERA),
  fecha: fecha.optional(),
  contactId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  soloVencidas: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type CarteraQuery = z.infer<typeof carteraQuerySchema>;

export const conciliacionCarteraQuerySchema = z.object({
  tipo: z.enum(TIPOS_CARTERA),
  fecha: fecha.optional(),
});
export type ConciliacionCarteraQuery = z.infer<
  typeof conciliacionCarteraQuerySchema
>;

export const anticipoCreateSchema = z.object({
  tipo: z.enum(TIPOS_CARTERA),
  contactId: z.string().uuid(),
  projectId: z.string().uuid().nullish(),
  importe: importePositivo,
  fecha,
  bankAccountId: z.string().uuid().nullish(),
  referencia: z.string().trim().max(80).nullish(),
  notas: z.string().trim().max(2000).nullish(),
});
export type AnticipoCreateInput = z.input<typeof anticipoCreateSchema>;

export const anticipoAplicarSchema = z.object({
  fecha,
  /** Sin imputaciones: por antigüedad hasta agotar el anticipo. */
  imputaciones: z.array(imputacion).max(200).optional(),
  importe: importePositivo.optional(),
});
export type AnticipoAplicarInput = z.input<typeof anticipoAplicarSchema>;

export const anticiposQuerySchema = z.object({
  tipo: z.enum(TIPOS_CARTERA).optional(),
  contactId: z.string().uuid().optional(),
  estado: z.enum(ESTADOS_DOCUMENTO_CARTERA).optional(),
});
export type AnticiposQuery = z.infer<typeof anticiposQuerySchema>;

export const compensacionCreateSchema = z.object({
  contactId: z.string().uuid(),
  fecha,
  /** Por defecto, el menor de los pendientes a cobrar y a pagar. */
  importe: importePositivo.optional(),
  cobros: z.array(imputacion).max(200).optional(),
  pagos: z.array(imputacion).max(200).optional(),
  notas: z.string().trim().max(2000).nullish(),
});
export type CompensacionCreateInput = z.input<typeof compensacionCreateSchema>;

export const documentoCarteraAnularSchema = z.object({ motivo });
export type DocumentoCarteraAnularInput = z.input<
  typeof documentoCarteraAnularSchema
>;

export interface AnticipoDto {
  id: string;
  tipo: TipoCartera;
  contactId: string;
  contactName: string;
  projectId: string | null;
  fecha: string;
  importe: number;
  aplicado: number;
  disponible: number;
  estado: EstadoDocumentoCartera;
  referencia: string | null;
  asientoId: string | null;
  contraAsientoId: string | null;
  motivoAnulacion: string | null;
  aplicaciones: {
    liquidacionId: string;
    vencimientoId: string;
    invoiceNumber: string;
    fecha: string;
    importe: number;
    estado: 'vigente' | 'anulada';
  }[];
  version: number;
}

export interface CompensacionDto {
  id: string;
  contactId: string;
  contactName: string;
  fecha: string;
  importe: number;
  estado: EstadoDocumentoCartera;
  notas: string | null;
  motivoAnulacion: string | null;
  lineas: {
    liquidacionId: string;
    vencimientoId: string;
    direccion: 'cobro' | 'pago';
    invoiceNumber: string;
    importe: number;
    estado: 'vigente' | 'anulada';
  }[];
  version: number;
}

export interface PartidasCarteraDto {
  tipo: TipoCartera;
  fecha: string;
  partidas: PartidaAbiertaDto[];
  total: number;
}

export interface ConciliacionCarteraDto {
  tipo: TipoCartera;
  fecha: string;
  cuentas: string;
  terceros: ConciliacionTerceroDto[];
  cuadra: boolean;
  descuadres: number;
}
