import { z } from 'zod';

/**
 * Maquinaria y equipos: maestro y mantenimientos (Fase 13).
 *
 * Cierra el hueco que dejó Fase 10: `partes_maquinaria` anotaba el nombre o
 * la matrícula de la máquina en texto libre porque no había ficha. Este
 * maestro permite dar de alta cada equipo una vez, enlazar los partes de
 * uso diario a su ficha y llevar el histórico de mantenimientos/ITV.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD');

/* ────────────────────── maestro de equipos ────────────────────── */

export const EQUIPO_TIPOS = [
  'vehiculo',
  'maquina_pesada',
  'herramienta',
  'otro',
] as const;
export type EquipoTipo = (typeof EQUIPO_TIPOS)[number];

export const EQUIPO_TIPO_LABELS: Record<EquipoTipo, string> = {
  vehiculo: 'Vehículo',
  maquina_pesada: 'Máquina pesada',
  herramienta: 'Herramienta',
  otro: 'Otro',
};

export const EQUIPO_OWNERSHIPS = ['propia', 'alquilada'] as const;
export type EquipoOwnership = (typeof EQUIPO_OWNERSHIPS)[number];

export const EQUIPO_ESTADOS = [
  'operativo',
  'en_mantenimiento',
  'averiado',
  'baja',
] as const;
export type EquipoEstado = (typeof EQUIPO_ESTADOS)[number];

export const EQUIPO_ESTADO_LABELS: Record<EquipoEstado, string> = {
  operativo: 'Operativo',
  en_mantenimiento: 'En mantenimiento',
  averiado: 'Averiado',
  baja: 'De baja',
};

export const equipoCreateSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, 'El nombre del equipo es obligatorio')
    .max(200, 'Máximo 200 caracteres'),
  matricula: z.string().trim().max(50, 'Máximo 50 caracteres').nullish(),
  tipo: z.enum(EQUIPO_TIPOS).default('maquina_pesada'),
  ownership: z.enum(EQUIPO_OWNERSHIPS).default('propia'),
  proveedorAlquilerId: z.string().uuid('Proveedor no válido').nullish(),
  estado: z.enum(EQUIPO_ESTADOS).default('operativo'),
  fechaAlta: isoDate.nullish(),
  fechaBaja: isoDate.nullish(),
  notas: z.string().trim().max(1000).nullish(),
});

export const equipoUpdateSchema = equipoCreateSchema.partial();

export type EquipoCreateInput = z.input<typeof equipoCreateSchema>;
export type EquipoUpdateInput = z.input<typeof equipoUpdateSchema>;

export interface EquipoDto {
  id: string;
  nombre: string;
  matricula: string | null;
  tipo: EquipoTipo;
  ownership: EquipoOwnership;
  proveedorAlquilerId: string | null;
  proveedorAlquilerNombre: string | null;
  estado: EquipoEstado;
  fechaAlta: string | null;
  fechaBaja: string | null;
  notas: string | null;
  /** Fecha del último mantenimiento cerrado; nulo si no tiene histórico. */
  ultimoMantenimientoFecha: string | null;
  /** Próxima revisión prevista (preventivo/ITV) más cercana entre sus mantenimientos. */
  proximaRevisionFecha: string | null;
  createdAt: string;
}

/* ────────────────────── mantenimientos ────────────────────── */

export const MANTENIMIENTO_TIPOS = ['preventivo', 'correctivo', 'itv'] as const;
export type MantenimientoTipo = (typeof MANTENIMIENTO_TIPOS)[number];

export const MANTENIMIENTO_TIPO_LABELS: Record<MantenimientoTipo, string> = {
  preventivo: 'Preventivo',
  correctivo: 'Correctivo',
  itv: 'ITV',
};

export const mantenimientoCreateSchema = z.object({
  equipoId: z.string().uuid('El equipo es obligatorio'),
  tipo: z.enum(MANTENIMIENTO_TIPOS).default('preventivo'),
  fecha: isoDate,
  proveedorId: z.string().uuid('Proveedor no válido').nullish(),
  coste: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .nonnegative('No puede ser negativo')
    .max(999_999.99)
    .nullish(),
  proximaRevisionFecha: isoDate.nullish(),
  descripcion: z.string().trim().max(1000).nullish(),
});

export const mantenimientoUpdateSchema = mantenimientoCreateSchema
  .omit({ equipoId: true })
  .partial();

export type MantenimientoCreateInput = z.input<
  typeof mantenimientoCreateSchema
>;
export type MantenimientoUpdateInput = z.input<
  typeof mantenimientoUpdateSchema
>;

export interface MantenimientoEquipoDto {
  id: string;
  equipoId: string;
  tipo: MantenimientoTipo;
  fecha: string;
  proveedorId: string | null;
  proveedorNombre: string | null;
  coste: number | null;
  proximaRevisionFecha: string | null;
  descripcion: string | null;
  createdAt: string;
}
