import { z } from 'zod';

/**
 * Datos de campo capturados por la PWA de obra (`apps/web`), pensados para
 * crearse sin cobertura y sincronizarse después: fichajes de entrada/salida
 * y el checklist PRL diario antes de empezar a trabajar. Personal propio:
 * mismo criterio que `partes_personal` — sin maestro de trabajadores
 * todavía, se anota el nombre.
 *
 * `clientId` es la clave de idempotencia de la sincronización offline: se
 * genera en el dispositivo en el momento de fichar/rellenar el checklist
 * (no al sincronizar), y el backend lo trata como único por empresa — un
 * reintento de sincronización que en realidad ya llegó no duplica la fila.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD');

/* ────────────────────── fichajes ────────────────────── */

export const FICHAJE_TYPES = ['entrada', 'salida'] as const;
export type FichajeType = (typeof FICHAJE_TYPES)[number];

export const FICHAJE_TYPE_LABELS: Record<FichajeType, string> = {
  entrada: 'Entrada',
  salida: 'Salida',
};

export const fichajeCreateSchema = z.object({
  projectId: z.string().uuid('La obra es obligatoria'),
  workerName: z.string().trim().min(1, 'El nombre es obligatorio').max(200),
  type: z.enum(FICHAJE_TYPES),
  occurredAt: z.string().datetime({ message: 'Fecha/hora ISO inválida' }),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  /** UUID generado en el dispositivo al fichar — clave de idempotencia de la sincronización offline. */
  clientId: z.string().uuid('clientId no válido').nullish(),
});
export type FichajeCreateInput = z.input<typeof fichajeCreateSchema>;

export interface FichajeDto {
  id: string;
  projectId: string;
  projectCode: string;
  workerName: string;
  type: FichajeType;
  occurredAt: string;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
}

/* ────────────────────── checklist PRL diario ────────────────────── */

/**
 * Lista fija de comprobaciones del "check list" diario de PRL antes de
 * empezar a trabajar — no editable desde la UI (sería un módulo de
 * plantillas de checklist aparte, fuera de alcance aquí); cubre los puntos
 * habituales de una inspección visual previa al inicio de la jornada.
 */
export const PRL_CHECKLIST_ITEM_LABELS = [
  'EPIs completos y en buen estado',
  'Zona de trabajo señalizada',
  'Extintor accesible',
  'Botiquín disponible',
  'Accesos y vías de circulación libres de obstáculos',
  'Maquinaria con marcado CE revisada',
  'Andamios/plataformas con protecciones colocadas',
  'Instalación eléctrica provisional en buen estado',
] as const;

export const prlChecklistItemSchema = z.object({
  label: z.string().trim().min(1).max(200),
  checked: z.boolean(),
});
export type PrlChecklistItem = z.infer<typeof prlChecklistItemSchema>;

export const prlChecklistCreateSchema = z.object({
  projectId: z.string().uuid('La obra es obligatoria'),
  workerName: z.string().trim().min(1, 'El nombre es obligatorio').max(200),
  checkDate: isoDate,
  items: z
    .array(prlChecklistItemSchema)
    .min(1, 'El checklist no puede estar vacío')
    .max(50),
  notes: z.string().trim().max(1000).nullish(),
  clientId: z.string().uuid('clientId no válido').nullish(),
});
export type PrlChecklistCreateInput = z.input<typeof prlChecklistCreateSchema>;

export interface PrlChecklistDto {
  id: string;
  projectId: string;
  projectCode: string;
  workerName: string;
  checkDate: string;
  items: PrlChecklistItem[];
  allChecked: boolean;
  notes: string | null;
  createdAt: string;
}
