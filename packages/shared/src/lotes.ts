/**
 * Inventario por lote y número de serie (SAP MM Batch / Serial Number
 * Management; Oracle Inventory Lot & Serial Control).
 *
 * - Un artículo se gestiona sin seguimiento, por lote (cantidades
 *   fraccionables con caducidad opcional) o por número de serie (una unidad
 *   por serie, con fin de garantía opcional).
 * - La valoración sigue siendo el PMP del artículo y almacén: el lote
 *   reparte la cantidad, no el coste (como la valoración no separada por lote
 *   de SAP), así que coste = cantidad del lote × PMP.
 * - Las salidas sin lote indicado siguen FEFO (primero caduca, primero sale)
 *   y, a igual caducidad, el lote más antiguo.
 *
 * Funciones puras en milésimas `BigInt` (escala de cantidad del stock).
 */

import { z } from 'zod';
import { scaledToNumeric, toScaled } from './dinero';

export const SEGUIMIENTOS_STOCK = ['ninguno', 'lote', 'serie'] as const;
export type SeguimientoStock = (typeof SEGUIMIENTOS_STOCK)[number];

export const SEGUIMIENTO_STOCK_LABELS: Record<SeguimientoStock, string> = {
  ninguno: 'Sin seguimiento',
  lote: 'Por lote',
  serie: 'Por número de serie',
};

const ESCALA = 3;
const UNO = 1000n;

export type CodigoErrorLote =
  | 'BATCH_SERIAL_REQUIRED'
  | 'BATCH_SERIAL_NOT_TRACKED'
  | 'BATCH_SERIAL_QUANTITY_MISMATCH'
  | 'BATCH_SERIAL_INVALID'
  | 'BATCH_SERIAL_INSUFFICIENT'
  | 'BATCH_SERIAL_NOT_FOUND'
  | 'BATCH_SERIAL_RETURN_EXCEEDS';

export class ErrorLote extends Error {
  constructor(
    readonly codigo: CodigoErrorLote,
    message: string,
  ) {
    super(message);
    this.name = 'ErrorLote';
  }
}

export interface LoteIndicado {
  codigo: string;
  cantidad: number | string;
  /** Caducidad (lote) o fin de garantía (serie). */
  caducidad?: string | null;
}

export interface LoteAsignado {
  codigo: string;
  cantidad: string;
  caducidad: string | null;
}

const normalizar = (codigo: string) => codigo.trim().toUpperCase();

/**
 * Valida los lotes / series de una entrada (recepción, sobrante de
 * regularización): obligatorios si hay seguimiento y prohibidos si no;
 * códigos no vacíos y sin repetir; en serie, una unidad exacta por número;
 * la suma es exactamente la cantidad del movimiento.
 */
export function validarLotesEntrada(
  seguimiento: SeguimientoStock,
  cantidad: number | string,
  lotes: readonly LoteIndicado[] | null | undefined,
): LoteAsignado[] {
  const lista = lotes ?? [];
  if (seguimiento === 'ninguno') {
    if (lista.length > 0) {
      throw new ErrorLote(
        'BATCH_SERIAL_NOT_TRACKED',
        'El artículo no se gestiona por lote ni por número de serie',
      );
    }
    return [];
  }
  if (lista.length === 0) {
    throw new ErrorLote(
      'BATCH_SERIAL_REQUIRED',
      seguimiento === 'serie'
        ? 'Indica el número de serie de cada unidad'
        : 'Indica el lote de la entrada',
    );
  }
  const vistos = new Set<string>();
  let suma = 0n;
  const out: LoteAsignado[] = [];
  for (const l of lista) {
    const codigo = normalizar(l.codigo);
    if (!codigo || codigo.length > 60) {
      throw new ErrorLote(
        'BATCH_SERIAL_INVALID',
        'Código de lote o serie no válido',
      );
    }
    if (vistos.has(codigo)) {
      throw new ErrorLote(
        'BATCH_SERIAL_INVALID',
        `El código ${codigo} está repetido en el movimiento`,
      );
    }
    vistos.add(codigo);
    const q = toScaled(l.cantidad, ESCALA);
    if (q <= 0n) {
      throw new ErrorLote(
        'BATCH_SERIAL_INVALID',
        'Cada lote debe tener cantidad positiva',
      );
    }
    if (seguimiento === 'serie' && q !== UNO) {
      throw new ErrorLote(
        'BATCH_SERIAL_INVALID',
        `El número de serie ${codigo} identifica una sola unidad`,
      );
    }
    suma += q;
    out.push({
      codigo,
      cantidad: scaledToNumeric(q, ESCALA),
      caducidad: l.caducidad ?? null,
    });
  }
  if (suma !== toScaled(cantidad, ESCALA)) {
    throw new ErrorLote(
      'BATCH_SERIAL_QUANTITY_MISMATCH',
      `Los lotes suman ${scaledToNumeric(suma, ESCALA)} y el movimiento es de ${scaledToNumeric(toScaled(cantidad, ESCALA), ESCALA)}`,
    );
  }
  return out;
}

export interface LoteDisponible {
  lotId: string;
  codigo: string;
  /** Cantidad disponible del lote en ese almacén (o consumida por la obra). */
  cantidad: string | number;
  caducidad: string | null;
  /** Fecha de alta del lote (desempate FEFO). */
  alta: string;
}

/**
 * Lotes de una salida (consumo, traspaso, faltante) o de una devolución
 * (sobre lo consumido por la obra): explícitos —deben existir, no repetirse
 * y no superar lo disponible de cada uno— o, si no se indican, FEFO hasta
 * cubrir la cantidad. La suma es exactamente la cantidad pedida.
 */
export function asignarLotesSalida(x: {
  seguimiento: SeguimientoStock;
  cantidad: number | string;
  disponibles: readonly LoteDisponible[];
  explicitos?: readonly LoteIndicado[] | null;
  /** Devolución: los errores hablan de «consumido». */
  devolucion?: boolean;
}): (LoteAsignado & { lotId: string })[] {
  const explicitos = x.explicitos ?? [];
  if (x.seguimiento === 'ninguno') {
    if (explicitos.length > 0) {
      throw new ErrorLote(
        'BATCH_SERIAL_NOT_TRACKED',
        'El artículo no se gestiona por lote ni por número de serie',
      );
    }
    return [];
  }
  const pedido = toScaled(x.cantidad, ESCALA);
  if (x.seguimiento === 'serie' && pedido % UNO !== 0n) {
    throw new ErrorLote(
      'BATCH_SERIAL_INVALID',
      'Un artículo con número de serie sale por unidades enteras',
    );
  }
  const porCodigo = new Map(
    x.disponibles.map((d) => [normalizar(d.codigo), d]),
  );
  const sinStock = x.devolucion
    ? 'BATCH_SERIAL_RETURN_EXCEEDS'
    : 'BATCH_SERIAL_INSUFFICIENT';
  if (explicitos.length > 0) {
    const vistos = new Set<string>();
    let suma = 0n;
    const out: (LoteAsignado & { lotId: string })[] = [];
    for (const e of explicitos) {
      const codigo = normalizar(e.codigo);
      const d = porCodigo.get(codigo);
      if (!d) {
        throw new ErrorLote(
          x.devolucion
            ? 'BATCH_SERIAL_RETURN_EXCEEDS'
            : 'BATCH_SERIAL_NOT_FOUND',
          x.devolucion
            ? `La obra no consumió el lote o serie ${codigo}`
            : `El lote o serie ${codigo} no tiene existencias en el almacén`,
        );
      }
      if (vistos.has(codigo)) {
        throw new ErrorLote(
          'BATCH_SERIAL_INVALID',
          `El código ${codigo} está repetido`,
        );
      }
      vistos.add(codigo);
      const q = toScaled(e.cantidad, ESCALA);
      if (q <= 0n || (x.seguimiento === 'serie' && q !== UNO)) {
        throw new ErrorLote(
          'BATCH_SERIAL_INVALID',
          `Cantidad no válida para ${codigo}`,
        );
      }
      if (q > toScaled(d.cantidad, ESCALA)) {
        throw new ErrorLote(
          sinStock,
          `${codigo}: se piden ${scaledToNumeric(q, ESCALA)} y hay ${scaledToNumeric(toScaled(d.cantidad, ESCALA), ESCALA)} ${x.devolucion ? 'consumidos' : 'disponibles'}`,
        );
      }
      suma += q;
      out.push({
        lotId: d.lotId,
        codigo,
        cantidad: scaledToNumeric(q, ESCALA),
        caducidad: d.caducidad,
      });
    }
    if (suma !== pedido) {
      throw new ErrorLote(
        'BATCH_SERIAL_QUANTITY_MISMATCH',
        `Los lotes suman ${scaledToNumeric(suma, ESCALA)} y el movimiento es de ${scaledToNumeric(pedido, ESCALA)}`,
      );
    }
    return out;
  }
  const fefo = [...x.disponibles]
    .filter((d) => toScaled(d.cantidad, ESCALA) > 0n)
    .sort(
      (a, b) =>
        (a.caducidad ?? '9999-12-31').localeCompare(
          b.caducidad ?? '9999-12-31',
        ) ||
        a.alta.localeCompare(b.alta) ||
        normalizar(a.codigo).localeCompare(normalizar(b.codigo)),
    );
  let resto = pedido;
  const out: (LoteAsignado & { lotId: string })[] = [];
  for (const d of fefo) {
    if (resto === 0n) break;
    const hay = toScaled(d.cantidad, ESCALA);
    const q = hay < resto ? hay : resto;
    out.push({
      lotId: d.lotId,
      codigo: normalizar(d.codigo),
      cantidad: scaledToNumeric(q, ESCALA),
      caducidad: d.caducidad,
    });
    resto -= q;
  }
  if (resto > 0n) {
    throw new ErrorLote(
      sinStock,
      `Faltan ${scaledToNumeric(resto, ESCALA)} por asignar a lotes o series ${x.devolucion ? 'consumidos por la obra' : 'con existencias'}`,
    );
  }
  return out;
}

/** Un lote caducado (caducidad < fecha) no debería consumirse: aviso, no bloqueo. */
export function lotesCaducados(
  asignados: readonly { codigo: string; caducidad: string | null }[],
  fecha: string,
): string[] {
  return asignados
    .filter((a) => a.caducidad !== null && a.caducidad < fecha)
    .map((a) => a.codigo);
}

/* ───────────────────────────── contratos ───────────────────────────── */

export const loteIndicadoSchema = z.object({
  codigo: z.string().trim().min(1).max(60),
  cantidad: z.number().finite().positive().max(99_999_999_999),
  caducidad: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
});
export const lotesIndicadosSchema = z.array(loteIndicadoSchema).max(500);

export const lotesQuerySchema = z.object({
  articuloId: z.string().uuid().optional(),
  almacenId: z.string().uuid().optional(),
  q: z.string().trim().max(60).optional(),
  conStock: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type LotesQuery = z.infer<typeof lotesQuerySchema>;

export interface LoteDto {
  id: string;
  articuloId: string;
  articuloCodigo: string;
  articuloNombre: string;
  seguimiento: Exclude<SeguimientoStock, 'ninguno'>;
  codigo: string;
  caducidad: string | null;
  cantidad: number;
  porAlmacen: { almacenId: string; almacenCodigo: string; cantidad: number }[];
  alta: string;
}

export interface TrazaLoteDto extends LoteDto {
  movimientos: {
    movimientoId: string;
    tipo: string;
    fecha: string;
    almacenId: string;
    almacenCodigo: string;
    cantidad: number;
    projectId: string | null;
    albaranId: string | null;
  }[];
  /** Obras que consumieron el lote (neto de devoluciones). */
  obras: { projectId: string; cantidad: number }[];
}
