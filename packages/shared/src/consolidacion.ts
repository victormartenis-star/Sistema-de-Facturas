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
import type {
  ConciliacionIntragrupo,
  EstadosConsolidadosCalculo,
  MetodoConsolidacion,
} from './calculo';

export type { MetodoConsolidacion } from './calculo';

export const ESTADOS_AJUSTE_CONSOLIDACION = ['vigente', 'anulado'] as const;
export type EstadoAjusteConsolidacion =
  (typeof ESTADOS_AJUSTE_CONSOLIDACION)[number];

/** Un ajuste anulado no revive: se crea otro. */
export const AJUSTE_CONSOLIDACION_TRANSITIONS: Transiciones<EstadoAjusteConsolidacion> =
  { vigente: ['anulado'], anulado: [] };

export const METODOS_CONSOLIDACION = [
  'global',
  'proporcional',
] as const satisfies readonly MetodoConsolidacion[];

export const METODO_CONSOLIDACION_LABELS: Record<MetodoConsolidacion, string> =
  {
    global: 'Integración global',
    proporcional: 'Integración proporcional',
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

export const miembroCreateSchema = z.object({
  companyId: z.string().uuid(),
  participacionPct: porcentaje,
  metodo: z.enum(METODOS_CONSOLIDACION).default('global'),
  fechaAlta: fecha,
});
export type MiembroCreateInput = z.input<typeof miembroCreateSchema>;

export const miembroUpdateSchema = z
  .object({
    participacionPct: porcentaje.optional(),
    metodo: z.enum(METODOS_CONSOLIDACION).optional(),
    fechaBaja: fecha.nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Indica al menos un campo a modificar',
  });
export type MiembroUpdateInput = z.input<typeof miembroUpdateSchema>;

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
