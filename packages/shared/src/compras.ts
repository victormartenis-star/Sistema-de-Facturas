/**
 * Procure-to-Pay (P2P) al estilo de SAP MM (ME51N / ME41 / ME21N / MIGO /
 * MIRO) y Oracle Procurement: solicitud de compra (PR), petición de ofertas
 * (RFQ), pedido con líneas (PO), recepción (GR) y verificación de la factura
 * por línea con cuadre a tres bandas (pedido ↔ recepción ↔ factura).
 *
 * Funciones puras en aritmética entera exacta: cantidades en milésimas,
 * precios unitarios en diezmilésimas e importes en céntimos (`BigInt`). Sin
 * base de datos y sin reloj.
 */

import { z } from 'zod';
import {
  centsToNumeric,
  fromCents,
  mulDivRound,
  scaledToNumeric,
  sumCents,
  toCents,
  toScaled,
} from './dinero';
import { lotesIndicadosSchema } from './lotes';
import type { Transiciones } from './maquina-estados';

type Num = string | number;

/* ───────────────────────────── catálogos ───────────────────────────── */

export const TIPOS_LINEA_COMPRA = [
  'material',
  'servicio',
  'subcontrata',
  'gasto',
] as const;
export type TipoLineaCompra = (typeof TIPOS_LINEA_COMPRA)[number];

export const TIPO_LINEA_COMPRA_LABELS: Record<TipoLineaCompra, string> = {
  material: 'Material',
  servicio: 'Servicio',
  subcontrata: 'Subcontrata',
  gasto: 'Gasto de obra',
};

export const ESTADOS_SOLICITUD_COMPRA = [
  'borrador',
  'solicitada',
  'aprobada',
  'rechazada',
  'convertida',
  'anulada',
] as const;
export type EstadoSolicitudCompra = (typeof ESTADOS_SOLICITUD_COMPRA)[number];

export const ESTADO_SOLICITUD_COMPRA_LABELS: Record<
  EstadoSolicitudCompra,
  string
> = {
  borrador: 'Borrador',
  solicitada: 'Solicitada',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
  convertida: 'Convertida',
  anulada: 'Anulada',
};

/** Rechazada vuelve a borrador para corregirla; convertida y anulada son terminales. */
export const SOLICITUD_COMPRA_TRANSITIONS: Transiciones<EstadoSolicitudCompra> =
  {
    borrador: ['solicitada', 'anulada'],
    solicitada: ['aprobada', 'rechazada', 'anulada'],
    aprobada: ['convertida', 'anulada'],
    rechazada: ['borrador', 'anulada'],
    convertida: [],
    anulada: [],
  };

export const ESTADOS_PETICION_OFERTA = [
  'abierta',
  'adjudicada',
  'cancelada',
] as const;
export type EstadoPeticionOferta = (typeof ESTADOS_PETICION_OFERTA)[number];

export const ESTADO_PETICION_OFERTA_LABELS: Record<
  EstadoPeticionOferta,
  string
> = { abierta: 'Abierta', adjudicada: 'Adjudicada', cancelada: 'Cancelada' };

export const PETICION_OFERTA_TRANSITIONS: Transiciones<EstadoPeticionOferta> = {
  abierta: ['adjudicada', 'cancelada'],
  adjudicada: [],
  cancelada: [],
};

/** Tolerancias por defecto del cuadre a tres bandas (configurables por pedido). */
export const TOLERANCIAS_CUADRE_POR_DEFECTO = {
  /** Sobreprecio admitido sobre el precio del pedido, en %. */
  precioPct: 2,
  /** …y en importe absoluto por línea (se aplica el más estricto). */
  precioImporte: 50,
  /** Exceso de cantidad facturada sobre la recibida (o pedida), en %. */
  cantidadPct: 0,
} as const;

/** Sobre-entrega admitida en la recepción, en % de lo pedido. */
export const TOLERANCIA_RECEPCION_PCT = 0;

/* ───────────────────────────── reglas ───────────────────────────── */

const ESC_CANT = 3;
const ESC_PRECIO = 4;
/** milésimas × diezmilésimas → céntimos: / 10^(3 + 4 − 2). */
const DIV_IMPORTE = 10n ** BigInt(ESC_CANT + ESC_PRECIO - 2);

export class ErrorCompras extends Error {
  constructor(
    readonly codigo: string,
    message: string,
    readonly detalle?: unknown,
  ) {
    super(message);
    this.name = 'ErrorCompras';
  }
}

/** Importe de una línea: cantidad × precio unitario, half-up al céntimo. */
export function importeLinea(cantidad: Num, precioUnitario: Num): bigint {
  return mulDivRound(
    toScaled(cantidad, ESC_CANT),
    toScaled(precioUnitario, ESC_PRECIO),
    DIV_IMPORTE,
  );
}

export interface LineaCompraEntrada {
  tipo: TipoLineaCompra;
  articuloId?: string | null;
  descripcion: string;
  cantidad: Num;
  precioUnitario?: Num | null;
}

/**
 * Valida las líneas de una solicitud, petición o pedido: al menos una;
 * cantidad > 0 con 3 decimales; precio ≥ 0 con 4 decimales; el artículo de
 * almacén solo en líneas de material, y sin repetirlo en el documento (la
 * recepción lo entra en stock por línea).
 */
export function validarLineasCompra(
  lineas: readonly LineaCompraEntrada[],
  opciones: { exigirPrecio?: boolean } = {},
): void {
  if (lineas.length === 0) {
    throw new ErrorCompras('P2P_LINES_REQUIRED', 'Añade al menos una línea');
  }
  const articulos = new Set<string>();
  lineas.forEach((l, i) => {
    const n = i + 1;
    if (toScaled(l.cantidad, ESC_CANT) <= 0n) {
      throw new ErrorCompras(
        'P2P_LINE_INVALID',
        `Línea ${n}: la cantidad debe ser mayor que cero`,
      );
    }
    if (l.articuloId && l.tipo !== 'material') {
      throw new ErrorCompras(
        'P2P_LINE_INVALID',
        `Línea ${n}: solo las líneas de material llevan artículo de almacén`,
      );
    }
    if (l.articuloId) {
      if (articulos.has(l.articuloId)) {
        throw new ErrorCompras(
          'P2P_LINE_INVALID',
          `Línea ${n}: el artículo se repite en el documento`,
        );
      }
      articulos.add(l.articuloId);
    }
    if (
      opciones.exigirPrecio &&
      (l.precioUnitario === undefined || l.precioUnitario === null)
    ) {
      throw new ErrorCompras(
        'P2P_LINE_INVALID',
        `Línea ${n}: falta el precio unitario`,
      );
    }
    if (
      l.precioUnitario !== undefined &&
      l.precioUnitario !== null &&
      toScaled(l.precioUnitario, ESC_PRECIO) < 0n
    ) {
      throw new ErrorCompras(
        'P2P_LINE_INVALID',
        `Línea ${n}: el precio no puede ser negativo`,
      );
    }
  });
}

/** Total de un documento de compra: Σ importes de línea, exacto. */
export function totalLineas(
  lineas: readonly { cantidad: Num; precioUnitario: Num }[],
): number {
  return fromCents(
    sumCents(lineas.map((l) => importeLinea(l.cantidad, l.precioUnitario))),
  );
}

export interface EstadoLineaPedido {
  pedida: string;
  recibida: string;
  facturada: string;
  importePedido: number;
  importeRecibido: number;
  importeFacturado: number;
  pendienteRecibir: string;
  /** Lo que aún puede facturarse: lo recibido (o lo pedido, si no exige recepción) − lo facturado. */
  pendienteFacturar: string;
  /** Recibido y no facturado, valorado al precio del pedido (provisión del cierre). */
  recibidoSinFacturar: number;
}

/** Cantidades e importes pendientes de una línea de pedido, en exacto. */
export function estadoLineaPedido(x: {
  cantidad: Num;
  precioUnitario: Num;
  recibida: Num;
  facturada: Num;
  importeFacturado: Num;
  exigeRecepcion: boolean;
}): EstadoLineaPedido {
  const pedida = toScaled(x.cantidad, ESC_CANT);
  const recibida = toScaled(x.recibida, ESC_CANT);
  const facturada = toScaled(x.facturada, ESC_CANT);
  const pendRecibir = pedida - recibida;
  const facturable = x.exigeRecepcion ? recibida : pedida;
  const pendFacturar = facturable - facturada;
  const sinFacturar = recibida - facturada;
  const q = (v: bigint) => scaledToNumeric(v < 0n ? 0n : v, ESC_CANT);
  return {
    pedida: scaledToNumeric(pedida, ESC_CANT),
    recibida: scaledToNumeric(recibida, ESC_CANT),
    facturada: scaledToNumeric(facturada, ESC_CANT),
    importePedido: fromCents(importeLinea(x.cantidad, x.precioUnitario)),
    importeRecibido: fromCents(importeLinea(x.recibida, x.precioUnitario)),
    importeFacturado: fromCents(toCents(x.importeFacturado)),
    pendienteRecibir: q(pendRecibir),
    pendienteFacturar: q(pendFacturar),
    recibidoSinFacturar: fromCents(
      sinFacturar > 0n
        ? importeLinea(scaledToNumeric(sinFacturar, ESC_CANT), x.precioUnitario)
        : 0n,
    ),
  };
}

/**
 * Valida una recepción de una línea: cantidad > 0, sin superar lo pendiente
 * de recibir más la tolerancia de sobre-entrega. Devuelve el importe al
 * precio del pedido.
 */
export function validarRecepcionLinea(x: {
  cantidadPedida: Num;
  recibidaPrevia: Num;
  cantidad: Num;
  precioUnitario: Num;
  toleranciaPct?: number;
}): bigint {
  const q = toScaled(x.cantidad, ESC_CANT);
  if (q <= 0n) {
    throw new ErrorCompras(
      'P2P_RECEIPT_INVALID',
      'La cantidad recibida debe ser mayor que cero',
    );
  }
  const pedida = toScaled(x.cantidadPedida, ESC_CANT);
  const limite =
    pedida +
    mulDivRound(
      pedida,
      toScaled(x.toleranciaPct ?? TOLERANCIA_RECEPCION_PCT, 2),
      10_000n,
    );
  const tras = toScaled(x.recibidaPrevia, ESC_CANT) + q;
  if (tras > limite) {
    throw new ErrorCompras(
      'P2P_RECEIPT_EXCEEDS_ORDER',
      `Se recibirían ${scaledToNumeric(tras, ESC_CANT)} y el pedido es de ${scaledToNumeric(pedida, ESC_CANT)}`,
    );
  }
  return importeLinea(x.cantidad, x.precioUnitario);
}

export const MOTIVOS_BLOQUEO_CUADRE = [
  'P2P_MATCH_NOT_RECEIVED',
  'P2P_MATCH_QUANTITY_VARIANCE',
  'P2P_MATCH_PRICE_VARIANCE',
] as const;
export type MotivoBloqueoCuadre = (typeof MOTIVOS_BLOQUEO_CUADRE)[number];

export interface ToleranciasCuadre {
  precioPct: Num;
  precioImporte: Num;
  cantidadPct: Num;
}

export interface CuadreLineaDto {
  lineaPedidoId: string;
  cantidadPedida: string;
  cantidadRecibida: string;
  facturadaPrevia: string;
  cantidadFactura: string;
  precioPedido: string;
  precioFactura: string;
  /** Límite de cantidad facturable acumulada (recibido o pedido + tolerancia). */
  limiteCantidad: string;
  /** Sobreprecio total de la línea en céntimos exactos (≥ 0). */
  sobreprecio: number;
  estado: 'cuadra' | 'bloqueada';
  motivos: { codigo: MotivoBloqueoCuadre; detalle: string }[];
}

/**
 * Cuadre a tres bandas de una línea de factura (SAP MIRO / Oracle 3-way
 * match): pedido (cantidad y precio), recepción (cantidad recibida) y factura
 * (cantidad y precio facturados, más lo ya facturado antes).
 *  - Cantidad: lo facturado acumulado no supera lo recibido —o lo pedido, si
 *    la línea no exige recepción (factura directa contra pedido)— más la
 *    tolerancia de cantidad. Sin recepción en una línea que la exige:
 *    `P2P_MATCH_NOT_RECEIVED`.
 *  - Precio: el sobreprecio unitario no supera el % de tolerancia y el
 *    sobreprecio total de la línea no supera la tolerancia en importe (se
 *    aplica la más estricta). Un precio inferior no bloquea.
 * Una línea fuera de tolerancia queda bloqueada para pago (no se aprueba).
 */
export function cuadreTresBandas(x: {
  lineaPedidoId: string;
  cantidadPedida: Num;
  precioPedido: Num;
  cantidadRecibida: Num;
  facturadaPrevia: Num;
  exigeRecepcion: boolean;
  cantidadFactura: Num;
  precioFactura: Num;
  tolerancias: ToleranciasCuadre;
}): CuadreLineaDto {
  const motivos: CuadreLineaDto['motivos'] = [];
  const pedida = toScaled(x.cantidadPedida, ESC_CANT);
  const recibida = toScaled(x.cantidadRecibida, ESC_CANT);
  const previa = toScaled(x.facturadaPrevia, ESC_CANT);
  const factura = toScaled(x.cantidadFactura, ESC_CANT);
  const base = x.exigeRecepcion ? recibida : pedida;
  const limite =
    base + mulDivRound(base, toScaled(x.tolerancias.cantidadPct, 2), 10_000n);
  if (x.exigeRecepcion && recibida === 0n) {
    motivos.push({
      codigo: 'P2P_MATCH_NOT_RECEIVED',
      detalle: 'La línea exige recepción y no se ha recibido nada',
    });
  } else if (previa + factura > limite) {
    motivos.push({
      codigo: 'P2P_MATCH_QUANTITY_VARIANCE',
      detalle: `Se facturarían ${scaledToNumeric(previa + factura, ESC_CANT)} y el límite es ${scaledToNumeric(limite, ESC_CANT)} (${x.exigeRecepcion ? 'recibido' : 'pedido'} + tolerancia)`,
    });
  }
  const pPedido = toScaled(x.precioPedido, ESC_PRECIO);
  const pFactura = toScaled(x.precioFactura, ESC_PRECIO);
  const difUnit = pFactura - pPedido;
  let sobreprecio = 0n;
  if (difUnit > 0n) {
    sobreprecio = mulDivRound(factura, difUnit, DIV_IMPORTE);
    // dif / precio > pct  ⇔  dif × 10000 > pct(2 dec) × precio
    const pctExcedido =
      pPedido === 0n ||
      difUnit * 10_000n > toScaled(x.tolerancias.precioPct, 2) * pPedido;
    const importeExcedido = sobreprecio > toCents(x.tolerancias.precioImporte);
    if (pctExcedido || importeExcedido) {
      motivos.push({
        codigo: 'P2P_MATCH_PRICE_VARIANCE',
        detalle: `Precio facturado ${scaledToNumeric(pFactura, ESC_PRECIO)} frente a ${scaledToNumeric(pPedido, ESC_PRECIO)} del pedido: sobreprecio ${centsToNumeric(sobreprecio)} € (tolerancia ${x.tolerancias.precioPct} % y ${x.tolerancias.precioImporte} €)`,
      });
    }
  }
  return {
    lineaPedidoId: x.lineaPedidoId,
    cantidadPedida: scaledToNumeric(pedida, ESC_CANT),
    cantidadRecibida: scaledToNumeric(recibida, ESC_CANT),
    facturadaPrevia: scaledToNumeric(previa, ESC_CANT),
    cantidadFactura: scaledToNumeric(factura, ESC_CANT),
    precioPedido: scaledToNumeric(pPedido, ESC_PRECIO),
    precioFactura: scaledToNumeric(pFactura, ESC_PRECIO),
    limiteCantidad: scaledToNumeric(limite, ESC_CANT),
    sobreprecio: fromCents(sobreprecio),
    estado: motivos.length === 0 ? 'cuadra' : 'bloqueada',
    motivos,
  };
}

/**
 * Cuadre de una factura con varias líneas contra el mismo pedido: las líneas
 * que apuntan a la misma línea de pedido se acumulan en orden (la segunda
 * cuenta lo de la primera como facturado previo).
 */
export function cuadreFactura(
  lineas: readonly Omit<
    Parameters<typeof cuadreTresBandas>[0],
    'facturadaPrevia'
  >[],
  facturadoPrevio: ReadonlyMap<string, Num>,
): { lineas: CuadreLineaDto[]; bloqueada: boolean } {
  const acumulado = new Map<string, bigint>();
  const out = lineas.map((l) => {
    const previa =
      toScaled(facturadoPrevio.get(l.lineaPedidoId) ?? 0, ESC_CANT) +
      (acumulado.get(l.lineaPedidoId) ?? 0n);
    acumulado.set(
      l.lineaPedidoId,
      (acumulado.get(l.lineaPedidoId) ?? 0n) +
        toScaled(l.cantidadFactura, ESC_CANT),
    );
    return cuadreTresBandas({
      ...l,
      facturadaPrevia: scaledToNumeric(previa, ESC_CANT),
    });
  });
  return { lineas: out, bloqueada: out.some((l) => l.estado === 'bloqueada') };
}

export interface OfertaComparada {
  contactId: string;
  contactName: string;
  /** Total de las líneas ofertadas. */
  total: number;
  lineasOfertadas: number;
  completa: boolean;
  plazoDias: number | null;
  validaHasta: string | null;
}

export interface ComparativaDto {
  lineas: {
    lineaId: string;
    descripcion: string;
    cantidad: string;
    ofertas: { contactId: string; precioUnitario: string; importe: number }[];
    mejor: {
      contactId: string;
      precioUnitario: string;
      importe: number;
    } | null;
  }[];
  ofertas: OfertaComparada[];
  /** Proveedor con la oferta completa más baja (null si ninguna es completa). */
  mejorCompleta: string | null;
  /** Σ del mejor precio de cada línea (adjudicación por línea). */
  totalMejorPorLinea: number;
}

/**
 * Comparativa de ofertas de una petición: por línea, las ofertas ordenadas
 * por importe (desempate: menor plazo, luego proveedor); por proveedor, total,
 * si cubre todas las líneas y plazo. Las ofertas caducadas a la fecha
 * (`validaHasta < fecha`) no cuentan como mejor.
 */
export function comparativaOfertas(x: {
  fecha: string;
  lineas: readonly { id: string; descripcion: string; cantidad: Num }[];
  proveedores: readonly {
    contactId: string;
    contactName: string;
    plazoDias: number | null;
    validaHasta: string | null;
    precios: readonly { lineaId: string; precioUnitario: Num }[];
  }[];
}): ComparativaDto {
  const vigente = (p: { validaHasta: string | null }) =>
    !p.validaHasta || p.validaHasta >= x.fecha;
  const plazo = new Map(
    x.proveedores.map((p) => [
      p.contactId,
      p.plazoDias ?? Number.MAX_SAFE_INTEGER,
    ]),
  );
  const lineas = x.lineas.map((l) => {
    const ofertas = x.proveedores
      .flatMap((p) =>
        p.precios
          .filter((q) => q.lineaId === l.id)
          .map((q) => ({
            contactId: p.contactId,
            precioUnitario: scaledToNumeric(
              toScaled(q.precioUnitario, ESC_PRECIO),
              ESC_PRECIO,
            ),
            _c: importeLinea(l.cantidad, q.precioUnitario),
            _v: vigente(p),
          })),
      )
      .sort(
        (a, b) =>
          (a._c < b._c ? -1 : a._c > b._c ? 1 : 0) ||
          plazo.get(a.contactId)! - plazo.get(b.contactId)! ||
          a.contactId.localeCompare(b.contactId),
      );
    const mejor = ofertas.find((o) => o._v) ?? null;
    const limpia = (o: (typeof ofertas)[number]) => ({
      contactId: o.contactId,
      precioUnitario: o.precioUnitario,
      importe: fromCents(o._c),
    });
    return {
      lineaId: l.id,
      descripcion: l.descripcion,
      cantidad: scaledToNumeric(toScaled(l.cantidad, ESC_CANT), ESC_CANT),
      ofertas: ofertas.map(limpia),
      mejor: mejor ? limpia(mejor) : null,
      _mejor: mejor?._c ?? 0n,
    };
  });
  const ofertas = x.proveedores
    .map((p) => {
      const total = sumCents(
        p.precios.map((q) => {
          const l = x.lineas.find((y) => y.id === q.lineaId);
          return l ? importeLinea(l.cantidad, q.precioUnitario) : 0n;
        }),
      );
      const cubiertas = new Set(
        p.precios
          .map((q) => q.lineaId)
          .filter((id) => x.lineas.some((l) => l.id === id)),
      );
      return {
        contactId: p.contactId,
        contactName: p.contactName,
        total: fromCents(total),
        _t: total,
        lineasOfertadas: cubiertas.size,
        completa: cubiertas.size === x.lineas.length,
        plazoDias: p.plazoDias,
        validaHasta: p.validaHasta,
        _v: vigente(p),
      };
    })
    .sort(
      (a, b) =>
        (a._t < b._t ? -1 : a._t > b._t ? 1 : 0) ||
        a.contactId.localeCompare(b.contactId),
    );
  const mejorCompleta =
    ofertas.find((o) => o.completa && o._v)?.contactId ?? null;
  return {
    lineas: lineas.map(({ _mejor, ...l }) => l),
    ofertas: ofertas.map(({ _t, _v, ...o }) => o),
    mejorCompleta,
    totalMejorPorLinea: fromCents(sumCents(lineas.map((l) => l._mejor))),
  };
}

/** Ejecutado de un pedido para el comprometido: albaranes facturados + líneas facturadas directamente. */
export function ejecutadoPedido(x: {
  albaranesFacturados: Num;
  lineasFacturadas: Num;
}): string {
  return centsToNumeric(
    toCents(x.albaranesFacturados) + toCents(x.lineasFacturadas),
  );
}

/* ───────────────────────────── contratos ───────────────────────────── */

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: AAAA-MM-DD');
const cantidad = z
  .number()
  .finite()
  .positive('La cantidad debe ser mayor que cero')
  .max(99_999_999_999)
  .refine(
    (n) => Math.abs(Math.round(n * 1000) - n * 1000) < 1e-6,
    'Como máximo 3 decimales',
  );
const precio = z
  .number()
  .finite()
  .min(0)
  .max(9_999_999_999)
  .refine(
    (n) => Math.abs(Math.round(n * 10000) - n * 10000) < 1e-6,
    'Como máximo 4 decimales',
  );
const pct = z.number().finite().min(0).max(100);
const motivo = z.string().trim().min(3).max(240);

const lineaBase = z.object({
  tipo: z.enum(TIPOS_LINEA_COMPRA),
  articuloId: z.string().uuid().nullish(),
  descripcion: z.string().trim().min(1).max(500),
  unidad: z.string().trim().min(1).max(10).default('ud'),
  cantidad,
  phaseId: z.string().uuid().nullish(),
});

export const solicitudCompraCreateSchema = z.object({
  projectId: z.string().uuid(),
  titulo: z.string().trim().min(3).max(200),
  necesariaEl: fecha.nullish(),
  notas: z.string().trim().max(2000).nullish(),
  /** Enviar directamente a aprobación. */
  enviar: z.boolean().default(false),
  lineas: z
    .array(lineaBase.extend({ precioEstimado: precio.nullish() }))
    .min(1)
    .max(200),
});
export type SolicitudCompraCreateInput = z.input<
  typeof solicitudCompraCreateSchema
>;

export const solicitudesCompraQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  estado: z.enum(ESTADOS_SOLICITUD_COMPRA).optional(),
});
export type SolicitudesCompraQuery = z.infer<
  typeof solicitudesCompraQuerySchema
>;

export const rechazoSchema = z.object({ motivo });
export type RechazoInput = z.input<typeof rechazoSchema>;

/** Convertir una solicitud aprobada en pedido directo a un proveedor. */
export const convertirEnPedidoSchema = z.object({
  contactId: z.string().uuid(),
  fecha,
  entregaPrevista: fecha.nullish(),
  /** Precio por línea de la solicitud (sin él, el estimado). */
  precios: z
    .array(z.object({ lineaId: z.string().uuid(), precioUnitario: precio }))
    .max(200)
    .optional(),
});
export type ConvertirEnPedidoInput = z.input<typeof convertirEnPedidoSchema>;

/** Convertir una solicitud aprobada en petición de ofertas a varios proveedores. */
export const convertirEnPeticionSchema = z.object({
  proveedores: z.array(z.string().uuid()).min(1).max(20),
  fechaLimite: fecha.nullish(),
});
export type ConvertirEnPeticionInput = z.input<
  typeof convertirEnPeticionSchema
>;

export const ofertaRegistrarSchema = z.object({
  contactId: z.string().uuid(),
  plazoDias: z.number().int().min(0).max(3650).nullish(),
  validaHasta: fecha.nullish(),
  condiciones: z.string().trim().max(500).nullish(),
  precios: z
    .array(z.object({ lineaId: z.string().uuid(), precioUnitario: precio }))
    .min(1)
    .max(200),
});
export type OfertaRegistrarInput = z.input<typeof ofertaRegistrarSchema>;

/** Adjudicación: todo a un proveedor, o por línea. */
export const adjudicarPeticionSchema = z
  .object({
    fecha,
    contactId: z.string().uuid().optional(),
    porLinea: z
      .array(
        z.object({ lineaId: z.string().uuid(), contactId: z.string().uuid() }),
      )
      .max(200)
      .optional(),
  })
  .refine((a) => Boolean(a.contactId) !== Boolean(a.porLinea?.length), {
    message: 'Indica un proveedor para todo o la adjudicación por línea',
  });
export type AdjudicarPeticionInput = z.input<typeof adjudicarPeticionSchema>;

export const pedidoLineasCreateSchema = z.object({
  projectId: z.string().uuid(),
  contactId: z.string().uuid(),
  fecha,
  descripcion: z.string().trim().min(1).max(500),
  entregaPrevista: fecha.nullish(),
  phaseId: z.string().uuid().nullish(),
  toleranciaPrecioPct: pct.optional(),
  toleranciaPrecioImporte: z.number().finite().min(0).max(9_999_999).optional(),
  toleranciaCantidadPct: pct.optional(),
  notas: z.string().trim().max(2000).nullish(),
  lineas: z
    .array(
      lineaBase.extend({
        precioUnitario: precio,
        /** Servicio o gasto sin recepción: se factura directamente contra el pedido. */
        exigeRecepcion: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(200),
});
export type PedidoLineasCreateInput = z.input<typeof pedidoLineasCreateSchema>;

export const recepcionCreateSchema = z.object({
  fecha,
  /** Número del albarán del proveedor (la recepción lo registra validado). */
  albaranNumero: z.string().trim().min(1).max(60),
  /** Almacén de entrada del material de stock (sin él, no entra en almacén). */
  almacenId: z.string().uuid().nullish(),
  lineas: z
    .array(
      z.object({
        lineaId: z.string().uuid(),
        cantidad,
        lotes: lotesIndicadosSchema.optional(),
      }),
    )
    .min(1)
    .max(200),
});
export type RecepcionCreateInput = z.input<typeof recepcionCreateSchema>;

/** Verificación de factura contra pedido (MIRO): crea la factura en borrador. */
export const facturaPedidoCreateSchema = z.object({
  invoiceNumber: z.string().trim().min(1).max(60),
  issueDate: fecha,
  dueDate: fecha.nullish(),
  lineas: z
    .array(
      z.object({
        lineaId: z.string().uuid(),
        cantidad,
        precioUnitario: precio,
        vatPct: z.number().finite().min(0).max(100).default(21),
      }),
    )
    .min(1)
    .max(200),
});
export type FacturaPedidoCreateInput = z.input<
  typeof facturaPedidoCreateSchema
>;

/* ───────────────────────────── DTOs ───────────────────────────── */

export interface LineaSolicitudDto {
  id: string;
  tipo: TipoLineaCompra;
  articuloId: string | null;
  descripcion: string;
  unidad: string;
  cantidad: number;
  precioEstimado: number | null;
  phaseId: string | null;
}

export interface SolicitudCompraDto {
  id: string;
  numero: string;
  projectId: string;
  projectCode: string;
  titulo: string;
  estado: EstadoSolicitudCompra;
  necesariaEl: string | null;
  solicitanteId: string | null;
  aprobadorId: string | null;
  aprobadaEn: string | null;
  motivoRechazo: string | null;
  importeEstimado: number;
  notas: string | null;
  lineas: LineaSolicitudDto[];
  /** Pedido o petición en que se convirtió. */
  pedidoId: string | null;
  peticionId: string | null;
  version: number;
  creadaEn: string;
}

export interface PeticionOfertaDto {
  id: string;
  numero: string;
  projectId: string;
  solicitudId: string | null;
  titulo: string;
  estado: EstadoPeticionOferta;
  fechaLimite: string | null;
  lineas: {
    id: string;
    tipo: TipoLineaCompra;
    articuloId: string | null;
    descripcion: string;
    unidad: string;
    cantidad: number;
    phaseId: string | null;
  }[];
  proveedores: {
    contactId: string;
    contactName: string;
    ofertada: boolean;
    plazoDias: number | null;
    validaHasta: string | null;
    condiciones: string | null;
  }[];
  comparativa: ComparativaDto;
  pedidos: string[];
  version: number;
}

export interface LineaPedidoDto extends EstadoLineaPedido {
  id: string;
  numero: number;
  tipo: TipoLineaCompra;
  articuloId: string | null;
  descripcion: string;
  unidad: string;
  cantidad: number;
  precioUnitario: number;
  phaseId: string | null;
  exigeRecepcion: boolean;
}

export interface PedidoCompraDetalleDto {
  id: string;
  numero: string;
  projectId: string;
  contactId: string;
  contactName: string;
  estado: string;
  fecha: string;
  importe: number;
  tolerancias: {
    precioPct: number;
    precioImporte: number;
    cantidadPct: number;
  };
  solicitudId: string | null;
  peticionId: string | null;
  lineas: LineaPedidoDto[];
  recepciones: {
    id: string;
    fecha: string;
    albaranId: string;
    albaranNumero: string;
    almacenId: string | null;
    importe: number;
    lineas: {
      lineaId: string;
      cantidad: number;
      importe: number;
      movimientoStockId: string | null;
    }[];
  }[];
  facturas: {
    invoiceId: string;
    invoiceNumber: string;
    estado: string;
    importe: number;
  }[];
  version: number;
}

export interface CuadreFacturaDto {
  invoiceId: string;
  invoiceNumber: string;
  pedidoId: string;
  estadoFactura: string;
  bloqueada: boolean;
  lineas: CuadreLineaDto[];
}
