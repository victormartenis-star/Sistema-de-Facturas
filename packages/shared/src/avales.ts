/**
 * Avales bancarios y garantías de obra, al estilo de SAP Treasury (Bank
 * Guarantees) y de los Project Contracts / Bonds de Oracle.
 *
 * Un aval puede ser **emitido** (el banco garantiza a un tercero —cliente,
 * administración— una obligación nuestra: definitiva, anticipo, buena
 * ejecución, licitación) o **recibido** (un subcontratista o proveedor nos
 * garantiza la suya). Mientras está vivo es un riesgo contingente: no hay
 * asiento de balance (se informa en la memoria), solo de su coste
 * (comisiones, 6260 a 5720) y, si llega, de su ejecución (emitido: 6780 a
 * 5720; recibido: 5720 a 7780), ambos imputados a la obra.
 *
 * Ciclo: vigente → liberado_parcial (liberaciones o ejecuciones parciales) →
 * liberado / ejecutado (saldo vivo 0) o vencido; anulado solo si se dio de
 * alta por error y no tiene movimientos. Reglas puras en `calculo.ts`
 * (`aplicarMovimientoAval`, `comisionAval`, `resumenAvales`, asientos).
 */

import { z } from 'zod';
import type {
  DireccionAval,
  EstadoAval,
  ResumenAvalesCalculo,
  SaldoAval,
  TramoDevengo,
} from './calculo';
import type { Transiciones } from './maquina-estados';

export type { DireccionAval, EstadoAval } from './calculo';

export const TIPOS_AVAL = [
  'garantia_definitiva',
  'garantia_provisional',
  'anticipo',
  'buena_ejecucion',
  'oferta_licitacion',
  'retencion_garantia',
  'otro',
] as const;
export type TipoAval = (typeof TIPOS_AVAL)[number];

export const TIPO_AVAL_LABELS: Record<TipoAval, string> = {
  garantia_definitiva: 'Garantía definitiva',
  garantia_provisional: 'Garantía provisional',
  anticipo: 'Devolución de anticipo',
  buena_ejecucion: 'Buena ejecución',
  oferta_licitacion: 'Oferta / licitación',
  retencion_garantia: 'Sustitución de retención',
  otro: 'Otro',
};

export const DIRECCIONES_AVAL = [
  'emitido',
  'recibido',
] as const satisfies readonly DireccionAval[];

export const DIRECCION_AVAL_LABELS: Record<DireccionAval, string> = {
  emitido: 'Emitido (a nuestro cargo)',
  recibido: 'Recibido (de terceros)',
};

export const ESTADOS_AVAL = [
  'vigente',
  'liberado_parcial',
  'liberado',
  'ejecutado',
  'vencido',
  'anulado',
] as const satisfies readonly EstadoAval[];

export const ESTADO_AVAL_LABELS: Record<EstadoAval, string> = {
  vigente: 'Vigente',
  liberado_parcial: 'Reducido parcialmente',
  liberado: 'Liberado',
  ejecutado: 'Ejecutado',
  vencido: 'Vencido',
  anulado: 'Anulado',
};

/** Estados con saldo vivo (exposición). */
export const ESTADOS_AVAL_VIVOS = ['vigente', 'liberado_parcial'] as const;

/**
 * Liberaciones y ejecuciones parciales mantienen el aval en
 * `liberado_parcial` (transición a sí mismo); al agotarse el saldo pasa a
 * `liberado` o `ejecutado`. Solo un aval sin movimientos se anula.
 */
export const AVAL_TRANSITIONS: Transiciones<EstadoAval> = {
  vigente: ['liberado_parcial', 'liberado', 'ejecutado', 'vencido', 'anulado'],
  liberado_parcial: ['liberado_parcial', 'liberado', 'ejecutado', 'vencido'],
  liberado: [],
  ejecutado: [],
  vencido: [],
  anulado: [],
};

export const TIPOS_MOVIMIENTO_AVAL = [
  'alta',
  'liberacion',
  'ejecucion',
  'prorroga',
  'comision',
  'vencimiento',
  'anulacion',
] as const;
export type TipoMovimientoAval = (typeof TIPOS_MOVIMIENTO_AVAL)[number];

export const TIPO_MOVIMIENTO_AVAL_LABELS: Record<TipoMovimientoAval, string> = {
  alta: 'Alta',
  liberacion: 'Liberación',
  ejecucion: 'Ejecución',
  prorroga: 'Prórroga',
  comision: 'Comisión',
  vencimiento: 'Vencimiento',
  anulacion: 'Anulación',
};

/** Cuentas PGC que mueve el módulo (el aval vivo no tiene asiento). */
export const CUENTAS_AVAL = {
  comision: '6260',
  gastoEjecucion: '6780',
  ingresoEjecucion: '7780',
  bancos: '5720',
} as const;

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: AAAA-MM-DD');

const importe = z
  .number()
  .finite()
  .max(9_999_999_999.99)
  .refine(
    (n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6,
    'Como máximo dos decimales',
  );
const importePositivo = importe.refine(
  (n) => n > 0,
  'El importe debe ser mayor que cero',
);

const tasa = z
  .number()
  .finite()
  .min(0)
  .max(100)
  .refine(
    (n) => Math.abs(Math.round(n * 10_000) - n * 10_000) < 1e-6,
    'Como máximo cuatro decimales',
  );

const motivo = z.string().trim().min(3).max(240);

/** Campos del alta sin las reglas cruzadas (para `inputSchema` del MCP). */
export const avalCreateObjectSchema = z.object({
  /** Número o referencia del aval en la entidad (único por empresa y entidad). */
  referencia: z.string().trim().min(1).max(60),
  tipo: z.enum(TIPOS_AVAL),
  direccion: z.enum(DIRECCIONES_AVAL),
  /** Entidad avalista (banco o aseguradora de caución). */
  entidad: z.string().trim().min(1).max(120),
  projectId: z.string().uuid().nullish(),
  /** Beneficiario (emitido) o avalado (recibido). */
  contactId: z.string().uuid().nullish(),
  contratoObraId: z.string().uuid().nullish(),
  certificationId: z.string().uuid().nullish(),
  /** Cuenta propia con la que se liquidan comisiones y ejecuciones. */
  bankAccountId: z.string().uuid().nullish(),
  importe: importePositivo,
  fechaEmision: fecha,
  /** Null: aval indefinido (hasta su cancelación). */
  fechaVencimiento: fecha.nullish(),
  /** Comisión de riesgo anual (%) sobre el saldo vivo (solo emitidos). */
  tasaComisionAnualPct: tasa.nullish(),
  /** Cada cuántos meses se liquida la comisión (1, 3, 6, 12). */
  periodicidadComisionMeses: z.number().int().min(1).max(12).nullish(),
  notas: z.string().trim().max(1000).nullish(),
});

export const avalCreateSchema = avalCreateObjectSchema
  .refine((a) => !a.fechaVencimiento || a.fechaVencimiento >= a.fechaEmision, {
    path: ['fechaVencimiento'],
    message: 'El vencimiento no puede ser anterior a la emisión',
  })
  .refine(
    (a) =>
      a.direccion === 'emitido' || (a.tasaComisionAnualPct ?? null) === null,
    {
      path: ['tasaComisionAnualPct'],
      message: 'Solo los avales emitidos devengan comisión a nuestro cargo',
    },
  );
export type AvalCreateInput = z.input<typeof avalCreateSchema>;

/** Datos descriptivos editables (PATCH con If-Match); lo económico va por acciones. */
export const avalUpdateSchema = z
  .object({
    entidad: z.string().trim().min(1).max(120).optional(),
    contactId: z.string().uuid().nullish(),
    contratoObraId: z.string().uuid().nullish(),
    certificationId: z.string().uuid().nullish(),
    bankAccountId: z.string().uuid().nullish(),
    tasaComisionAnualPct: tasa.nullish(),
    /**
     * Desde qué día rige la nueva tasa (por defecto, hoy). El devengo de un
     * mes con cambio de tasa se prorratea por tramos.
     */
    tasaVigenteDesde: fecha.optional(),
    periodicidadComisionMeses: z.number().int().min(1).max(12).nullish(),
    notas: z.string().trim().max(1000).nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Indica al menos un campo a modificar',
  });
export type AvalUpdateInput = z.input<typeof avalUpdateSchema>;

/** Liberación (devolución del aval por el beneficiario). Sin importe: total. */
export const avalLiberarSchema = z.object({
  fecha,
  importe: importePositivo.nullish(),
  motivo,
});
export type AvalLiberarInput = z.input<typeof avalLiberarSchema>;

export const LIQUIDACIONES_EJECUCION_AVAL = [
  'tesoreria',
  'financiacion',
] as const;
export type LiquidacionEjecucionAval =
  (typeof LIQUIDACIONES_EJECUCION_AVAL)[number];

export const LIQUIDACION_EJECUCION_AVAL_LABELS: Record<
  LiquidacionEjecucionAval,
  string
> = {
  tesoreria: 'Cargo en cuenta (5720)',
  financiacion: 'Financiada por el banco (5200)',
};

/**
 * Ejecución o incautación. Sin importe: total. Se contabiliza en `fecha`.
 * Un aval emitido puede liquidarse con cargo en cuenta (5720) o financiado
 * por el banco como préstamo a corto plazo (5200).
 */
export const avalEjecutarSchema = z.object({
  fecha,
  importe: importePositivo.nullish(),
  motivo,
  liquidacion: z.enum(LIQUIDACIONES_EJECUCION_AVAL).default('tesoreria'),
});
export type AvalEjecutarInput = z.input<typeof avalEjecutarSchema>;

export const avalProrrogaSchema = z.object({
  fecha,
  nuevaFechaVencimiento: fecha,
  motivo: motivo.optional(),
});
export type AvalProrrogaInput = z.input<typeof avalProrrogaSchema>;

/**
 * Comisión liquidada por el banco. Sin importe se calcula con la tasa del aval
 * sobre el saldo vivo por `meses` (por defecto, su periodicidad).
 */
export const avalComisionSchema = z.object({
  fecha,
  importe: importePositivo.nullish(),
  meses: z.number().int().min(1).max(12).nullish(),
});
export type AvalComisionInput = z.input<typeof avalComisionSchema>;

export const avalVencerSchema = z.object({ fecha });
export type AvalVencerInput = z.input<typeof avalVencerSchema>;

export const avalAnularSchema = z.object({ motivo });
export type AvalAnularInput = z.input<typeof avalAnularSchema>;

/* ─────────────────── devengo periódico de comisiones ─────────────────── */

const periodo = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Formato esperado: AAAA-MM');

/** Devengo de un mes para todos los avales emitidos vivos con tasa (o uno). */
/**
 * Fecha de referencia para decidir qué meses están terminados (por defecto,
 * hoy). No puede ser futura: sirve para reprocesos y pruebas deterministas.
 */
const fechaReferencia = fecha.optional();

export const devengoAvalesSchema = z.object({
  periodo,
  avalId: z.string().uuid().optional(),
  fechaReferencia,
});
export type DevengoAvalesInput = z.input<typeof devengoAvalesSchema>;

export const devengoAvalesQuerySchema = z.object({
  periodo: periodo.optional(),
  avalId: z.string().uuid().optional(),
});
export type DevengoAvalesQuery = z.infer<typeof devengoAvalesQuerySchema>;

export const devengoAnularSchema = z.object({ motivo });
export type DevengoAnularInput = z.input<typeof devengoAnularSchema>;

export interface DevengoAvalDto {
  id: string;
  avalId: string;
  referencia: string;
  periodo: string;
  desde: string;
  hasta: string;
  dias: number;
  saldoBase: number;
  tasaAnualPct: number;
  importe: number;
  estado: 'contabilizado' | 'anulado';
  asientoId: string | null;
  contraAsientoId: string | null;
  motivoAnulacion: string | null;
  /** Tramos de saldo constante del mes (vacío en devengos anteriores a la 0063). */
  tramos: TramoDevengo[];
  version: number;
}

/**
 * Devengo automático: todos los meses cerrados (anteriores al actual) hasta
 * `hasta` que falten, para cada aval. Idempotente: un mes ya devengado se
 * omite. Lo ejecuta también la tarea programada del día 1.
 */
export const devengoAutomaticoSchema = z.object({
  hasta: periodo.optional(),
  fechaReferencia,
});

/** Historial de tasas de comisión de un aval (la de cada fecha rige desde ese día). */
export interface TasaAvalDto {
  fecha: string;
  tasaAnualPct: number | null;
}
export type DevengoAutomaticoInput = z.input<typeof devengoAutomaticoSchema>;

export const DISPAROS_DEVENGO = ['manual', 'automatico'] as const;
export type DisparoDevengo = (typeof DISPAROS_DEVENGO)[number];

export interface EjecucionDevengoDto {
  id: string;
  periodo: string;
  disparo: DisparoDevengo;
  contabilizados: number;
  importe: number;
  omitidos: number;
  ejecutadoEn: string;
}

export interface ResultadoDevengoAutomaticoDto {
  desde: string | null;
  hasta: string;
  periodos: ResultadoDevengoAvalesDto[];
  contabilizados: number;
  importe: number;
  /** Lote guardado de esta ejecución (null si no hay avales con tasa). */
  loteId: string | null;
  /** Meses omitidos o saltados, agrupados en rangos consecutivos por motivo. */
  avisos: AvisoDevengoDto[];
  /** Avisos de nivel `alerta` (requieren acción). */
  alertas: number;
}

export interface ResultadoDevengoAvalesDto {
  periodo: string;
  contabilizados: number;
  importe: number;
  omitidos: {
    avalId: string;
    referencia: string;
    motivo: string;
    /** Código RFC 7807 del rechazo (FISCAL_PERIOD_CLOSED…). */
    codigo?: string;
  }[];
  /** Avales candidatos del mes (emitidos con tasa que estuvieron vivos). */
  candidatos?: number;
  /** Candidatos ya devengados antes (idempotencia: no se repiten). */
  yaDevengados?: number;
  /** Registro de la ejecución del mes (`GET /avales/devengos/ejecuciones`). */
  ejecucionId?: string;
}

/* ─────────────── avisos de meses omitidos en el devengo automático ───────────────
 * Al estilo de SAP Accrual Engine (log de la ejecución) / Oracle Subledger
 * Accounting (informe de excepciones): cada mes que el devengo automático o la
 * tarea programada no devenga se explica con un motivo. Los meses ya devengados
 * o sin avales son informativos; un período o ejercicio cerrado, un rechazo o
 * un mes fuera de la ventana de recorrido son alertas que piden intervención.
 */

export const MOTIVOS_OMISION_DEVENGO = [
  'ya_devengado',
  'sin_avales',
  'periodo_cerrado',
  'ejercicio_cerrado',
  'rechazado',
  'fuera_de_ventana',
] as const;
export type MotivoOmisionDevengo = (typeof MOTIVOS_OMISION_DEVENGO)[number];

export const MOTIVO_OMISION_DEVENGO_LABELS: Record<
  MotivoOmisionDevengo,
  string
> = {
  ya_devengado: 'Ya devengado',
  sin_avales: 'Sin avales vivos con comisión',
  periodo_cerrado: 'Período contable cerrado',
  ejercicio_cerrado: 'Ejercicio cerrado',
  rechazado: 'Rechazado',
  fuera_de_ventana: 'Fuera de la ventana del devengo automático',
};

export type NivelAvisoDevengo = 'info' | 'alerta';

export interface AvisoDevengoDto {
  desde: string;
  hasta: string;
  meses: number;
  motivo: MotivoOmisionDevengo;
  nivel: NivelAvisoDevengo;
  /** Casos aval × mes afectados (0 si no había avales). */
  casos: number;
  detalle: string;
}

/** Lo que el devengo automático sabe de cada mes recorrido. */
export interface MesDevengoClasificable {
  periodo: string;
  candidatos: number;
  contabilizados: number;
  yaDevengados: number;
  omitidos: readonly { codigo?: string }[];
}

const MOTIVO_POR_CODIGO: Record<string, MotivoOmisionDevengo> = {
  FISCAL_PERIOD_CLOSED: 'periodo_cerrado',
  FISCAL_YEAR_CLOSED: 'ejercicio_cerrado',
};

/**
 * Motivo por el que un mes no se devengó por completo, o null si se devengó
 * sin incidencias. Un mes con rechazos es alerta aunque devengara otros avales.
 */
export function motivoOmisionMes(
  m: MesDevengoClasificable,
): { motivo: MotivoOmisionDevengo; casos: number } | null {
  if (m.omitidos.length > 0) {
    const motivos = m.omitidos.map(
      (o) => MOTIVO_POR_CODIGO[o.codigo ?? ''] ?? 'rechazado',
    );
    // Prioridad: ejercicio cerrado > período cerrado > otros rechazos.
    const motivo = motivos.includes('ejercicio_cerrado')
      ? 'ejercicio_cerrado'
      : motivos.includes('periodo_cerrado')
        ? 'periodo_cerrado'
        : 'rechazado';
    return { motivo, casos: m.omitidos.length };
  }
  if (m.contabilizados > 0) return null;
  if (m.yaDevengados > 0)
    return { motivo: 'ya_devengado', casos: m.yaDevengados };
  return { motivo: 'sin_avales', casos: 0 };
}

const nivelDe = (m: MotivoOmisionDevengo): NivelAvisoDevengo =>
  m === 'ya_devengado' || m === 'sin_avales' ? 'info' : 'alerta';

const ACCION_AVISO: Record<MotivoOmisionDevengo, string> = {
  ya_devengado: 'no se repite (idempotente)',
  sin_avales: 'no había nada que devengar',
  periodo_cerrado: 'reabre el período o devenga en el siguiente abierto',
  ejercicio_cerrado: 'el ejercicio está cerrado: revisa el cierre',
  rechazado: 'revisa el motivo de cada aval',
  fuera_de_ventana: 'devéngalos a mano con POST /avales/devengos',
};

/**
 * Avisos de una ejecución del devengo automático: clasifica cada mes
 * recorrido (en orden) y los meses anteriores a la ventana con avales sin
 * devengar, y agrupa meses consecutivos con el mismo motivo en un rango.
 * Determinista: depende solo de la entrada.
 */
export function avisosDevengoAutomatico(
  meses: readonly MesDevengoClasificable[],
  fueraDeVentana: readonly { periodo: string; pendientes: number }[] = [],
): AvisoDevengoDto[] {
  const items: {
    periodo: string;
    motivo: MotivoOmisionDevengo;
    casos: number;
  }[] = [];
  for (const f of fueraDeVentana) {
    if (f.pendientes > 0) {
      items.push({
        periodo: f.periodo,
        motivo: 'fuera_de_ventana',
        casos: f.pendientes,
      });
    }
  }
  for (const m of meses) {
    const r = motivoOmisionMes(m);
    if (r) items.push({ periodo: m.periodo, ...r });
  }
  items.sort((a, b) =>
    a.periodo < b.periodo ? -1 : a.periodo > b.periodo ? 1 : 0,
  );
  const avisos: AvisoDevengoDto[] = [];
  for (const it of items) {
    const ult = avisos[avisos.length - 1];
    if (
      ult &&
      ult.motivo === it.motivo &&
      mesSiguiente(ult.hasta) === it.periodo
    ) {
      ult.hasta = it.periodo;
      ult.meses += 1;
      ult.casos += it.casos;
    } else {
      avisos.push({
        desde: it.periodo,
        hasta: it.periodo,
        meses: 1,
        motivo: it.motivo,
        nivel: nivelDe(it.motivo),
        casos: it.casos,
        detalle: '',
      });
    }
  }
  for (const a of avisos) {
    const rango = a.meses === 1 ? a.desde : `${a.desde} a ${a.hasta}`;
    const casos = a.casos > 0 ? ` (${a.casos} aval·mes)` : '';
    a.detalle = `${rango}: ${MOTIVO_OMISION_DEVENGO_LABELS[a.motivo]}${casos}; ${ACCION_AVISO[a.motivo]}.`;
  }
  return avisos;
}

function mesSiguiente(periodo: string): string {
  const [y, m] = periodo.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Lote de una ejecución del devengo automático (endpoint o tarea programada). */
export interface LoteDevengoDto {
  id: string;
  disparo: DisparoDevengo;
  fechaReferencia: string;
  desde: string | null;
  hasta: string;
  contabilizados: number;
  importe: number;
  avisos: AvisoDevengoDto[];
  alertas: number;
  ejecutadoEn: string;
}

export const avalesQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  estado: z.enum(ESTADOS_AVAL).optional(),
  tipo: z.enum(TIPOS_AVAL).optional(),
  direccion: z.enum(DIRECCIONES_AVAL).optional(),
  /** Solo avales vivos (vigente o reducido). */
  vivos: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  /** Vivos que vencen en los próximos N días (incluye ya vencidos sin cerrar). */
  venceEnDias: z.coerce.number().int().min(0).max(3650).optional(),
  q: z.string().trim().max(60).optional(),
  /** Fecha de referencia (por defecto, hoy). */
  hoy: fecha.optional(),
});
export type AvalesQuery = z.infer<typeof avalesQuerySchema>;

export const avalesResumenQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  dias: z.coerce.number().int().min(0).max(3650).default(30),
  hoy: fecha.optional(),
});
export type AvalesResumenQuery = z.infer<typeof avalesResumenQuerySchema>;

/** Avisa en la bandeja de los avales vivos que vencen en los próximos días. */
export const avalesAvisosSchema = z.object({
  dias: z.number().int().min(0).max(365).default(30),
  hoy: fecha.optional(),
});
export type AvalesAvisosInput = z.input<typeof avalesAvisosSchema>;

/* ────────────────────────────── DTOs ────────────────────────────── */

export interface AvalDto extends SaldoAval {
  id: string;
  referencia: string;
  tipo: TipoAval;
  direccion: DireccionAval;
  entidad: string;
  projectId: string | null;
  projectCodigo: string | null;
  contactId: string | null;
  contactNombre: string | null;
  contratoObraId: string | null;
  certificationId: string | null;
  bankAccountId: string | null;
  fechaEmision: string;
  fechaVencimiento: string | null;
  /** Días hasta el vencimiento respecto a hoy (negativo si pasó; null si indefinido). */
  diasHastaVencimiento: number | null;
  tasaComisionAnualPct: number | null;
  periodicidadComisionMeses: number | null;
  comisiones: number;
  /** Comisión devengada (6260 a 4100) y la parte ya liquidada por el banco. */
  comisionDevengada: number;
  devengoLiquidado: number;
  estado: EstadoAval;
  motivo: string | null;
  notas: string | null;
  version: number;
}

/* ─────────────────────── líneas de avales por entidad ─────────────────────── */

const limite = importe.refine((n) => n >= 0, 'El límite no puede ser negativo');

export const lineaAvalCreateSchema = z.object({
  /** Debe coincidir con la `entidad` de los avales que consumen la línea. */
  entidad: z.string().trim().min(1).max(120),
  limite,
  fechaVencimiento: fecha.nullish(),
  notas: z.string().trim().max(1000).nullish(),
});
export type LineaAvalCreateInput = z.input<typeof lineaAvalCreateSchema>;

export const lineaAvalUpdateSchema = z
  .object({
    limite: limite.optional(),
    activa: z.boolean().optional(),
    fechaVencimiento: fecha.nullish(),
    notas: z.string().trim().max(1000).nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Indica al menos un campo a modificar',
  });
export type LineaAvalUpdateInput = z.input<typeof lineaAvalUpdateSchema>;

export interface LineaAvalDto {
  id: string;
  entidad: string;
  limite: number;
  /** Saldo vivo de los avales emitidos de la entidad. */
  dispuesto: number;
  disponible: number;
  usoPct: number | null;
  activa: boolean;
  fechaVencimiento: string | null;
  notas: string | null;
  version: number;
}

export interface MovimientoAvalDto {
  id: string;
  tipo: TipoMovimientoAval;
  fecha: string;
  importe: number;
  /** Ejecución financiada por el banco (5200) en lugar de cargo en cuenta. */
  financiada: boolean;
  /** Saldo vivo tras el movimiento. */
  saldoVivo: number;
  fechaVencimiento: string | null;
  motivo: string | null;
  asientoId: string | null;
  createdAt: string;
}

export interface AvalDetalleDto extends AvalDto {
  movimientos: MovimientoAvalDto[];
  /** Historial de tasas de comisión (desde la 0064). */
  tasas: TasaAvalDto[];
}

export interface ResumenAvalesDto extends ResumenAvalesCalculo {
  hoy: string;
  dias: number;
}

export interface ResultadoAvisosAvalesDto {
  hoy: string;
  dias: number;
  /** Avisos nuevos (los ya enviados para ese vencimiento no se repiten). */
  avisados: number;
  revisados: number;
}
