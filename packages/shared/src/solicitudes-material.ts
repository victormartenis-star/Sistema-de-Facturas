/**
 * Solicitudes de material de obra (SAP MM reservation + purchase requisition,
 * Oracle Requisitions): la obra pide material a un almacén; lo disponible se
 * reserva (`stock_items.reserved_quantity`), lo que falta queda como faltante
 * que se convierte en pedido de compra, y servir es un consumo a obra que
 * libera primero lo reservado. Reglas puras en `calculo.ts`
 * (`planificarReserva`, `planificarServicio`, `estadoSolicitudMaterial`,
 * `faltanteLinea`).
 */

import { z } from 'zod';
import type { EstadoSolicitudMaterial } from './calculo';
import { cantidadStockSchema, costeUnitarioSchema } from './almacen';
import type { Transiciones } from './maquina-estados';
import type { UnidadStock } from './almacen';

export type { EstadoSolicitudMaterial } from './calculo';

export const ESTADOS_SOLICITUD_MATERIAL = [
  'abierta',
  'servida_parcial',
  'servida',
  'cancelada',
] as const satisfies readonly EstadoSolicitudMaterial[];

export const ESTADO_SOLICITUD_MATERIAL_LABELS: Record<
  EstadoSolicitudMaterial,
  string
> = {
  abierta: 'Abierta',
  servida_parcial: 'Servida en parte',
  servida: 'Servida',
  cancelada: 'Cancelada',
};

/** Servida y cancelada son terminales. */
export const SOLICITUD_MATERIAL_TRANSITIONS: Transiciones<EstadoSolicitudMaterial> =
  {
    abierta: ['servida_parcial', 'servida', 'cancelada'],
    servida_parcial: ['servida', 'cancelada'],
    servida: [],
    cancelada: [],
  };

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: AAAA-MM-DD');

function sinRepetidos(ls: { articuloId: string }[]) {
  return new Set(ls.map((l) => l.articuloId)).size === ls.length;
}

export const solicitudMaterialCreateSchema = z.object({
  almacenId: z.string().uuid(),
  projectId: z.string().uuid(),
  fechaNecesidad: fecha.nullish(),
  notas: z.string().trim().max(500).nullish(),
  lineas: z
    .array(
      z.object({
        articuloId: z.string().uuid(),
        cantidad: cantidadStockSchema,
      }),
    )
    .min(1, 'Indica al menos una línea')
    .max(100)
    .refine(sinRepetidos, 'Un artículo no puede repetirse en la solicitud'),
});
export type SolicitudMaterialCreateInput = z.input<
  typeof solicitudMaterialCreateSchema
>;

export const servirSolicitudSchema = z.object({
  fecha,
  /** Sin líneas: se sirve todo lo reservado. */
  lineas: z
    .array(
      z.object({
        lineaId: z.string().uuid(),
        cantidad: cantidadStockSchema,
      }),
    )
    .max(100)
    .optional(),
  notas: z.string().trim().max(500).nullish(),
});
export type ServirSolicitudInput = z.input<typeof servirSolicitudSchema>;

export const cancelarSolicitudSchema = z.object({
  motivo: z.string().trim().min(3).max(240),
});
export type CancelarSolicitudInput = z.input<typeof cancelarSolicitudSchema>;

/** Pedido de compra del faltante de una o varias líneas. */
export const pedidoFaltanteSchema = z.object({
  contactId: z.string().uuid(),
  fecha,
  lineas: z
    .array(
      z.object({
        lineaId: z.string().uuid(),
        costeUnitario: costeUnitarioSchema,
      }),
    )
    .min(1)
    .max(100),
});
export type PedidoFaltanteInput = z.input<typeof pedidoFaltanteSchema>;

export const solicitudesMaterialQuerySchema = z.object({
  estado: z.enum(ESTADOS_SOLICITUD_MATERIAL).optional(),
  projectId: z.string().uuid().optional(),
  almacenId: z.string().uuid().optional(),
  /** Solo las que tienen faltante sin pedido. */
  conFaltante: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type SolicitudesMaterialQuery = z.infer<
  typeof solicitudesMaterialQuerySchema
>;

/* ────────────────────────────── DTOs ────────────────────────────── */

export interface LineaSolicitudMaterialDto {
  id: string;
  articuloId: string;
  articuloCodigo: string;
  articuloNombre: string;
  unidad: UnidadStock;
  solicitada: number;
  reservada: number;
  servida: number;
  /** Ni servido ni reservado: a comprar. */
  faltante: number;
  pedidoId: string | null;
  pedidoNumero: string | null;
}

export interface SolicitudMaterialDto {
  id: string;
  numero: string;
  projectId: string;
  projectCodigo: string;
  almacenId: string;
  almacenCodigo: string;
  estado: EstadoSolicitudMaterial;
  fechaNecesidad: string | null;
  notas: string | null;
  motivoCancelacion: string | null;
  solicitadaPor: string | null;
  creadaEn: string;
  lineas: LineaSolicitudMaterialDto[];
  /** Hay faltante sin pedido de compra. */
  conFaltante: boolean;
  version: number;
}
