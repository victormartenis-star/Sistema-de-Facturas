/**
 * Control analítico / Management Accounting (SAP S/4HANA CO-OM, Oracle Cost
 * Management y Essbase): centros de coste, ciclos de reparto (distribución e
 * imputación) y rolling forecast por escenarios. Reglas puras en
 * `calculo.ts` (`repartoCiclo`, `previsionObra`, `totalesPrevision`,
 * `varianzaPrevision`, `centroPorCuenta`).
 */

import { z } from 'zod';
import type {
  AlertaPrevision,
  LineaRepartoCalculo,
  PrevisionObraCalculo,
  TipoCicloReparto,
  TotalesPrevision,
} from './calculo';

export type { TipoCicloReparto } from './calculo';

export const TIPOS_CENTRO_COSTE = [
  'estructura',
  'general',
  'apoyo',
  'receptor',
] as const;
export type TipoCentroCoste = (typeof TIPOS_CENTRO_COSTE)[number];
export const TIPO_CENTRO_COSTE_LABELS: Record<TipoCentroCoste, string> = {
  estructura: 'Estructura central / administración',
  general: 'Departamento general',
  apoyo: 'Apoyo (parque, taller, almacén)',
  receptor: 'Centro receptor',
};

export const TIPOS_CICLO_REPARTO = [
  'distribucion',
  'imputacion',
] as const satisfies readonly TipoCicloReparto[];
export const TIPO_CICLO_LABELS: Record<TipoCicloReparto, string> = {
  distribucion: 'Distribución (conserva la cuenta de gasto)',
  imputacion: 'Imputación (cuenta secundaria)',
};

export const CRITERIOS_REPARTO = [
  'porcentaje',
  'presupuesto',
  'produccion',
  'horas',
] as const;
export type CriterioReparto = (typeof CRITERIOS_REPARTO)[number];
export const CRITERIO_REPARTO_LABELS: Record<CriterioReparto, string> = {
  porcentaje: 'Porcentaje fijo',
  presupuesto: 'Presupuesto de coste de la obra',
  produccion: 'Producción certificada en el periodo',
  horas: 'Horas de partes de personal en el periodo',
};

export const TIPOS_ESCENARIO = [
  'base',
  'optimista',
  'pesimista',
  'personalizado',
] as const;
export type TipoEscenario = (typeof TIPOS_ESCENARIO)[number];
export const TIPO_ESCENARIO_LABELS: Record<TipoEscenario, string> = {
  base: 'Base',
  optimista: 'Optimista',
  pesimista: 'Tensionado / pesimista',
  personalizado: 'Personalizado',
};

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: AAAA-MM-DD');

const codigo = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[A-Z0-9][A-Z0-9._-]{0,19}$/,
    'Código de 1 a 20 caracteres (letras, dígitos, . _ -)',
  );

const prefijoGasto = z
  .string()
  .trim()
  .regex(/^6\d{0,9}$/, 'Prefijo de cuenta de gasto (grupo 6)');

const decimales = (n: number, max: number) =>
  Math.abs(Math.round(n * 10 ** max) - n * 10 ** max) < 1e-6;

const pctAjuste = z
  .number()
  .finite()
  .min(-100)
  .max(1000)
  .refine((n) => decimales(n, 2), 'Como máximo dos decimales');

/* ─────────────────────────── centros de coste ─────────────────────────── */

export const centroCosteCreateSchema = z.object({
  codigo,
  nombre: z.string().trim().min(1).max(160),
  tipo: z.enum(TIPOS_CENTRO_COSTE).default('general'),
  padreId: z.string().uuid().nullish(),
  responsableId: z.string().uuid().nullish(),
  notas: z.string().trim().max(500).nullish(),
  /** Prefijos de cuentas de gasto cuyo coste sin obra va a este centro. */
  cuentas: z.array(prefijoGasto).max(50).default([]),
});
export type CentroCosteCreateInput = z.input<typeof centroCosteCreateSchema>;

export const centroCosteUpdateSchema = z
  .object({
    nombre: z.string().trim().min(1).max(160).optional(),
    tipo: z.enum(TIPOS_CENTRO_COSTE).optional(),
    padreId: z.string().uuid().nullish(),
    responsableId: z.string().uuid().nullish(),
    notas: z.string().trim().max(500).nullish(),
    activo: z.boolean().optional(),
    /** Si viene, sustituye la lista completa. */
    cuentas: z.array(prefijoGasto).max(50).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Indica al menos un campo a modificar',
  });
export type CentroCosteUpdateInput = z.input<typeof centroCosteUpdateSchema>;

/* ─────────────────────────── ciclos de reparto ─────────────────────────── */

const receptor = z
  .object({
    projectId: z.string().uuid().nullish(),
    costCenterId: z.string().uuid().nullish(),
    /** Solo con criterio porcentaje: peso fijo, 4 decimales. */
    pesoPct: z
      .number()
      .finite()
      .positive()
      .max(100)
      .refine((n) => decimales(n, 4), 'Como máximo cuatro decimales')
      .nullish(),
  })
  .refine((r) => Boolean(r.projectId) !== Boolean(r.costCenterId), {
    message: 'Cada receptor es una obra o un centro de coste',
  });

const camposCiclo = {
  nombre: z.string().trim().min(1).max(160),
  tipo: z.enum(TIPOS_CICLO_REPARTO),
  criterio: z.enum(CRITERIOS_REPARTO),
  cuentaImputacion: z
    .string()
    .trim()
    .regex(/^6\d{2,9}$/, 'Cuenta secundaria del grupo 6')
    .nullish(),
  emisores: z.array(z.string().uuid()).min(1).max(50),
  receptores: z.array(receptor).min(1).max(500),
};

/** Reglas de coherencia del ciclo (se repiten en el servicio con la base). */
function validarCiclo(
  c: {
    tipo?: TipoCicloReparto;
    criterio?: CriterioReparto;
    cuentaImputacion?: string | null;
    emisores?: string[];
    receptores?: {
      projectId?: string | null;
      costCenterId?: string | null;
      pesoPct?: number | null;
    }[];
  },
  ctx: z.RefinementCtx,
) {
  if (c.tipo === 'imputacion' && !c.cuentaImputacion) {
    ctx.addIssue({
      code: 'custom',
      path: ['cuentaImputacion'],
      message: 'La imputación exige una cuenta secundaria',
    });
  }
  if (c.tipo === 'distribucion' && c.cuentaImputacion) {
    ctx.addIssue({
      code: 'custom',
      path: ['cuentaImputacion'],
      message: 'La distribución conserva las cuentas: sin cuenta secundaria',
    });
  }
  if (!c.receptores || !c.criterio) return;
  const ids = c.receptores.map((r) => r.projectId ?? r.costCenterId ?? '');
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['receptores'],
      message: 'Receptor repetido',
    });
  }
  if (
    c.emisores?.some((e) => c.receptores!.some((r) => r.costCenterId === e))
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['receptores'],
      message: 'Un centro emisor no puede ser receptor del mismo ciclo',
    });
  }
  if (c.criterio === 'porcentaje') {
    if (c.receptores.some((r) => !r.pesoPct)) {
      ctx.addIssue({
        code: 'custom',
        path: ['receptores'],
        message: 'Con criterio porcentaje cada receptor lleva su peso',
      });
      return;
    }
    const suma = c.receptores.reduce(
      (s, r) => s + Math.round((r.pesoPct ?? 0) * 10_000),
      0,
    );
    if (suma !== 1_000_000) {
      ctx.addIssue({
        code: 'custom',
        path: ['receptores'],
        message: 'Los porcentajes deben sumar exactamente 100',
      });
    }
  } else {
    if (c.receptores.some((r) => r.costCenterId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['receptores'],
        message:
          'Los criterios de presupuesto, producción y horas solo reparten a obras',
      });
    }
    if (c.receptores.some((r) => r.pesoPct)) {
      ctx.addIssue({
        code: 'custom',
        path: ['receptores'],
        message: 'El peso fijo solo se usa con criterio porcentaje',
      });
    }
  }
}

export const cicloRepartoCreateSchema = z
  .object({ codigo, ...camposCiclo })
  .superRefine(validarCiclo);
export type CicloRepartoCreateInput = z.input<typeof cicloRepartoCreateSchema>;

export const cicloRepartoUpdateSchema = z
  .object({
    nombre: camposCiclo.nombre.optional(),
    activo: z.boolean().optional(),
    tipo: camposCiclo.tipo.optional(),
    criterio: camposCiclo.criterio.optional(),
    cuentaImputacion: camposCiclo.cuentaImputacion,
    emisores: camposCiclo.emisores.optional(),
    receptores: camposCiclo.receptores.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Indica al menos un campo a modificar',
  });
export type CicloRepartoUpdateInput = z.input<typeof cicloRepartoUpdateSchema>;

/** Valida el ciclo resultante de aplicar una edición (lo usa el servicio). */
export const cicloRepartoCompletoSchema = z
  .object({ ...camposCiclo })
  .superRefine(validarCiclo);

export const periodoRepartoSchema = z
  .object({ desde: fecha, hasta: fecha })
  .refine((p) => p.desde <= p.hasta, {
    path: ['hasta'],
    message: '`hasta` no puede ser anterior a `desde`',
  });
export type PeriodoReparto = z.infer<typeof periodoRepartoSchema>;

export const revertirRepartoSchema = z.object({
  motivo: z.string().trim().min(3).max(240),
});
export type RevertirRepartoInput = z.input<typeof revertirRepartoSchema>;

/* ─────────────────────────── rolling forecast ─────────────────────────── */

export const escenarioCreateSchema = z.object({
  codigo,
  nombre: z.string().trim().min(1).max(160),
  tipo: z.enum(TIPOS_ESCENARIO).default('personalizado'),
  ajusteCostePct: pctAjuste.default(0),
  ajusteIngresoPct: pctAjuste.default(0),
  retrasoMeses: z.number().int().min(0).max(60).default(0),
  incluirIndirectos: z.boolean().default(true),
});
export type EscenarioCreateInput = z.input<typeof escenarioCreateSchema>;

export const escenarioUpdateSchema = z
  .object({
    nombre: z.string().trim().min(1).max(160).optional(),
    tipo: z.enum(TIPOS_ESCENARIO).optional(),
    ajusteCostePct: pctAjuste.optional(),
    ajusteIngresoPct: pctAjuste.optional(),
    retrasoMeses: z.number().int().min(0).max(60).optional(),
    incluirIndirectos: z.boolean().optional(),
    activo: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Indica al menos un campo a modificar',
  });
export type EscenarioUpdateInput = z.input<typeof escenarioUpdateSchema>;

export const previsionQuerySchema = z.object({
  escenarioId: z.string().uuid(),
  fecha,
  projectId: z.string().uuid().optional(),
  horizonte: z.coerce.number().int().min(1).max(36).default(12),
  /** Foto contra la que medir la varianza; por defecto, la última del escenario. */
  baselineId: z.string().uuid().optional(),
});
export type PrevisionQuery = z.infer<typeof previsionQuerySchema>;

export const fotoPrevisionCreateSchema = z.object({
  escenarioId: z.string().uuid(),
  fecha,
  etiqueta: z.string().trim().min(1).max(120),
});
export type FotoPrevisionCreateInput = z.input<
  typeof fotoPrevisionCreateSchema
>;

/* ────────────────────────────── DTOs ────────────────────────────── */

export interface CentroCosteDto {
  id: string;
  codigo: string;
  nombre: string;
  tipo: TipoCentroCoste;
  padreId: string | null;
  responsableId: string | null;
  responsableNombre: string | null;
  activo: boolean;
  notas: string | null;
  cuentas: string[];
  version: number;
}

export interface SaldoCentroDto {
  centroId: string;
  codigo: string;
  nombre: string;
  /** Coste primario del mayor (apuntes con el centro o por cuenta asignada). */
  primario: number;
  /** Recibido de otros centros por repartos vigentes. */
  recibido: number;
  /** Repartido a obras y centros por repartos vigentes. */
  repartido: number;
  /** Pendiente de repartir: primario + recibido − repartido. */
  saldo: number;
  porCuenta: {
    cuenta: string;
    primario: number;
    recibido: number;
    repartido: number;
    saldo: number;
  }[];
}

export interface ReceptorCicloDto {
  tipo: 'obra' | 'centro';
  id: string;
  codigo: string;
  nombre: string;
  pesoPct: number | null;
}

export interface CicloRepartoDto {
  id: string;
  codigo: string;
  nombre: string;
  tipo: TipoCicloReparto;
  criterio: CriterioReparto;
  cuentaImputacion: string | null;
  activo: boolean;
  emisores: { centroId: string; codigo: string; nombre: string }[];
  receptores: ReceptorCicloDto[];
  version: number;
}

export interface LineaRepartoDto extends LineaRepartoCalculo {
  emisorCodigo: string;
  receptorTipo: 'obra' | 'centro';
  receptorId: string;
  receptorCodigo: string;
  receptorNombre: string;
}

export interface SimulacionRepartoDto {
  cicloId: string;
  codigo: string;
  desde: string;
  hasta: string;
  criterio: CriterioReparto;
  totalRepartido: number;
  /** Peso de cada receptor según el criterio (antes de normalizar). */
  bases: { clave: string; peso: number; pct: number }[];
  porEmisor: { centroId: string; importe: number }[];
  porReceptor: { clave: string; importe: number }[];
  lineas: LineaRepartoDto[];
}

export interface EjecucionRepartoDto {
  id: string;
  cicloId: string;
  cicloCodigo: string;
  seq: number;
  desde: string;
  hasta: string;
  estado: 'contabilizado' | 'revertido';
  total: number;
  motivoReversion: string | null;
  revertidoEn: string | null;
  creadoEn: string;
  version: number;
  lineas?: LineaRepartoDto[];
}

export interface EscenarioDto {
  id: string;
  codigo: string;
  nombre: string;
  tipo: TipoEscenario;
  ajusteCostePct: number;
  ajusteIngresoPct: number;
  retrasoMeses: number;
  incluirIndirectos: boolean;
  activo: boolean;
  version: number;
}

export interface PrevisionObraDto extends PrevisionObraCalculo {
  projectId: string;
  codigo: string;
  nombre: string;
  contrato: number | null;
  finPrevista: string | null;
  /** Frente a la línea base (null si la obra no estaba en la foto). */
  varianza: { eac: number; ingresosPrevistos: number; margen: number } | null;
}

export interface PrevisionDto {
  escenario: EscenarioDto;
  fecha: string;
  horizonte: number;
  generadoEn: string;
  obras: PrevisionObraDto[];
  totales: TotalesPrevision;
  /** Serie mensual agregada de todas las obras. */
  serie: { mes: string; coste: number; ingreso: number }[];
  alertas: { projectId: string; alerta: AlertaPrevision }[];
  baseline: {
    id: string;
    fecha: string;
    etiqueta: string;
    totales: TotalesPrevision;
  } | null;
  varianza: { eac: number; ingresosPrevistos: number; margen: number } | null;
}

export interface FotoPrevisionDto {
  id: string;
  escenarioId: string;
  fecha: string;
  etiqueta: string;
  totales: TotalesPrevision;
  creadaEn: string;
}

/** Coste completo de una obra: directo (cuadro de márgenes) + indirectos. */
export interface CosteCompletoObraDto {
  projectId: string;
  codigo: string;
  nombre: string;
  costeDirecto: number;
  indirectos: number;
  costeCompleto: number;
  porCentro: { centroId: string; codigo: string; importe: number }[];
}
