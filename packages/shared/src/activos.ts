/**
 * Activos fijos (inmovilizado material) y su amortización.
 *
 * Modelo de SAP FI-AA / Oracle Assets adaptado al PGC: cada activo lleva su
 * cuenta de inmovilizado (21x), de amortización acumulada (281x) y de gasto
 * (6810). La amortización es lineal mensual desde el mes de puesta en
 * servicio (`cuadroAmortizacion` en `calculo.ts`) y se contabiliza por
 * cuotas idempotentes (una por activo y mes).
 */

import { z } from 'zod';
import type { Transiciones } from './maquina-estados';

export const CATEGORIAS_ACTIVO = [
  'maquinaria',
  'transporte',
  'utillaje',
  'instalaciones',
  'informatica',
  'otros',
] as const;
export type CategoriaActivo = (typeof CATEGORIAS_ACTIVO)[number];

export const CATEGORIA_ACTIVO_LABELS: Record<CategoriaActivo, string> = {
  maquinaria: 'Maquinaria',
  transporte: 'Elementos de transporte',
  utillaje: 'Utillaje',
  instalaciones: 'Instalaciones técnicas',
  informatica: 'Equipos informáticos',
  otros: 'Otro inmovilizado material',
};

/** Cuentas PGC por categoría: inmovilizado, amortización acumulada y gasto. */
export const CUENTAS_ACTIVO: Record<
  CategoriaActivo,
  { activo: string; acumulada: string; gasto: string }
> = {
  maquinaria: { activo: '2130', acumulada: '2813', gasto: '6810' },
  transporte: { activo: '2180', acumulada: '2818', gasto: '6810' },
  utillaje: { activo: '2140', acumulada: '2814', gasto: '6810' },
  instalaciones: { activo: '2120', acumulada: '2812', gasto: '6810' },
  informatica: { activo: '2170', acumulada: '2817', gasto: '6810' },
  otros: { activo: '2190', acumulada: '2819', gasto: '6810' },
};

/** Cuentas del resultado de la baja y del cobro de la venta. */
export const CUENTAS_BAJA = {
  perdida: '6710',
  beneficio: '7710',
  cobro: '5720',
} as const;

export const ESTADOS_ACTIVO = ['activo', 'baja'] as const;
export type EstadoActivo = (typeof ESTADOS_ACTIVO)[number];

/** Una baja es definitiva (terminal). */
export const ACTIVO_TRANSITIONS: Transiciones<EstadoActivo> = {
  activo: ['baja'],
  baja: [],
};

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: AAAA-MM-DD');

const importe = z
  .number()
  .finite()
  .min(0)
  .max(9_999_999_999.99)
  .refine(
    (n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6,
    'Como máximo dos decimales',
  );

export const activoCreateSchema = z
  .object({
    codigo: z.string().trim().min(1).max(30),
    nombre: z.string().trim().min(1).max(160),
    categoria: z.enum(CATEGORIAS_ACTIVO),
    equipoId: z.string().uuid().nullish(),
    projectId: z.string().uuid().nullish(),
    fechaAdquisicion: fecha,
    /** Mes de puesta en servicio: la amortización empieza ese mes. */
    fechaInicio: fecha,
    coste: importe.refine((n) => n > 0, 'El coste debe ser mayor que cero'),
    valorResidual: importe.default(0),
    vidaUtilMeses: z.number().int().min(1).max(600),
    notas: z.string().trim().max(1000).nullish(),
  })
  .refine((a) => a.valorResidual <= a.coste, {
    path: ['valorResidual'],
    message: 'El valor residual no puede superar el coste',
  })
  .refine((a) => a.fechaInicio >= a.fechaAdquisicion, {
    path: ['fechaInicio'],
    message: 'La puesta en servicio no puede ser anterior a la adquisición',
  });
export type ActivoCreateInput = z.input<typeof activoCreateSchema>;

/** Solo datos descriptivos: lo económico no cambia una vez amortizado. */
export const activoUpdateSchema = z
  .object({
    nombre: z.string().trim().min(1).max(160).optional(),
    projectId: z.string().uuid().nullish(),
    notas: z.string().trim().max(1000).nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Indica al menos un campo a modificar',
  });
export type ActivoUpdateInput = z.input<typeof activoUpdateSchema>;

export const amortizarSchema = z.object({
  /** Último mes a amortizar, `AAAA-MM`. */
  hasta: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Formato esperado: AAAA-MM'),
});
export type AmortizarInput = z.input<typeof amortizarSchema>;

export const activoBajaSchema = z.object({
  fecha,
  importeVenta: importe.default(0),
  motivo: z.string().trim().min(3).max(240),
});
export type ActivoBajaInput = z.input<typeof activoBajaSchema>;

export interface CuotaContabilizadaDto {
  ejercicio: number;
  mes: number;
  importe: number;
  asientoId: string | null;
}

export interface ActivoDto {
  id: string;
  codigo: string;
  nombre: string;
  categoria: CategoriaActivo;
  equipoId: string | null;
  projectId: string | null;
  fechaAdquisicion: string;
  fechaInicio: string;
  coste: number;
  valorResidual: number;
  vidaUtilMeses: number;
  estado: EstadoActivo;
  /** Amortización acumulada contabilizada. */
  amortizacionAcumulada: number;
  /** Valor neto contable = coste − acumulada. */
  valorNeto: number;
  /** Último mes amortizado (`AAAA-MM`) o null. */
  amortizadoHasta: string | null;
  fechaBaja: string | null;
  importeVenta: number | null;
  motivoBaja: string | null;
  notas: string | null;
  version: number;
}

export interface ActivoDetalleDto extends ActivoDto {
  /** Cuadro completo previsto, marcando lo ya contabilizado. */
  cuadro: (CuotaContabilizadaDto & {
    acumulada: number;
    valorNeto: number;
    contabilizada: boolean;
  })[];
}

export interface ResultadoAmortizacionDto {
  hasta: string;
  cuotas: number;
  importe: number;
  omitidos: { activoId: string; codigo: string; motivo: string }[];
}
