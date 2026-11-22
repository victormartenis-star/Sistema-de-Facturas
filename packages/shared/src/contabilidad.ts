/**
 * Contabilidad general (libro mayor) — reglas puras.
 *
 * Modelo inspirado en SAP FI / Oracle GL, adaptado al PGC español:
 *  - Plan de cuentas por empresa (códigos PGC de 3 a 12 dígitos). Solo las
 *    cuentas imputables (`imputable = true`) reciben apuntes.
 *  - Asientos **inmutables** una vez contabilizados: se corrigen con un
 *    contra-asiento (mismas líneas con debe y haber intercambiados).
 *  - Cuadre exacto en céntimos (BigInt): Σ debe = Σ haber, cada línea con
 *    un único lado positivo. La base de datos lo vuelve a comprobar con un
 *    trigger diferido (ver migración 0049).
 *  - Períodos mensuales: un período cerrado no admite asientos.
 *  - Interfaz contable: las facturas aprobadas y los vencimientos liquidados
 *    se contabilizan con `asientoDesdeFactura` / `asientoDesdeVencimiento`.
 *
 * Sin base de datos y sin reloj: la fecha entra siempre como parámetro.
 */

import { z } from 'zod';
import { centsToNumeric, fromCents, sumCents, toCents } from './dinero';
import type { Transiciones } from './maquina-estados';

/* ───────────────────────────── catálogos ───────────────────────────── */

export const TIPOS_CUENTA = [
  'activo',
  'pasivo',
  'patrimonio',
  'ingreso',
  'gasto',
] as const;
export type TipoCuenta = (typeof TIPOS_CUENTA)[number];

export const TIPO_CUENTA_LABELS: Record<TipoCuenta, string> = {
  activo: 'Activo',
  pasivo: 'Pasivo',
  patrimonio: 'Patrimonio neto',
  ingreso: 'Ingreso',
  gasto: 'Gasto',
};

export const ORIGENES_ASIENTO = [
  'manual',
  'factura_venta',
  'factura_compra',
  'cobro',
  'pago',
  'anulacion',
] as const;
export type OrigenAsiento = (typeof ORIGENES_ASIENTO)[number];

export const ORIGEN_ASIENTO_LABELS: Record<OrigenAsiento, string> = {
  manual: 'Manual',
  factura_venta: 'Factura de venta',
  factura_compra: 'Factura de compra',
  cobro: 'Cobro',
  pago: 'Pago',
  anulacion: 'Contra-asiento',
};

export const ESTADOS_ASIENTO = ['contabilizado', 'anulado'] as const;
export type EstadoAsiento = (typeof ESTADOS_ASIENTO)[number];

/** Un asiento solo se anula (con su contra-asiento); anulado es terminal. */
export const ASIENTO_TRANSITIONS: Transiciones<EstadoAsiento> = {
  contabilizado: ['anulado'],
  anulado: [],
};

export const ESTADOS_PERIODO = ['abierto', 'cerrado'] as const;
export type EstadoPeriodo = (typeof ESTADOS_PERIODO)[number];

/**
 * Cuentas que usa la interfaz contable. El plan se puede ampliar a mano,
 * pero estas deben existir: `planContableBase()` las crea.
 */
export const CUENTAS_INTERFAZ = {
  clientes: '4300',
  clientesRetencion: '4301',
  proveedores: '4000',
  proveedoresRetencion: '4001',
  ivaSoportado: '4720',
  ivaRepercutido: '4770',
  ventasObra: '7050',
  comprasMateriales: '6000',
  trabajosSubcontratas: '6070',
  bancos: '5720',
} as const;

export interface CuentaPlan {
  codigo: string;
  nombre: string;
  tipo: TipoCuenta;
  imputable: boolean;
}

/**
 * Subconjunto del PGC (RD 1514/2007) útil para una constructora. Las cuentas
 * de 3 dígitos agrupan (no imputables); las de 4, imputables.
 */
export function planContableBase(): CuentaPlan[] {
  const c = (
    codigo: string,
    nombre: string,
    tipo: TipoCuenta,
    imputable = codigo.length >= 4,
  ): CuentaPlan => ({ codigo, nombre, tipo, imputable });
  return [
    c('100', 'Capital social', 'patrimonio'),
    c('1000', 'Capital social', 'patrimonio'),
    c('129', 'Resultado del ejercicio', 'patrimonio'),
    c('1290', 'Resultado del ejercicio', 'patrimonio'),
    c('170', 'Deudas a largo plazo con entidades de crédito', 'pasivo'),
    c('1700', 'Préstamos a largo plazo', 'pasivo'),
    c('213', 'Maquinaria', 'activo'),
    c('2130', 'Maquinaria', 'activo'),
    c('218', 'Elementos de transporte', 'activo'),
    c('2180', 'Elementos de transporte', 'activo'),
    c('281', 'Amortización acumulada del inmovilizado material', 'activo'),
    c('2813', 'Amortización acumulada de maquinaria', 'activo'),
    c('300', 'Existencias de materiales', 'activo'),
    c('3000', 'Materiales en almacén', 'activo'),
    c('400', 'Proveedores', 'pasivo'),
    c('4000', 'Proveedores', 'pasivo'),
    c('4001', 'Proveedores, retenciones de garantía', 'pasivo'),
    c('430', 'Clientes', 'activo'),
    c('4300', 'Clientes', 'activo'),
    c('4301', 'Clientes, retenciones de garantía', 'activo'),
    c('465', 'Remuneraciones pendientes de pago', 'pasivo'),
    c('4650', 'Remuneraciones pendientes de pago', 'pasivo'),
    c('472', 'Hacienda Pública, IVA soportado', 'activo'),
    c('4720', 'Hacienda Pública, IVA soportado', 'activo'),
    c('475', 'Hacienda Pública, acreedora por conceptos fiscales', 'pasivo'),
    c('4751', 'Hacienda Pública, acreedora por retenciones', 'pasivo'),
    c('476', 'Organismos de la Seguridad Social, acreedores', 'pasivo'),
    c('4760', 'Organismos de la Seguridad Social, acreedores', 'pasivo'),
    c('477', 'Hacienda Pública, IVA repercutido', 'pasivo'),
    c('4770', 'Hacienda Pública, IVA repercutido', 'pasivo'),
    c('570', 'Caja', 'activo'),
    c('5700', 'Caja, euros', 'activo'),
    c('572', 'Bancos e instituciones de crédito c/c', 'activo'),
    c('5720', 'Bancos c/c', 'activo'),
    c('600', 'Compras de materiales', 'gasto'),
    c('6000', 'Compras de materiales', 'gasto'),
    c('607', 'Trabajos realizados por otras empresas', 'gasto'),
    c('6070', 'Trabajos realizados por subcontratas', 'gasto'),
    c('621', 'Arrendamientos y cánones', 'gasto'),
    c('6210', 'Alquiler de maquinaria', 'gasto'),
    c('622', 'Reparaciones y conservación', 'gasto'),
    c('6220', 'Reparaciones y conservación', 'gasto'),
    c('640', 'Sueldos y salarios', 'gasto'),
    c('6400', 'Sueldos y salarios', 'gasto'),
    c('642', 'Seguridad Social a cargo de la empresa', 'gasto'),
    c('6420', 'Seguridad Social a cargo de la empresa', 'gasto'),
    c('681', 'Amortización del inmovilizado material', 'gasto'),
    c('6810', 'Amortización del inmovilizado material', 'gasto'),
    c('700', 'Ventas', 'ingreso'),
    c('7000', 'Ventas de mercaderías', 'ingreso'),
    c('705', 'Prestaciones de servicios', 'ingreso'),
    c('7050', 'Ejecución de obra', 'ingreso'),
  ];
}

/** Tipo de cuenta deducido del grupo PGC (primer dígito), para altas manuales. */
export function tipoCuentaPorCodigo(codigo: string): TipoCuenta {
  switch (codigo.charAt(0)) {
    case '1':
      return codigo.startsWith('17') || codigo.startsWith('16')
        ? 'pasivo'
        : 'patrimonio';
    case '2':
    case '3':
    case '5':
      return codigo.startsWith('52') || codigo.startsWith('51')
        ? 'pasivo'
        : 'activo';
    case '4':
      return codigo.startsWith('40') ||
        codigo.startsWith('41') ||
        codigo.startsWith('46') ||
        codigo.startsWith('475') ||
        codigo.startsWith('476') ||
        codigo.startsWith('477')
        ? 'pasivo'
        : 'activo';
    case '6':
      return 'gasto';
    case '7':
      return 'ingreso';
    default:
      return 'activo';
  }
}

/* ─────────────────────────── esquemas (Zod) ─────────────────────────── */

const codigoCuenta = z
  .string()
  .trim()
  .regex(/^\d{3,12}$/, 'El código de cuenta es numérico, de 3 a 12 dígitos');

const fechaIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: AAAA-MM-DD');

const importe = z
  .number()
  .finite()
  .min(0, 'El importe no puede ser negativo')
  .max(9_999_999_999.99, 'Importe fuera de rango')
  .refine(
    (n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6,
    'Como máximo dos decimales',
  );

export const cuentaCreateSchema = z.object({
  codigo: codigoCuenta,
  nombre: z.string().trim().min(1).max(160),
  tipo: z.enum(TIPOS_CUENTA).optional(),
  imputable: z.boolean().default(true),
});
export type CuentaCreateInput = z.input<typeof cuentaCreateSchema>;

export const cuentaUpdateSchema = z
  .object({
    nombre: z.string().trim().min(1).max(160).optional(),
    activa: z.boolean().optional(),
  })
  .refine((v) => v.nombre !== undefined || v.activa !== undefined, {
    message: 'Indica al menos un campo a modificar',
  });
export type CuentaUpdateInput = z.input<typeof cuentaUpdateSchema>;

export const lineaAsientoSchema = z
  .object({
    cuenta: codigoCuenta,
    debe: importe.default(0),
    haber: importe.default(0),
    projectId: z.string().uuid().nullish(),
    concepto: z.string().trim().max(240).nullish(),
  })
  .refine((l) => l.debe > 0 !== l.haber > 0, {
    message: 'Cada línea lleva importe en el debe o en el haber, no en ambos',
  });
export type LineaAsientoInput = z.input<typeof lineaAsientoSchema>;

export const asientoCreateSchema = z
  .object({
    fecha: fechaIso,
    concepto: z.string().trim().min(1).max(240),
    lineas: z.array(lineaAsientoSchema).min(2).max(500),
  })
  .superRefine((a, ctx) => {
    const error = errorCuadre(a.lineas);
    if (error)
      ctx.addIssue({ code: 'custom', path: ['lineas'], message: error });
  });
export type AsientoCreateInput = z.input<typeof asientoCreateSchema>;

export const asientoAnularSchema = z.object({
  motivo: z.string().trim().min(3).max(240),
  /** Fecha del contra-asiento; por defecto, la del asiento original. */
  fecha: fechaIso.optional(),
});
export type AsientoAnularInput = z.input<typeof asientoAnularSchema>;

/* ──────────────────────────────── cuadre ──────────────────────────────── */

export interface LineaImporte {
  debe: number | string;
  haber: number | string;
}

export interface TotalesAsiento {
  debe: number;
  haber: number;
  descuadre: number;
}

/** Totales exactos (céntimos) de un conjunto de líneas. */
export function totalesAsiento(
  lineas: readonly LineaImporte[],
): TotalesAsiento {
  const debe = sumCents(lineas.map((l) => toCents(l.debe)));
  const haber = sumCents(lineas.map((l) => toCents(l.haber)));
  return {
    debe: fromCents(debe),
    haber: fromCents(haber),
    descuadre: fromCents(debe - haber),
  };
}

/**
 * Motivo por el que un asiento no es contabilizable, o `null` si cuadra.
 * Exige: al menos dos líneas, cada una con un único lado positivo, y
 * Σ debe = Σ haber al céntimo.
 */
export function errorCuadre(lineas: readonly LineaImporte[]): string | null {
  if (lineas.length < 2) return 'Un asiento necesita al menos dos líneas';
  for (const [i, l] of lineas.entries()) {
    const d = toCents(l.debe);
    const h = toCents(l.haber);
    if (d < 0n || h < 0n) return `Línea ${i + 1}: importe negativo`;
    if (d > 0n === h > 0n)
      return `Línea ${i + 1}: debe llevar importe en el debe o en el haber, no en ambos ni en ninguno`;
  }
  const t = totalesAsiento(lineas);
  if (t.descuadre !== 0) {
    return `El asiento no cuadra: debe ${t.debe.toFixed(2)} ≠ haber ${t.haber.toFixed(2)} (diferencia ${t.descuadre.toFixed(2)})`;
  }
  return null;
}

/**
 * Saldo de una cuenta en su sentido natural: deudor para activo y gasto,
 * acreedor para pasivo, patrimonio e ingreso.
 */
export function saldoNatural(
  tipo: TipoCuenta,
  debe: number | string,
  haber: number | string,
): number {
  const diff = toCents(debe) - toCents(haber);
  return fromCents(tipo === 'activo' || tipo === 'gasto' ? diff : -diff);
}

/* ─────────────────────────── interfaz contable ─────────────────────────── */

/** Línea propuesta por la interfaz contable (importes en `numeric` de Postgres). */
export interface LineaPropuesta {
  cuenta: string;
  debe: string;
  haber: string;
  projectId: string | null;
  concepto: string;
}

/**
 * Añade una línea con importe con signo: positivo en el lado indicado,
 * negativo en el opuesto (rectificativas). Importe 0 → no se añade.
 */
function apunte(
  out: LineaPropuesta[],
  lado: 'debe' | 'haber',
  cuenta: string,
  cents: bigint,
  concepto: string,
  projectId: string | null = null,
): void {
  if (cents === 0n) return;
  const efectivo = cents > 0n ? lado : lado === 'debe' ? 'haber' : 'debe';
  const abs = centsToNumeric(cents < 0n ? -cents : cents);
  out.push({
    cuenta,
    debe: efectivo === 'debe' ? abs : '0.00',
    haber: efectivo === 'haber' ? abs : '0.00',
    projectId,
    concepto,
  });
}

export interface FacturaContable {
  kind: 'venta' | 'compra';
  invoiceNumber: string;
  contactName: string;
  baseAmount: string;
  vatAmount: string;
  totalAmount: string;
  retentionAmount: string;
  /** Factura de compra que nace de una certificación de subcontrata. */
  esSubcontrata: boolean;
  lineas: { baseAmount: string; projectId: string | null }[];
}

/**
 * Asiento de una factura aprobada (PGC):
 *  - Venta:  4300 (total − retención) + 4301 (retención)  a  7050 (base por obra) + 4770 (IVA)
 *  - Compra: 6000|6070 (base por obra) + 4720 (IVA)  a  4000 (total − retención) + 4001 (retención)
 * La base se reparte por obra según las líneas (imputación analítica); si
 * la suma de las líneas no coincide con la base de cabecera, la diferencia
 * va sin obra para que el asiento cuadre siempre. Importes negativos
 * (rectificativas) invierten el lado del apunte.
 */
export function asientoDesdeFactura(f: FacturaContable): LineaPropuesta[] {
  const C = CUENTAS_INTERFAZ;
  const total = toCents(f.totalAmount);
  const ret = toCents(f.retentionAmount);
  const iva = toCents(f.vatAmount);
  const base = toCents(f.baseAmount);
  const concepto = `${f.kind === 'venta' ? 'Fra. emitida' : 'Fra. recibida'} ${f.invoiceNumber} · ${f.contactName}`;

  // Base por obra, en orden estable de primera aparición.
  const porObra = new Map<string | null, bigint>();
  for (const l of f.lineas) {
    porObra.set(
      l.projectId,
      (porObra.get(l.projectId) ?? 0n) + toCents(l.baseAmount),
    );
  }
  const sumaLineas = sumCents([...porObra.values()]);
  if (sumaLineas !== base) {
    porObra.set(null, (porObra.get(null) ?? 0n) + (base - sumaLineas));
  }

  const out: LineaPropuesta[] = [];
  if (f.kind === 'venta') {
    apunte(out, 'debe', C.clientes, total - ret, concepto);
    apunte(out, 'debe', C.clientesRetencion, ret, `${concepto} (retención)`);
    for (const [projectId, cents] of porObra) {
      apunte(out, 'haber', C.ventasObra, cents, concepto, projectId);
    }
    apunte(out, 'haber', C.ivaRepercutido, iva, `${concepto} (IVA)`);
  } else {
    const gasto = f.esSubcontrata
      ? C.trabajosSubcontratas
      : C.comprasMateriales;
    for (const [projectId, cents] of porObra) {
      apunte(out, 'debe', gasto, cents, concepto, projectId);
    }
    apunte(out, 'debe', C.ivaSoportado, iva, `${concepto} (IVA)`);
    apunte(out, 'haber', C.proveedores, total - ret, concepto);
    apunte(
      out,
      'haber',
      C.proveedoresRetencion,
      ret,
      `${concepto} (retención)`,
    );
  }
  // Base + IVA ≠ total (datos legados): la diferencia ajusta la cuenta de tercero.
  const descuadre = toCents(totalesAsiento(out).descuadre);
  if (descuadre !== 0n) {
    const tercero = f.kind === 'venta' ? C.clientes : C.proveedores;
    apunte(
      out,
      f.kind === 'venta' ? 'debe' : 'haber',
      tercero,
      f.kind === 'venta' ? -descuadre : descuadre,
      `${concepto} (ajuste de redondeo)`,
    );
  }
  return out;
}

export interface VencimientoContable {
  direction: 'cobro' | 'pago';
  kind: 'ordinario' | 'retencion';
  amount: string;
  invoiceNumber: string;
  contactName: string;
}

/** Asiento de un cobro (5720 a 4300|4301) o de un pago (4000|4001 a 5720). */
export function asientoDesdeVencimiento(
  v: VencimientoContable,
): LineaPropuesta[] {
  const C = CUENTAS_INTERFAZ;
  const cents = toCents(v.amount);
  const retencion = v.kind === 'retencion';
  const concepto = `${v.direction === 'cobro' ? 'Cobro' : 'Pago'} fra. ${v.invoiceNumber} · ${v.contactName}${retencion ? ' (retención)' : ''}`;
  const out: LineaPropuesta[] = [];
  if (v.direction === 'cobro') {
    apunte(out, 'debe', C.bancos, cents, concepto);
    apunte(
      out,
      'haber',
      retencion ? C.clientesRetencion : C.clientes,
      cents,
      concepto,
    );
  } else {
    apunte(
      out,
      'debe',
      retencion ? C.proveedoresRetencion : C.proveedores,
      cents,
      concepto,
    );
    apunte(out, 'haber', C.bancos, cents, concepto);
  }
  return out;
}

/** Contra-asiento: mismas líneas con debe y haber intercambiados. */
export function lineasContraAsiento<T extends { debe: string; haber: string }>(
  lineas: readonly T[],
): T[] {
  return lineas.map((l) => ({ ...l, debe: l.haber, haber: l.debe }));
}

/** Ejercicio y mes (1-12) de una fecha ISO. */
export function periodoDeFecha(fecha: string): {
  ejercicio: number;
  mes: number;
} {
  const [y, m] = fecha.split('-');
  return { ejercicio: Number(y), mes: Number(m) };
}

/* ──────────────────────────────── DTOs ──────────────────────────────── */

export interface CuentaContableDto {
  id: string;
  codigo: string;
  nombre: string;
  tipo: TipoCuenta;
  imputable: boolean;
  activa: boolean;
  version: number;
}

export interface LineaAsientoDto {
  id: string;
  cuenta: string;
  nombreCuenta: string;
  debe: number;
  haber: number;
  projectId: string | null;
  concepto: string | null;
}

export interface AsientoDto {
  id: string;
  numero: number;
  ejercicio: number;
  fecha: string;
  concepto: string;
  origen: OrigenAsiento;
  origenId: string | null;
  estado: EstadoAsiento;
  anuladoPorId: string | null;
  anulaAId: string | null;
  totalDebe: number;
  totalHaber: number;
  version: number;
  createdAt: string;
  lineas: LineaAsientoDto[];
}

export interface MovimientoMayorDto {
  asientoId: string;
  numero: number;
  fecha: string;
  concepto: string;
  debe: number;
  haber: number;
  /** Saldo acumulado en el sentido natural de la cuenta. */
  saldo: number;
  projectId: string | null;
}

export interface LibroMayorDto {
  cuenta: CuentaContableDto;
  desde: string | null;
  hasta: string | null;
  saldoInicial: number;
  totalDebe: number;
  totalHaber: number;
  saldoFinal: number;
  movimientos: MovimientoMayorDto[];
  /** true si hay más movimientos que el límite devuelto. */
  truncado: boolean;
}

export interface FilaSumasSaldosDto {
  codigo: string;
  nombre: string;
  tipo: TipoCuenta;
  debe: number;
  haber: number;
  saldoDeudor: number;
  saldoAcreedor: number;
}

export interface SumasSaldosDto {
  desde: string | null;
  hasta: string | null;
  projectId: string | null;
  filas: FilaSumasSaldosDto[];
  totalDebe: number;
  totalHaber: number;
  totalSaldoDeudor: number;
  totalSaldoAcreedor: number;
  /** Comprobación: Σ debe = Σ haber. */
  cuadra: boolean;
}

export interface PeriodoContableDto {
  ejercicio: number;
  mes: number;
  estado: EstadoPeriodo;
  asientos: number;
  cerradoEn: string | null;
}

export interface ResultadoInterfazDto {
  contabilizados: number;
  anulados: number;
  /** Documentos que no se pudieron contabilizar (p. ej. período cerrado). */
  omitidos: { origen: OrigenAsiento; origenId: string; motivo: string }[];
}

/**
 * Filas de sumas y saldos a partir de los totales por cuenta. El saldo se
 * presenta en la columna deudora o acreedora según su signo.
 */
export function filasSumasSaldos(
  cuentas: readonly {
    codigo: string;
    nombre: string;
    tipo: TipoCuenta;
    debe: string | number;
    haber: string | number;
  }[],
): Omit<SumasSaldosDto, 'desde' | 'hasta' | 'projectId'> {
  const filas: FilaSumasSaldosDto[] = cuentas.map((c) => {
    const diff = toCents(c.debe) - toCents(c.haber);
    return {
      codigo: c.codigo,
      nombre: c.nombre,
      tipo: c.tipo,
      debe: fromCents(toCents(c.debe)),
      haber: fromCents(toCents(c.haber)),
      saldoDeudor: diff > 0n ? fromCents(diff) : 0,
      saldoAcreedor: diff < 0n ? fromCents(-diff) : 0,
    };
  });
  const s = (sel: (f: FilaSumasSaldosDto) => number) =>
    fromCents(sumCents(filas.map((f) => toCents(sel(f)))));
  const totalDebe = s((f) => f.debe);
  const totalHaber = s((f) => f.haber);
  return {
    filas,
    totalDebe,
    totalHaber,
    totalSaldoDeudor: s((f) => f.saldoDeudor),
    totalSaldoAcreedor: s((f) => f.saldoAcreedor),
    cuadra: totalDebe === totalHaber,
  };
}
