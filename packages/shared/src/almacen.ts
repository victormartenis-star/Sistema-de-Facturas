/**
 * Almacén y stock: almacenes (centrales y acopios de obra), catálogo de
 * artículos, existencias valoradas a precio medio ponderado (PMP) y
 * movimientos inmutables.
 *
 * Modelo SAP MM / Oracle Inventory adaptado al PGC con inventario permanente:
 *  - Entrada (recepción de albarán o manual):   3000  a  6100
 *  - Consumo / imputación a obra:               6100 (obra)  a  3000
 *  - Devolución de obra al almacén:             3000  a  6100 (obra)
 *  - Regularización faltante / sobrante:        6100 a 3000 / 3000 a 6100
 *  - Traspaso entre almacenes: sin asiento (misma cuenta de existencias).
 * La factura de compra sigue cargando 6000; el abono a 6100 de la entrada lo
 * neutraliza hasta que el material se consume, y el consumo lleva el coste a
 * la obra (analítica por `projectId` en la línea del asiento). Se usa el 61x
 * y no el 71x porque el 71x es para productos y obra en curso, no para
 * aprovisionamientos. La aritmética (PMP) vive en `calculo.ts`.
 */

import { z } from 'zod';
import { ESCALA_CANTIDAD_STOCK, ESCALA_PMP } from './calculo';
import { paginacionQuerySchema } from './paginacion';

export const TIPOS_ALMACEN = ['central', 'obra'] as const;
export type TipoAlmacen = (typeof TIPOS_ALMACEN)[number];
export const TIPO_ALMACEN_LABELS: Record<TipoAlmacen, string> = {
  central: 'Almacén central',
  obra: 'Acopio de obra',
};

export const UNIDADES_STOCK = [
  'ud',
  'm',
  'm2',
  'm3',
  'kg',
  't',
  'l',
  'saco',
  'palet',
  'rollo',
] as const;
export type UnidadStock = (typeof UNIDADES_STOCK)[number];

export const TIPOS_MOVIMIENTO_STOCK = [
  'entrada_compra',
  'salida_obra',
  'traspaso',
  'regularizacion',
  'devolucion',
] as const;
export type TipoMovimientoStock = (typeof TIPOS_MOVIMIENTO_STOCK)[number];
export const TIPO_MOVIMIENTO_STOCK_LABELS: Record<TipoMovimientoStock, string> =
  {
    entrada_compra: 'Entrada',
    salida_obra: 'Consumo a obra',
    traspaso: 'Traspaso',
    regularizacion: 'Regularización',
    devolucion: 'Devolución de obra',
  };

/** Cuentas por defecto de un artículo (se pueden cambiar por artículo). */
export const CUENTAS_STOCK = {
  existencias: '3000',
  variacion: '6100',
} as const;

/** Cuenta de existencias: grupo 3 (4+ dígitos, imputable). */
export const REGEX_CUENTA_EXISTENCIAS = /^3\d{3,7}$/;
/** Cuenta de variación de existencias: subgrupo 61. */
export const REGEX_CUENTA_VARIACION = /^61\d{2,6}$/;

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: AAAA-MM-DD');

function decimales(max: number) {
  const f = 10 ** max;
  return (n: number) => Math.abs(Math.round(n * f) - n * f) < 1e-6;
}

/** Cantidad > 0 con hasta 3 decimales. */
export const cantidadStockSchema = z
  .number()
  .finite()
  .positive('La cantidad debe ser mayor que cero')
  .max(99_999_999_999)
  .refine(
    decimales(ESCALA_CANTIDAD_STOCK),
    `Como máximo ${ESCALA_CANTIDAD_STOCK} decimales`,
  );

/** Coste unitario ≥ 0 con hasta 4 decimales. */
export const costeUnitarioSchema = z
  .number()
  .finite()
  .min(0)
  .max(9_999_999_999)
  .refine(decimales(ESCALA_PMP), `Como máximo ${ESCALA_PMP} decimales`);

const notas = z.string().trim().max(500).nullish();

/* ─────────────────────────── almacenes ─────────────────────────── */

export const almacenCreateSchema = z
  .object({
    codigo: z.string().trim().min(1).max(20),
    nombre: z.string().trim().min(1).max(120),
    tipo: z.enum(TIPOS_ALMACEN),
    /** Obligatoria en un acopio de obra; prohibida en un central. */
    projectId: z.string().uuid().nullish(),
    direccion: z.string().trim().max(240).nullish(),
  })
  .refine((a) => (a.tipo === 'obra') === Boolean(a.projectId), {
    path: ['projectId'],
    message: 'Un acopio de obra necesita obra; un almacén central no la lleva',
  });
export type AlmacenCreateInput = z.input<typeof almacenCreateSchema>;

export const almacenUpdateSchema = z
  .object({
    nombre: z.string().trim().min(1).max(120).optional(),
    direccion: z.string().trim().max(240).nullish(),
    activo: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Indica al menos un campo a modificar',
  });
export type AlmacenUpdateInput = z.input<typeof almacenUpdateSchema>;

/* ─────────────────────────── artículos ─────────────────────────── */

export const articuloCreateSchema = z.object({
  codigo: z.string().trim().min(1).max(30),
  nombre: z.string().trim().min(1).max(160),
  unidad: z.enum(UNIDADES_STOCK),
  cuentaExistencias: z
    .string()
    .regex(REGEX_CUENTA_EXISTENCIAS, 'Cuenta de existencias del grupo 3')
    .default(CUENTAS_STOCK.existencias),
  cuentaVariacion: z
    .string()
    .regex(REGEX_CUENTA_VARIACION, 'Cuenta de variación del subgrupo 61')
    .default(CUENTAS_STOCK.variacion),
  notas,
});
export type ArticuloCreateInput = z.input<typeof articuloCreateSchema>;

/** La unidad no cambia: invalidaría las cantidades ya registradas. */
export const articuloUpdateSchema = z
  .object({
    nombre: z.string().trim().min(1).max(160).optional(),
    cuentaExistencias: z.string().regex(REGEX_CUENTA_EXISTENCIAS).optional(),
    cuentaVariacion: z.string().regex(REGEX_CUENTA_VARIACION).optional(),
    activo: z.boolean().optional(),
    notas,
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Indica al menos un campo a modificar',
  });
export type ArticuloUpdateInput = z.input<typeof articuloUpdateSchema>;

/* ────────────────────────── existencias ────────────────────────── */

export const existenciaUpdateSchema = z.object({
  stockMinimo: z
    .number()
    .finite()
    .min(0)
    .max(99_999_999_999)
    .refine(decimales(ESCALA_CANTIDAD_STOCK), 'Como máximo 3 decimales'),
});
export type ExistenciaUpdateInput = z.input<typeof existenciaUpdateSchema>;

/* ────────────────────────── movimientos ────────────────────────── */

function sinArticulosRepetidos(lineas: { articuloId: string }[]): boolean {
  return new Set(lineas.map((l) => l.articuloId)).size === lineas.length;
}

const lineasUnicas = <T extends z.ZodTypeAny>(linea: T) =>
  z
    .array(linea)
    .min(1, 'Indica al menos una línea')
    .max(100)
    .refine(
      (ls) => sinArticulosRepetidos(ls as { articuloId: string }[]),
      'Un artículo no puede repetirse en el mismo movimiento',
    );

export const entradaStockSchema = z.object({
  almacenId: z.string().uuid(),
  fecha,
  /** Albarán de compra recepcionado (una sola entrada por albarán). */
  albaranId: z.string().uuid().nullish(),
  notas,
  lineas: lineasUnicas(
    z.object({
      articuloId: z.string().uuid(),
      cantidad: cantidadStockSchema,
      costeUnitario: costeUnitarioSchema,
    }),
  ),
});
export type EntradaStockInput = z.input<typeof entradaStockSchema>;

export const consumoObraSchema = z.object({
  almacenId: z.string().uuid(),
  projectId: z.string().uuid(),
  fecha,
  notas,
  lineas: lineasUnicas(
    z.object({
      articuloId: z.string().uuid(),
      cantidad: cantidadStockSchema,
    }),
  ),
});
export type ConsumoObraInput = z.input<typeof consumoObraSchema>;

/** Devolución de material sobrante de la obra al almacén (al PMP vigente). */
export const devolucionObraSchema = consumoObraSchema;
export type DevolucionObraInput = z.input<typeof devolucionObraSchema>;

/** Objeto base (sin el refine) para quien necesite `.shape`, p. ej. MCP. */
export const traspasoStockBaseSchema = z.object({
  origenId: z.string().uuid(),
  destinoId: z.string().uuid(),
  articuloId: z.string().uuid(),
  cantidad: cantidadStockSchema,
  fecha,
  notas,
});

export const traspasoStockSchema = traspasoStockBaseSchema.refine(
  (t) => t.origenId !== t.destinoId,
  {
    path: ['destinoId'],
    message: 'El almacén de destino debe ser distinto del de origen',
  },
);
export type TraspasoStockInput = z.input<typeof traspasoStockSchema>;

export const regularizacionStockSchema = z.object({
  almacenId: z.string().uuid(),
  articuloId: z.string().uuid(),
  fecha,
  /** Recuento físico: la diferencia con el teórico es el ajuste. */
  cantidadContada: z
    .number()
    .finite()
    .min(0)
    .max(99_999_999_999)
    .refine(decimales(ESCALA_CANTIDAD_STOCK), 'Como máximo 3 decimales'),
  /** Coste del sobrante; por defecto el PMP vigente o el último conocido. */
  costeUnitario: costeUnitarioSchema.nullish(),
  motivo: z.string().trim().min(3).max(240),
});
export type RegularizacionStockInput = z.input<
  typeof regularizacionStockSchema
>;

export const movimientosQuerySchema = paginacionQuerySchema.extend({
  almacenId: z.string().uuid().optional(),
  articuloId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  tipo: z.enum(TIPOS_MOVIMIENTO_STOCK).optional(),
  desde: fecha.optional(),
  hasta: fecha.optional(),
});
export type MovimientosQuery = z.infer<typeof movimientosQuerySchema>;

export const existenciasQuerySchema = z.object({
  almacenId: z.string().uuid().optional(),
  articuloId: z.string().uuid().optional(),
  q: z.string().trim().max(80).optional(),
  bajoMinimo: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  /** Incluye saldos a cero (por defecto se ocultan salvo con mínimo). */
  conCero: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ExistenciasQuery = z.infer<typeof existenciasQuerySchema>;

/* ────────────────────────────── DTOs ────────────────────────────── */

export interface AlmacenDto {
  id: string;
  codigo: string;
  nombre: string;
  tipo: TipoAlmacen;
  projectId: string | null;
  projectNombre: string | null;
  direccion: string | null;
  activo: boolean;
  /** Valoración de sus existencias al PMP. */
  valor: number;
  /** Existencias bajo mínimo. */
  alertas: number;
  version: number;
}

export interface ArticuloDto {
  id: string;
  codigo: string;
  nombre: string;
  unidad: UnidadStock;
  cuentaExistencias: string;
  cuentaVariacion: string;
  activo: boolean;
  notas: string | null;
  /** Totales en todos los almacenes. */
  cantidadTotal: number;
  valorTotal: number;
  version: number;
}

export interface ExistenciaDto {
  id: string;
  almacenId: string;
  almacenCodigo: string;
  almacenNombre: string;
  articuloId: string;
  articuloCodigo: string;
  articuloNombre: string;
  unidad: UnidadStock;
  cantidad: number;
  reservada: number;
  disponible: number;
  /** PMP vigente; con saldo cero, el último conocido. */
  pmp: number;
  valor: number;
  stockMinimo: number;
  bajoMinimo: boolean;
  version: number;
}

export interface MovimientoStockDto {
  id: string;
  tipo: TipoMovimientoStock;
  fecha: string;
  almacenId: string;
  almacenCodigo: string;
  /** Destino del traspaso. */
  almacenDestinoId: string | null;
  almacenDestinoCodigo: string | null;
  articuloId: string;
  articuloCodigo: string;
  articuloNombre: string;
  unidad: UnidadStock;
  /** Con signo respecto al almacén (origen en traspasos). */
  cantidad: number;
  costeUnitario: number;
  /** Con signo, como la cantidad. */
  valor: number;
  /** Saldo del almacén tras el movimiento. */
  cantidadResultante: number;
  pmpResultante: number;
  projectId: string | null;
  albaranId: string | null;
  asientoId: string | null;
  motivo: string | null;
  notas: string | null;
  usuarioId: string | null;
  creadoEn: string;
}

export interface ResumenAlmacenDto {
  valoracionTotal: number;
  almacenes: number;
  articulosConStock: number;
  alertas: number;
  porAlmacen: {
    almacenId: string;
    codigo: string;
    nombre: string;
    tipo: TipoAlmacen;
    valor: number;
    lineas: number;
    alertas: number;
  }[];
}

export interface ConsumoObraDto {
  projectId: string;
  /** Coste neto imputado (consumos − devoluciones). */
  total: number;
  porArticulo: {
    articuloId: string;
    codigo: string;
    nombre: string;
    unidad: UnidadStock;
    cantidad: number;
    valor: number;
  }[];
}
