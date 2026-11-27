/**
 * Consolidación de grupo / holding (SAP Group Reporting, Oracle FCC).
 *
 * - Permiso de consolidación: el admin de una sociedad concede a un usuario
 *   de otra sociedad acceso de lectura financiera a la suya. Sin permiso
 *   vigente, la sociedad no puede consolidarse (`HOLDING_COMPANY_ACCESS_DENIED`).
 * - Grupo: lo crea la matriz (la sociedad del usuario); sus miembros llevan %
 *   de participación, método (global / proporcional) y fechas de alta y baja.
 * - Estados consolidados en vivo desde el mayor de cada sociedad, con
 *   eliminaciones intragrupo automáticas (por NIF de los contactos) y ajustes
 *   manuales; cierres que congelan un periodo.
 * Reglas puras en `calculo.ts` (`consolidarEstados`, `eliminacionesIntragrupo`,
 * `posicionTesoreriaGrupo`).
 */

import { z } from 'zod';
import type { Transiciones } from './maquina-estados';
import { userCreateSchema } from './auth';
import type {
  ConciliacionIntragrupo,
  ConversionMasa,
  EstadosConsolidadosCalculo,
  InversionPatrimonioCalculo,
  MetodoConsolidacion,
  TipoCambioConsolidacion,
} from './calculo';

export type { MetodoConsolidacion, TipoCambioConsolidacion } from './calculo';

export const ESTADOS_AJUSTE_CONSOLIDACION = ['vigente', 'anulado'] as const;
export type EstadoAjusteConsolidacion =
  (typeof ESTADOS_AJUSTE_CONSOLIDACION)[number];

/** Un ajuste anulado no revive: se crea otro. */
export const AJUSTE_CONSOLIDACION_TRANSITIONS: Transiciones<EstadoAjusteConsolidacion> =
  { vigente: ['anulado'], anulado: [] };

export const METODOS_CONSOLIDACION = [
  'global',
  'proporcional',
  'puesta_equivalencia',
] as const satisfies readonly MetodoConsolidacion[];

export const METODO_CONSOLIDACION_LABELS: Record<MetodoConsolidacion, string> =
  {
    global: 'Integración global',
    proporcional: 'Integración proporcional',
    puesta_equivalencia: 'Puesta en equivalencia',
  };

export const TIPOS_CAMBIO_CONSOLIDACION = [
  'cierre',
  'medio',
  'historico',
] as const satisfies readonly TipoCambioConsolidacion[];

export const TIPO_CAMBIO_LABELS: Record<TipoCambioConsolidacion, string> = {
  cierre: 'Cierre (activo y pasivo)',
  medio: 'Medio del periodo (PyG)',
  historico: 'Histórico (patrimonio neto)',
};

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: AAAA-MM-DD');

const porcentaje = z
  .number()
  .finite()
  .min(0.01, 'La participación mínima es 0,01 %')
  .max(100)
  .refine(
    (n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6,
    'Como máximo dos decimales',
  );

const cuentaConsolidacion = z
  .string()
  .regex(/^[1-7]\d{2,9}$/, 'Cuenta PGC de los grupos 1 a 7');

export const permisoConsolidacionSchema = z.object({
  /** Usuario de otra sociedad al que se concede acceso a la propia. */
  email: z.string().trim().email(),
});
export type PermisoConsolidacionInput = z.input<
  typeof permisoConsolidacionSchema
>;

export const grupoCreateSchema = z.object({
  nombre: z.string().trim().min(1).max(120),
  monedaBase: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('EUR'),
});
export type GrupoCreateInput = z.input<typeof grupoCreateSchema>;

export const grupoUpdateSchema = z.object({
  nombre: z.string().trim().min(1).max(120),
});
export type GrupoUpdateInput = z.input<typeof grupoUpdateSchema>;

const importe2 = (min: number) =>
  z
    .number()
    .finite()
    .min(min)
    .max(999_999_999_999.99)
    .refine(
      (n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6,
      'Como máximo dos decimales',
    );

const moneda = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Código ISO 4217 de tres letras (EUR, USD…)');

const cuentaInversion = z
  .string()
  .regex(/^2\d{3,9}$/, 'Cuenta PGC del grupo 2 (p. ej. 2403)');

/**
 * Parámetros de la eliminación inversión–patrimonio neto. Sin
 * `costeInversion` no se elimina (retrocompatible); la puesta en
 * equivalencia lo exige (`CONSOLIDATION_INVESTMENT_REQUIRED`).
 */
const inversionCampos = {
  /** Toma de control / primera consolidación; por defecto, la fecha de alta. */
  fechaAdquisicion: fecha.nullish(),
  /** Coste de la participación en la dominante (moneda de presentación). */
  costeInversion: importe2(0).nullish(),
  /** Cuenta de la dominante con la participación; por defecto 2403. */
  cuentaInversion: cuentaInversion.nullish(),
  /**
   * PN (100 %) de la dependiente a la toma de control, en su moneda
   * funcional. Si se omite, se toma de su mayor a esa fecha.
   */
  patrimonioAdquisicion: importe2(-999_999_999_999.99).nullish(),
};

export const miembroCreateSchema = z.object({
  companyId: z.string().uuid(),
  participacionPct: porcentaje,
  metodo: z.enum(METODOS_CONSOLIDACION).default('global'),
  fechaAlta: fecha,
  ...inversionCampos,
});
export type MiembroCreateInput = z.input<typeof miembroCreateSchema>;

export const miembroUpdateSchema = z
  .object({
    participacionPct: porcentaje.optional(),
    metodo: z.enum(METODOS_CONSOLIDACION).optional(),
    fechaBaja: fecha.nullish(),
    ...inversionCampos,
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Indica al menos un campo a modificar',
  });
export type MiembroUpdateInput = z.input<typeof miembroUpdateSchema>;

/* ─────────────────────── alta de sociedades del grupo ─────────────────────── */

/** NIF/CIF español o identificador fiscal extranjero (4–20 caracteres). */
const nifSociedad = z
  .string()
  .trim()
  .toUpperCase()
  .min(4, 'NIF demasiado corto')
  .max(20)
  .regex(/^[A-Z0-9][A-Z0-9 .-]*[A-Z0-9]$/, 'NIF no válido');

/**
 * Alta controlada de una sociedad del grupo (SAP: unidad de consolidación).
 * La sociedad nace con el PGC base, la moneda funcional indicada y permiso
 * de consolidación para quien la crea; opcionalmente con su primer admin y
 * vinculada ya a un grupo de la matriz.
 */
export const sociedadCreateSchema = z.object({
  nombre: z.string().trim().min(2).max(160),
  nif: nifSociedad,
  monedaFuncional: moneda.default('EUR'),
  /** Crea el plan contable base (PGC) de la nueva sociedad. */
  inicializarPlan: z.boolean().default(true),
  administrador: userCreateSchema
    .pick({ email: true, password: true, fullName: true })
    .optional(),
  grupo: z
    .object({
      grupoId: z.string().uuid(),
      participacionPct: porcentaje,
      metodo: z.enum(METODOS_CONSOLIDACION).default('global'),
      fechaAlta: fecha,
      ...inversionCampos,
    })
    .optional(),
});
export type SociedadCreateInput = z.input<typeof sociedadCreateSchema>;

export const sociedadUpdateSchema = z
  .object({
    nombre: z.string().trim().min(2).max(160).optional(),
    monedaFuncional: moneda.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Indica al menos un campo a modificar',
  });
export type SociedadUpdateInput = z.input<typeof sociedadUpdateSchema>;

/* ───────────────────────── tipos de cambio ───────────────────────── */

const tasa = z
  .number()
  .finite()
  .positive('El tipo de cambio debe ser positivo')
  .max(9_999_999_999)
  .refine(
    (n) => Math.abs(Math.round(n * 1e8) - n * 1e8) < 1e-3,
    'Como máximo ocho decimales',
  );

/**
 * Tipo de cambio de consolidación: unidades de la moneda de presentación
 * del grupo por 1 unidad de `moneda`. Cierre e histórico, a una fecha
 * (`desde`); el medio, para el periodo `desde`–`hasta`.
 */
export const tipoCambioCreateSchema = z
  .object({
    moneda,
    tipo: z.enum(TIPOS_CAMBIO_CONSOLIDACION),
    desde: fecha,
    hasta: fecha.optional(),
    tasa,
  })
  .superRefine((t, ctx) => {
    if (t.tipo !== 'medio' && t.hasta !== undefined && t.hasta !== t.desde) {
      ctx.addIssue({
        code: 'custom',
        path: ['hasta'],
        message: 'Los tipos de cierre e histórico valen para una sola fecha',
      });
    }
    if (t.tipo === 'medio' && (t.hasta === undefined || t.hasta < t.desde)) {
      ctx.addIssue({
        code: 'custom',
        path: ['hasta'],
        message: 'El tipo medio exige un periodo `desde`–`hasta` válido',
      });
    }
  });
export type TipoCambioCreateInput = z.input<typeof tipoCambioCreateSchema>;

export const tipoCambioUpdateSchema = z.object({ tasa });
export type TipoCambioUpdateInput = z.input<typeof tipoCambioUpdateSchema>;

export const periodoConsolidacionSchema = z
  .object({ desde: fecha, hasta: fecha })
  .refine((p) => p.desde <= p.hasta, {
    path: ['hasta'],
    message: '`hasta` no puede ser anterior a `desde`',
  });
export type PeriodoConsolidacion = z.infer<typeof periodoConsolidacionSchema>;

export const ajusteConsolidacionCreateSchema = z
  .object({
    fecha,
    concepto: z.string().trim().min(3).max(240),
    cuentaDebe: cuentaConsolidacion,
    cuentaHaber: cuentaConsolidacion,
    importe: z
      .number()
      .finite()
      .positive()
      .max(9_999_999_999.99)
      .refine(
        (n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6,
        'Como máximo dos decimales',
      ),
    /** Sociedad a la que se refiere (informativo). */
    companyId: z.string().uuid().nullish(),
  })
  .refine((a) => a.cuentaDebe !== a.cuentaHaber, {
    path: ['cuentaHaber'],
    message: 'Debe y haber deben ir a cuentas distintas',
  });
export type AjusteConsolidacionCreateInput = z.input<
  typeof ajusteConsolidacionCreateSchema
>;

export const anularAjusteSchema = z.object({
  motivo: z.string().trim().min(3).max(240),
});
export type AnularAjusteInput = z.input<typeof anularAjusteSchema>;

/* ────────────────────────────── DTOs ────────────────────────────── */

export interface SociedadAccesibleDto {
  companyId: string;
  nombre: string;
  nif: string;
  /** La sociedad del propio usuario. */
  propia: boolean;
  monedaFuncional: string;
}

/** Sociedad dada de alta (o editable) por la sociedad del usuario. */
export interface SociedadDto {
  id: string;
  nombre: string;
  nif: string;
  monedaFuncional: string;
  /** Sociedad que la dio de alta desde Group Reporting (null: alta original). */
  altaPorCompanyId: string | null;
  creadaEn: string;
  version: number;
  /** Solo en el alta: el administrador creado (sin contraseña). */
  administrador?: { userId: string; email: string } | null;
  /** Solo en el alta con `grupo`: el miembro creado. */
  miembroId?: string | null;
}

export interface TipoCambioDto {
  id: string;
  grupoId: string;
  moneda: string;
  tipo: TipoCambioConsolidacion;
  desde: string;
  hasta: string;
  tasa: number;
  version: number;
}

/** Conversión de una sociedad con moneda funcional distinta de la del grupo. */
export interface ConversionSociedadDto {
  companyId: string;
  nombre: string;
  monedaFuncional: string;
  tasas: { cierre: number; medio: number; historico: number };
  /** CTA del periodo (positivo = aumenta el PN), en moneda de presentación. */
  diferenciaConversion: number;
  porMasa: ConversionMasa[];
}

/** Detalle auditado de la eliminación inversión–PN de una sociedad. */
export interface InversionPatrimonioDto extends Omit<
  InversionPatrimonioCalculo,
  'ajustes'
> {
  nombre: string;
  cuentaInversion: string;
  fechaAdquisicion: string;
  /** El PN a la toma de control se tomó del mayor (no se informó a mano). */
  patrimonioDelMayor: boolean;
  ajustes: {
    concepto: string;
    lineas: { cuenta: string; debe: number; haber: number }[];
  }[];
}

export interface PermisoConsolidacionDto {
  id: string;
  userId: string;
  email: string;
  nombreUsuario: string;
  /** Sociedad del usuario autorizado. */
  sociedadUsuario: string;
  concedidoEn: string;
  revocadoEn: string | null;
}

export interface MiembroGrupoDto {
  id: string;
  companyId: string;
  nombre: string;
  nif: string;
  participacionPct: number;
  metodo: MetodoConsolidacion;
  fechaAlta: string;
  fechaBaja: string | null;
  /** El usuario tiene acceso a sus datos ahora mismo. */
  accesible: boolean;
  monedaFuncional: string;
  fechaAdquisicion: string | null;
  costeInversion: number | null;
  cuentaInversion: string | null;
  patrimonioAdquisicion: number | null;
  version: number;
}

export interface GrupoDto {
  id: string;
  nombre: string;
  monedaBase: string;
  matrizId: string;
  miembros: MiembroGrupoDto[];
  version: number;
}

export interface SociedadEnConsolidacionDto {
  companyId: string;
  nombre: string;
  metodo: MetodoConsolidacion;
  participacionPct: number;
  monedaFuncional?: string;
}

export interface AjusteConsolidacionDto {
  id: string;
  fecha: string;
  concepto: string;
  cuentaDebe: string;
  cuentaHaber: string;
  importe: number;
  companyId: string | null;
  estado: 'vigente' | 'anulado';
  motivoAnulacion: string | null;
  version: number;
}

export interface EstadosConsolidadosDto extends EstadosConsolidadosCalculo {
  grupoId: string;
  desde: string;
  hasta: string;
  generadoEn: string;
  sociedades: SociedadEnConsolidacionDto[];
  conciliacionIntragrupo: ConciliacionIntragrupo[];
  /** Hay descuadres intercompañía (INTERCOMPANY_MISMATCH). */
  descuadreIntercompania: boolean;
  eliminacionesAutomaticas: number;
  ajustesManuales: AjusteConsolidacionDto[];
  /** Periodo congelado por un cierre: datos del snapshot. */
  cerrado: boolean;
  /*
   * Group Reporting (Fase 8). Opcionales: los snapshots de cierres
   * anteriores no los llevan.
   */
  monedaPresentacion?: string;
  /** Sociedades convertidas desde otra moneda funcional. */
  conversion?: ConversionSociedadDto[];
  /** CTA total del periodo (suma de `conversion`). */
  diferenciaConversion?: number;
  inversionPatrimonio?: InversionPatrimonioDto[];
  fondoComercio?: number;
  diferenciaNegativa?: number;
}

export interface TesoreriaGrupoDto {
  grupoId: string;
  hasta: string;
  porSociedad: {
    companyId: string;
    nombre: string;
    liquidez: number;
    cobrosPendientes: number;
    pagosPendientes: number;
    posicionNeta: number;
  }[];
  liquidez: number;
  cobrosPendientes: number;
  pagosPendientes: number;
  posicionNeta: number;
  intragrupoEliminado: { cobros: number; pagos: number };
  cartera: {
    companyId: string;
    nombre: string;
    obrasActivas: number;
    contratado: number;
    certificado: number;
    pendienteCertificar: number;
  }[];
}

export interface CierreConsolidacionDto {
  id: string;
  desde: string;
  hasta: string;
  resultado: number;
  cerradoEn: string;
  cerradoPor: string | null;
}
