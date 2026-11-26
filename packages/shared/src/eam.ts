/**
 * Enterprise Asset Management de maquinaria de obra (SAP S/4HANA PM / EAM,
 * Oracle Maintenance Management), encima del maestro `equipos` que ya
 * existía:
 *
 * - Ficha ampliada con código, nº de serie y jerarquía conjunto/componente
 *   (sin ciclos), contadores de horas y kilómetros (sin retrocesos salvo
 *   corrección motivada) y asignación a obra sin solapes.
 * - Planes preventivos por calendario y/o contador, con vencimiento y aviso
 *   de proximidad; órdenes de trabajo preventivas y correctivas con su ciclo,
 *   paradas y coste (mano de obra, repuestos, externo).
 * - Disponibilidad, MTBF/MTTR y coste de explotación (TCO) por equipo y obra.
 *   La amortización se lee de lo ya amortizado (no se vuelve a asentar) y el
 *   coste de uso imputado a obra es el de los partes de maquinaria (que ya
 *   está en el control de costes): el TCO mide la cobertura de esa tarifa,
 *   no añade cargos a la obra.
 *
 * Funciones puras, sin base de datos y sin reloj. Horas y kilómetros en
 * centésimas y dinero en céntimos, con BigInt.
 */

import { z } from 'zod';
import { addDays, daysBetween } from './calculo';
import {
  fromCents,
  mulDivRound,
  scaledToNumeric,
  toCents,
  toScaled,
} from './dinero';
import type { Transiciones } from './maquina-estados';

type Importe = string | number;

export class ErrorEam extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ErrorEam';
  }
}

/** Cantidad con 2 decimales (horas, km) a centésimas. */
const c2 = (v: Importe | null | undefined) => toScaled(v ?? 0, 2);
const num2 = (v: bigint) => Number(scaledToNumeric(v, 2));

/* ───────────────────────────── jerarquía ───────────────────────────── */

export const MAX_NIVELES_JERARQUIA = 5;

/**
 * Valida colgar `id` de `padreId`: sin ciclos (el padre no puede ser el
 * propio equipo ni un descendiente) y sin superar 5 niveles.
 * `padres` mapea cada equipo con su padre actual.
 */
export function validarJerarquia(p: {
  id: string;
  padreId: string | null;
  padres: Readonly<Record<string, string | null>>;
  /** Niveles por debajo de `id` (su subárbol), para no superar el máximo. */
  profundidadSubarbol?: number;
}): void {
  if (!p.padreId) return;
  if (p.padreId === p.id) {
    throw new ErrorEam(
      'EAM_HIERARCHY_CYCLE',
      'Un equipo no puede ser componente de sí mismo',
    );
  }
  let nivel = 1;
  let actual: string | null = p.padreId;
  const vistos = new Set<string>();
  while (actual) {
    if (actual === p.id || vistos.has(actual)) {
      throw new ErrorEam(
        'EAM_HIERARCHY_CYCLE',
        'La jerarquía formaría un ciclo: el padre es un componente de este equipo',
      );
    }
    vistos.add(actual);
    nivel++;
    actual = p.padres[actual] ?? null;
  }
  if (nivel + (p.profundidadSubarbol ?? 0) > MAX_NIVELES_JERARQUIA) {
    throw new ErrorEam(
      'EAM_HIERARCHY_TOO_DEEP',
      `La jerarquía no puede superar ${MAX_NIVELES_JERARQUIA} niveles`,
    );
  }
}

/* ───────────────────────────── contadores ───────────────────────────── */

export const TIPOS_CONTADOR = ['horas', 'km'] as const;
export type TipoContador = (typeof TIPOS_CONTADOR)[number];

export const ORIGENES_LECTURA = ['manual', 'orden', 'correccion'] as const;
export type OrigenLectura = (typeof ORIGENES_LECTURA)[number];

/** Máximo de horas de motor por día natural (plausibilidad). */
const HORAS_MAX_DIA = 24n;

/**
 * Nueva lectura de un contador. No retrocede ni se fecha antes de la última
 * salvo corrección motivada; en horas, el avance no puede superar 24 h por
 * día transcurrido (lectura imposible). Devuelve el incremento (centésimas,
 * negativo solo en corrección).
 */
export function validarLectura(p: {
  tipo: TipoContador;
  anterior: Importe | null;
  fechaAnterior: string | null;
  valor: Importe;
  fecha: string;
  hoy: string;
  correccion?: boolean;
  motivo?: string | null;
}): bigint {
  const nuevo = c2(p.valor);
  if (nuevo < 0n)
    throw new ErrorEam(
      'EAM_COUNTER_INVALID',
      'El contador no puede ser negativo',
    );
  if (p.fecha > p.hoy)
    throw new ErrorEam(
      'EAM_COUNTER_DATE_INVALID',
      'La lectura no puede ser futura',
    );
  if (p.correccion) {
    if (!p.motivo || p.motivo.trim().length < 3) {
      throw new ErrorEam(
        'EAM_COUNTER_REASON_REQUIRED',
        'Una corrección del contador exige motivo',
      );
    }
    return nuevo - c2(p.anterior);
  }
  if (p.anterior === null || p.fechaAnterior === null) return nuevo;
  const anterior = c2(p.anterior);
  if (p.fecha < p.fechaAnterior) {
    throw new ErrorEam(
      'EAM_COUNTER_DATE_INVALID',
      `La lectura es anterior a la última (${p.fechaAnterior}): usa una corrección`,
    );
  }
  if (nuevo < anterior) {
    throw new ErrorEam(
      'EAM_COUNTER_BACKWARDS',
      `El contador no puede retroceder de ${scaledToNumeric(anterior, 2)} a ${scaledToNumeric(nuevo, 2)}: usa una corrección`,
    );
  }
  const incremento = nuevo - anterior;
  if (p.tipo === 'horas') {
    // Lecturas por día: entre el día A y el B pudo trabajar parte de A, los
    // intermedios y parte de B → como mucho 24 h × (días + 1).
    const dias = BigInt(daysBetween(p.fechaAnterior, p.fecha) + 1);
    if (incremento > dias * HORAS_MAX_DIA * 100n) {
      throw new ErrorEam(
        'EAM_COUNTER_IMPLAUSIBLE',
        `Avance imposible: ${scaledToNumeric(incremento, 2)} h en ${dias} día(s)`,
      );
    }
  }
  return incremento;
}

/* ───────────────────────────── asignación a obra ───────────────────────────── */

export interface PeriodoAsignacion {
  id?: string;
  desde: string;
  /** null = sigue asignado. */
  hasta: string | null;
}

/** ¿Se pisan dos periodos (extremos incluidos)? */
export function solapan(a: PeriodoAsignacion, b: PeriodoAsignacion): boolean {
  const finA = a.hasta ?? '9999-12-31';
  const finB = b.hasta ?? '9999-12-31';
  return a.desde <= finB && b.desde <= finA;
}

/** Un equipo está en una sola obra a la vez. */
export function validarAsignacion(
  nueva: PeriodoAsignacion,
  existentes: readonly PeriodoAsignacion[],
): void {
  if (nueva.hasta && nueva.hasta < nueva.desde) {
    throw new ErrorEam(
      'EAM_ASSIGNMENT_DATES',
      'El fin de la asignación es anterior al inicio',
    );
  }
  const pisa = existentes.find((e) => e.id !== nueva.id && solapan(nueva, e));
  if (pisa) {
    throw new ErrorEam(
      'EAM_ASSIGNMENT_OVERLAP',
      `El equipo ya está asignado del ${pisa.desde} al ${pisa.hasta ?? 'sin fin'}`,
    );
  }
}

/** Días de una asignación dentro de [desde, hasta] (extremos incluidos). */
export function diasEnRango(
  a: PeriodoAsignacion,
  desde: string,
  hasta: string,
): number {
  const ini = a.desde > desde ? a.desde : desde;
  const fin = (a.hasta ?? hasta) < hasta ? (a.hasta ?? hasta) : hasta;
  return fin < ini ? 0 : daysBetween(ini, fin) + 1;
}

/* ───────────────────────────── preventivo ───────────────────────────── */

export const TIPOS_PLAN = ['preventiva', 'itv', 'revision'] as const;
export type TipoPlan = (typeof TIPOS_PLAN)[number];

export const ESTADOS_VENCIMIENTO = ['al_dia', 'proximo', 'vencido'] as const;
export type EstadoVencimiento = (typeof ESTADOS_VENCIMIENTO)[number];

export interface IntervalosPlan {
  periodicidadDias?: number | null;
  intervaloHoras?: Importe | null;
  intervaloKm?: Importe | null;
  avisoDias?: number | null;
  avisoHoras?: Importe | null;
  avisoKm?: Importe | null;
}

/** Al menos un intervalo (calendario, horas o km), positivo. */
export function validarPlan(p: IntervalosPlan): void {
  const dias = p.periodicidadDias ?? null;
  const horas =
    p.intervaloHoras === null || p.intervaloHoras === undefined
      ? null
      : c2(p.intervaloHoras);
  const km =
    p.intervaloKm === null || p.intervaloKm === undefined
      ? null
      : c2(p.intervaloKm);
  if (dias === null && horas === null && km === null) {
    throw new ErrorEam(
      'EAM_PLAN_INTERVAL_REQUIRED',
      'El plan necesita periodicidad en días, horas o kilómetros',
    );
  }
  if (
    (dias !== null && (!Number.isInteger(dias) || dias < 1)) ||
    (horas !== null && horas <= 0n) ||
    (km !== null && km <= 0n)
  ) {
    throw new ErrorEam(
      'EAM_PLAN_INTERVAL_REQUIRED',
      'Los intervalos del plan deben ser positivos',
    );
  }
}

export interface EstadoPreventivo {
  estado: EstadoVencimiento;
  fechaProxima: string | null;
  horasProximas: number | null;
  kmProximos: number | null;
  diasRestantes: number | null;
  horasRestantes: number | null;
  kmRestantes: number | null;
  /** Qué criterio vence antes: fecha, horas o km. */
  criterio: 'fecha' | 'horas' | 'km' | null;
}

/**
 * Próximo vencimiento de un plan desde su última ejecución: el primero de
 * los criterios que venza (fecha, horas o km). `proximo` si falta menos que
 * el aviso de cualquiera de ellos.
 */
export function estadoPreventivo(p: {
  plan: IntervalosPlan;
  ultima: { fecha: string | null; horas: Importe | null; km: Importe | null };
  actual: { horas: Importe; km: Importe };
  hoy: string;
}): EstadoPreventivo {
  validarPlan(p.plan);
  let estado: EstadoVencimiento = 'al_dia';
  let criterio: EstadoPreventivo['criterio'] = null;
  const peor = (e: EstadoVencimiento, c: EstadoPreventivo['criterio']) => {
    const rango = { al_dia: 0, proximo: 1, vencido: 2 };
    if (rango[e] > rango[estado]) {
      estado = e;
      criterio = c;
    }
  };
  let fechaProxima: string | null = null;
  let diasRestantes: number | null = null;
  if (p.plan.periodicidadDias) {
    // Sin ejecución previa, el plan vence ya (nunca se ha hecho).
    fechaProxima = p.ultima.fecha
      ? addDays(p.ultima.fecha, p.plan.periodicidadDias)
      : p.hoy;
    diasRestantes = daysBetween(p.hoy, fechaProxima);
    peor(
      diasRestantes <= 0
        ? 'vencido'
        : diasRestantes <= (p.plan.avisoDias ?? 15)
          ? 'proximo'
          : 'al_dia',
      'fecha',
    );
  }
  const porContador = (
    intervalo: Importe | null | undefined,
    ultima: Importe | null,
    actual: Importe,
    aviso: Importe | null | undefined,
    avisoDefecto: number,
    c: 'horas' | 'km',
  ) => {
    if (intervalo === null || intervalo === undefined)
      return { proximas: null, restantes: null };
    const proximas = c2(ultima) + c2(intervalo);
    const restantes = proximas - c2(actual);
    peor(
      restantes <= 0n
        ? 'vencido'
        : restantes <= c2(aviso ?? avisoDefecto)
          ? 'proximo'
          : 'al_dia',
      c,
    );
    return { proximas: num2(proximas), restantes: num2(restantes) };
  };
  const h = porContador(
    p.plan.intervaloHoras,
    p.ultima.horas,
    p.actual.horas,
    p.plan.avisoHoras,
    25,
    'horas',
  );
  const k = porContador(
    p.plan.intervaloKm,
    p.ultima.km,
    p.actual.km,
    p.plan.avisoKm,
    500,
    'km',
  );
  if (estado === 'al_dia') {
    // Al día: el criterio que antes vencerá (el de menor margen relativo no
    // es comparable entre unidades; se informa el primero con aviso).
    criterio = p.plan.periodicidadDias
      ? 'fecha'
      : p.plan.intervaloHoras
        ? 'horas'
        : 'km';
  }
  return {
    estado,
    fechaProxima,
    horasProximas: h.proximas,
    kmProximos: k.proximas,
    diasRestantes,
    horasRestantes: h.restantes,
    kmRestantes: k.restantes,
    criterio,
  };
}

/* ───────────────────────────── órdenes de trabajo ───────────────────────────── */

export const TIPOS_ORDEN_TRABAJO = [
  'preventiva',
  'correctiva',
  'itv',
  'revision',
] as const;
export type TipoOrdenTrabajo = (typeof TIPOS_ORDEN_TRABAJO)[number];

export const TIPO_ORDEN_TRABAJO_LABELS: Record<TipoOrdenTrabajo, string> = {
  preventiva: 'Preventiva',
  correctiva: 'Correctiva (avería)',
  itv: 'ITV / inspección reglamentaria',
  revision: 'Revisión',
};

export const PRIORIDADES_ORDEN = ['baja', 'media', 'alta', 'urgente'] as const;
export type PrioridadOrden = (typeof PRIORIDADES_ORDEN)[number];

export const ESTADOS_ORDEN_TRABAJO = [
  'abierta',
  'planificada',
  'en_curso',
  'cerrada',
  'cancelada',
] as const;
export type EstadoOrdenTrabajo = (typeof ESTADOS_ORDEN_TRABAJO)[number];

export const ESTADO_ORDEN_TRABAJO_LABELS: Record<EstadoOrdenTrabajo, string> = {
  abierta: 'Abierta (aviso)',
  planificada: 'Planificada',
  en_curso: 'En curso',
  cerrada: 'Cerrada',
  cancelada: 'Cancelada',
};

/** abierta → planificada → en curso → cerrada; se cancela antes de cerrarse. */
export const ORDEN_TRABAJO_TRANSITIONS: Transiciones<EstadoOrdenTrabajo> = {
  abierta: ['planificada', 'en_curso', 'cancelada'],
  planificada: ['en_curso', 'cancelada'],
  en_curso: ['cerrada', 'cancelada'],
  cerrada: [],
  cancelada: [],
};

export const ACCIONES_ORDEN = [
  'planificar',
  'iniciar',
  'cerrar',
  'cancelar',
] as const;
export type AccionOrden = (typeof ACCIONES_ORDEN)[number];

export const DESTINO_ACCION_ORDEN: Record<AccionOrden, EstadoOrdenTrabajo> = {
  planificar: 'planificada',
  iniciar: 'en_curso',
  cerrar: 'cerrada',
  cancelar: 'cancelada',
};

/**
 * Coste de una orden en céntimos: mano de obra = horas × tarifa (half-up),
 * más repuestos y externo. Ningún componente negativo.
 */
export function costeOrden(p: {
  horasManoObra?: Importe | null;
  tarifaManoObra?: Importe | null;
  repuestos?: Importe | null;
  externo?: Importe | null;
}): { manoObra: bigint; repuestos: bigint; externo: bigint; total: bigint } {
  const horas = c2(p.horasManoObra);
  const tarifa = toCents(p.tarifaManoObra ?? 0);
  const repuestos = toCents(p.repuestos ?? 0);
  const externo = toCents(p.externo ?? 0);
  if (horas < 0n || tarifa < 0n || repuestos < 0n || externo < 0n) {
    throw new ErrorEam(
      'EAM_WO_COST_INVALID',
      'Horas, tarifas y costes no pueden ser negativos',
    );
  }
  const manoObra = mulDivRound(horas, tarifa, 100n);
  return {
    manoObra,
    repuestos,
    externo,
    total: manoObra + repuestos + externo,
  };
}

/**
 * Cierre de una orden: fin no anterior al inicio ni futuro; la parada no
 * supera las horas naturales entre inicio y fin (días × 24).
 */
export function validarCierreOrden(p: {
  inicio: string;
  fin: string;
  hoy: string;
  horasParada?: Importe | null;
}): void {
  if (p.fin < p.inicio || p.fin > p.hoy) {
    throw new ErrorEam(
      'EAM_WO_DATES_INVALID',
      'El fin no puede ser anterior al inicio ni futuro',
    );
  }
  const parada = c2(p.horasParada);
  const maximo = BigInt(daysBetween(p.inicio, p.fin) + 1) * 24n * 100n;
  if (parada < 0n || parada > maximo) {
    throw new ErrorEam(
      'EAM_WO_DOWNTIME_INVALID',
      `La parada no puede superar ${scaledToNumeric(maximo, 2)} h entre inicio y fin`,
    );
  }
}

/* ───────────────────────── disponibilidad y explotación ───────────────────────── */

export interface IndicadoresDisponibilidad {
  /** Horas disponibles del calendario: días × jornada. */
  horasCalendario: number;
  horasParada: number;
  horasDisponibles: number;
  horasTrabajadas: number;
  /** (calendario − parada) / calendario, en %. */
  disponibilidadPct: number | null;
  /** trabajadas / disponibles, en %. */
  utilizacionPct: number | null;
  averias: number;
  /** Horas trabajadas entre averías. */
  mtbfHoras: number | null;
  /** Horas de parada por avería. */
  mttrHoras: number | null;
}

/** % con 2 decimales de a / b; null si b = 0. */
function pct(a: bigint, b: bigint): number | null {
  if (b <= 0n) return null;
  return Number(scaledToNumeric(mulDivRound(a, 10_000n, b), 2));
}

/**
 * Disponibilidad operativa y fiabilidad de un equipo en un periodo de
 * `dias` naturales con una jornada de `jornadaHoras`. La parada se limita
 * al calendario (no da disponibilidad negativa).
 */
export function indicadoresDisponibilidad(p: {
  dias: number;
  jornadaHoras: Importe;
  horasTrabajadas: Importe;
  paradas: readonly { horas: Importe; correctiva: boolean }[];
}): IndicadoresDisponibilidad {
  if (!Number.isInteger(p.dias) || p.dias < 0)
    throw new ErrorEam('EAM_RANGE_INVALID', 'Periodo no válido');
  const jornada = c2(p.jornadaHoras);
  if (jornada <= 0n || jornada > 2400n)
    throw new ErrorEam(
      'EAM_RANGE_INVALID',
      'La jornada debe estar entre 0 y 24 h',
    );
  const calendario = BigInt(p.dias) * jornada;
  let parada = 0n;
  let paradaCorrectiva = 0n;
  let averias = 0;
  for (const x of p.paradas) {
    const h = c2(x.horas);
    parada += h;
    if (x.correctiva) {
      averias++;
      paradaCorrectiva += h;
    }
  }
  if (parada > calendario) parada = calendario;
  const disponibles = calendario - parada;
  const trabajadas = c2(p.horasTrabajadas);
  return {
    horasCalendario: num2(calendario),
    horasParada: num2(parada),
    horasDisponibles: num2(disponibles),
    horasTrabajadas: num2(trabajadas),
    disponibilidadPct: pct(disponibles, calendario),
    utilizacionPct: pct(trabajadas, disponibles),
    averias,
    mtbfHoras: averias > 0 ? num2(trabajadas / BigInt(averias)) : null,
    mttrHoras: averias > 0 ? num2(paradaCorrectiva / BigInt(averias)) : null,
  };
}

export interface CosteExplotacion {
  amortizacion: number;
  mantenimiento: number;
  /** Total de coste del equipo (TCO del periodo). */
  total: number;
  /** Coste imputado a obras por los partes (ya en el control de costes). */
  imputadoObras: number;
  /** imputado − total: positivo, la tarifa cubre el coste. */
  diferencia: number;
  coberturaPct: number | null;
  costeHora: number | null;
}

/**
 * TCO del equipo: amortización ya contabilizada + mantenimiento (órdenes
 * cerradas y mantenimientos sueltos sin orden, sin contar dos veces) frente
 * a lo imputado a obras por los partes. No crea cargos: lo imputado ya está
 * en el coste real de cada obra.
 */
export function costeExplotacion(p: {
  amortizacion: Importe;
  mantenimientoOrdenes: Importe;
  mantenimientoSuelto: Importe;
  imputadoObras: Importe;
  horasTrabajadas: Importe;
}): CosteExplotacion {
  const amort = toCents(p.amortizacion);
  const mant = toCents(p.mantenimientoOrdenes) + toCents(p.mantenimientoSuelto);
  const total = amort + mant;
  const imputado = toCents(p.imputadoObras);
  const horas = c2(p.horasTrabajadas);
  return {
    amortizacion: fromCents(amort),
    mantenimiento: fromCents(mant),
    total: fromCents(total),
    imputadoObras: fromCents(imputado),
    diferencia: fromCents(imputado - total),
    coberturaPct: pct(imputado, total),
    // €/h = céntimos × 100 / centésimas de hora.
    costeHora: horas > 0n ? fromCents(mulDivRound(total, 100n, horas)) : null,
  };
}

/* ──────────────────────────── contratos (Zod) ──────────────────────────── */

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD');
const cantidad = z.number().min(0).max(9_999_999);

export const fichaEquipoSchema = z.object({
  codigo: z.string().trim().min(1).max(30).nullish(),
  numeroSerie: z.string().trim().max(60).nullish(),
  /** Conjunto del que es componente (null: equipo raíz). */
  padreId: z.string().uuid().nullish(),
});
export type FichaEquipoInput = z.input<typeof fichaEquipoSchema>;

export const lecturaContadorSchema = z.object({
  tipo: z.enum(TIPOS_CONTADOR),
  fecha,
  valor: cantidad,
  correccion: z.boolean().optional(),
  motivo: z.string().trim().max(240).nullish(),
});
export type LecturaContadorInput = z.input<typeof lecturaContadorSchema>;

export const asignacionCreateSchema = z.object({
  projectId: z.string().uuid(),
  desde: fecha,
  hasta: fecha.nullish(),
  notas: z.string().trim().max(240).nullish(),
});
export type AsignacionCreateInput = z.input<typeof asignacionCreateSchema>;

export const asignacionCerrarSchema = z.object({ hasta: fecha });

const planBase = z.object({
  nombre: z.string().trim().min(3).max(120),
  tipo: z.enum(TIPOS_PLAN).default('preventiva'),
  periodicidadDias: z.number().int().min(1).max(3650).nullish(),
  intervaloHoras: z.number().positive().max(100_000).nullish(),
  intervaloKm: z.number().positive().max(1_000_000).nullish(),
  avisoDias: z.number().int().min(0).max(365).default(15),
  avisoHoras: z.number().min(0).max(10_000).default(25),
  avisoKm: z.number().min(0).max(100_000).default(500),
  ultimaFecha: fecha.nullish(),
  ultimaHoras: cantidad.nullish(),
  ultimaKm: cantidad.nullish(),
});
export const planCreateSchema = planBase;
export type PlanCreateInput = z.input<typeof planCreateSchema>;
export const planUpdateSchema = planBase
  .partial()
  .extend({ activo: z.boolean().optional() });
export type PlanUpdateInput = z.input<typeof planUpdateSchema>;

export const ordenCreateSchema = z.object({
  equipoId: z.string().uuid(),
  tipo: z.enum(TIPOS_ORDEN_TRABAJO),
  prioridad: z.enum(PRIORIDADES_ORDEN).default('media'),
  planId: z.string().uuid().nullish(),
  /** Obra donde está el equipo o donde se produjo la avería (atribución analítica). */
  projectId: z.string().uuid().nullish(),
  descripcion: z.string().trim().min(3).max(1000),
  fechaAviso: fecha,
  fechaPlanificada: fecha.nullish(),
});
export type OrdenCreateInput = z.input<typeof ordenCreateSchema>;

export const ordenAccionSchema = z.object({
  accion: z.enum(ACCIONES_ORDEN),
  fecha,
  fechaPlanificada: fecha.nullish(),
  horasParada: cantidad.nullish(),
  horasManoObra: cantidad.nullish(),
  tarifaManoObra: cantidad.nullish(),
  costeRepuestos: cantidad.nullish(),
  costeExterno: cantidad.nullish(),
  proveedorId: z.string().uuid().nullish(),
  lecturaHoras: cantidad.nullish(),
  lecturaKm: cantidad.nullish(),
  notas: z.string().trim().max(1000).nullish(),
  motivo: z.string().trim().max(240).nullish(),
});
export type OrdenAccionInput = z.input<typeof ordenAccionSchema>;

export const ordenesQuerySchema = z.object({
  equipoId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  estado: z.enum(ESTADOS_ORDEN_TRABAJO).optional(),
  tipo: z.enum(TIPOS_ORDEN_TRABAJO).optional(),
});
export type OrdenesQuery = z.infer<typeof ordenesQuerySchema>;

export const explotacionQuerySchema = z.object({
  desde: fecha,
  hasta: fecha,
  projectId: z.string().uuid().optional(),
  equipoId: z.string().uuid().optional(),
  jornadaHoras: z.coerce.number().positive().max(24).default(8),
});
export type ExplotacionQuery = z.input<typeof explotacionQuerySchema>;

/* ──────────────────────────────── DTO ──────────────────────────────── */

export interface EquipoEamDto {
  id: string;
  nombre: string;
  codigo: string | null;
  matricula: string | null;
  numeroSerie: string | null;
  tipo: string;
  ownership: string;
  estado: string;
  padreId: string | null;
  padreNombre: string | null;
  componentes: { id: string; nombre: string; codigo: string | null }[];
  contadorHoras: number;
  contadorKm: number;
  contadorFecha: string | null;
  obraActual: {
    asignacionId: string;
    projectId: string;
    nombre: string;
    desde: string;
  } | null;
  activoFijo: { id: string; codigo: string; estado: string } | null;
  /** Peor estado de sus planes preventivos activos. */
  preventivo: EstadoVencimiento | null;
  ordenesAbiertas: number;
  version: number;
}

export interface LecturaContadorDto {
  id: string;
  tipo: TipoContador;
  fecha: string;
  valor: number;
  anterior: number | null;
  origen: OrigenLectura;
  motivo: string | null;
  createdAt: string;
}

export interface AsignacionDto {
  id: string;
  equipoId: string;
  projectId: string;
  projectNombre: string;
  desde: string;
  hasta: string | null;
  notas: string | null;
  version: number;
}

export interface PlanMantenimientoDto extends EstadoPreventivo {
  id: string;
  equipoId: string;
  nombre: string;
  tipo: TipoPlan;
  periodicidadDias: number | null;
  intervaloHoras: number | null;
  intervaloKm: number | null;
  avisoDias: number;
  avisoHoras: number;
  avisoKm: number;
  ultimaFecha: string | null;
  ultimaHoras: number | null;
  ultimaKm: number | null;
  activo: boolean;
  ordenAbiertaId: string | null;
  version: number;
}

export interface OrdenTrabajoDto {
  id: string;
  numero: string;
  equipoId: string;
  equipoNombre: string;
  planId: string | null;
  tipo: TipoOrdenTrabajo;
  prioridad: PrioridadOrden;
  estado: EstadoOrdenTrabajo;
  projectId: string | null;
  projectNombre: string | null;
  descripcion: string;
  fechaAviso: string;
  fechaPlanificada: string | null;
  inicio: string | null;
  fin: string | null;
  horasParada: number;
  horasManoObra: number;
  tarifaManoObra: number;
  costeManoObra: number;
  costeRepuestos: number;
  costeExterno: number;
  costeTotal: number;
  proveedorId: string | null;
  lecturaHoras: number | null;
  lecturaKm: number | null;
  notasCierre: string | null;
  motivoCancelacion: string | null;
  version: number;
}

export interface ExplotacionEquipoDto extends IndicadoresDisponibilidad {
  equipoId: string;
  nombre: string;
  codigo: string | null;
  diasAsignados: number;
  coste: CosteExplotacion;
  ordenesCerradas: number;
}

export interface ExplotacionObraDto {
  projectId: string;
  nombre: string;
  horasTrabajadas: number;
  /** Coste de los partes de maquinaria de la obra (ya en su coste real). */
  imputado: number;
  /** Mantenimiento de órdenes atribuidas a la obra (analítico, no se carga a la obra). */
  mantenimientoAtribuido: number;
  equipos: number;
}

export interface ExplotacionDto {
  desde: string;
  hasta: string;
  jornadaHoras: number;
  equipos: ExplotacionEquipoDto[];
  obras: ExplotacionObraDto[];
  totales: {
    horasTrabajadas: number;
    amortizacion: number;
    mantenimiento: number;
    total: number;
    imputadoObras: number;
    diferencia: number;
  };
}
