import { z } from 'zod';
import { daysBetween, formatEuros, round2 } from './calculo';

/**
 * Expediente de cese de obra por causa ajena.
 *
 * Del manual: cuando una obra se detiene por causa ajena debe abrirse
 * expediente **el mismo día**, con fecha de parada, causa, responsable y
 * valoración de los costes que siguen corriendo —indirectos, medios
 * auxiliares, personal, alquileres—. Es la base para reclamar y, si no se hace
 * en el momento, después es irrecuperable.
 *
 * Ese «después es irrecuperable» es toda la razón de ser del módulo. Seis
 * meses más tarde nadie reconstruye qué grúa estuvo parada, cuántos días ni
 * con cuánta gente: no es que la reclamación se pierda por prescripción, es
 * que ya no hay con qué sostenerla.
 */

/* ─────────────────────────── catálogos ─────────────────────────── */

export const STOPPAGE_CAUSES = [
  'falta_definicion_proyecto',
  'falta_suministro_propiedad',
  'impago',
  'licencia_o_permiso',
  'orden_direccion_facultativa',
  'condiciones_meteorologicas',
  'otra',
] as const;

export type StoppageCause = (typeof STOPPAGE_CAUSES)[number];

export const STOPPAGE_CAUSE_LABELS: Record<StoppageCause, string> = {
  falta_definicion_proyecto: 'Falta de definición del proyecto',
  falta_suministro_propiedad: 'Falta de suministro o material de la Propiedad',
  impago: 'Impago de certificaciones',
  licencia_o_permiso: 'Licencia o permiso sin resolver',
  orden_direccion_facultativa: 'Orden de la Dirección Facultativa',
  condiciones_meteorologicas: 'Condiciones meteorológicas extraordinarias',
  otra: 'Otra causa',
};

export const STOPPAGE_ATTRIBUTIONS = [
  'propiedad',
  'direccion_facultativa',
  'administracion',
  'suministradora',
  'fuerza_mayor',
  'contratista',
] as const;

export type StoppageAttribution = (typeof STOPPAGE_ATTRIBUTIONS)[number];

export const STOPPAGE_ATTRIBUTION_LABELS: Record<StoppageAttribution, string> =
  {
    propiedad: 'Propiedad',
    direccion_facultativa: 'Dirección Facultativa',
    administracion: 'Administración',
    suministradora: 'Compañía suministradora',
    fuerza_mayor: 'Fuerza mayor',
    contratista: 'Contratista (nosotros)',
  };

/**
 * Causa ajena es todo lo que no es nuestro. Si la parada es imputable al
 * contratista no hay nada que reclamar: el expediente sigue sirviendo para
 * conocer el coste, pero no es una reclamación.
 */
export function isExternalCause(attribution: StoppageAttribution): boolean {
  return attribution !== 'contratista';
}

/** Los cuatro conceptos que nombra el manual, más un cajón para el resto. */
export const STOPPAGE_COST_CONCEPTS = [
  'indirectos',
  'medios_auxiliares',
  'personal',
  'alquileres',
  'otros',
] as const;

export type StoppageCostConcept = (typeof STOPPAGE_COST_CONCEPTS)[number];

export const STOPPAGE_COST_CONCEPT_LABELS: Record<StoppageCostConcept, string> =
  {
    indirectos: 'Costes indirectos',
    medios_auxiliares: 'Medios auxiliares',
    personal: 'Personal',
    alquileres: 'Alquileres',
    otros: 'Otros costes corrientes',
  };

/**
 * Los que el manual enumera expresamente. Que falte uno no invalida el
 * expediente —una obra puede no tener alquileres—, pero conviene que sea una
 * decisión y no un olvido, porque lo que no se valora no se reclama.
 */
export const MANUAL_COST_CONCEPTS: StoppageCostConcept[] = [
  'indirectos',
  'medios_auxiliares',
  'personal',
  'alquileres',
];

/* ─────────────────────────── cálculo ─────────────────────────── */

/**
 * Días naturales de parada, contando el primero y el último.
 *
 * Naturales, no laborables: la grúa y la caseta se pagan también el domingo.
 * Una obra parada un solo día son un día, no cero.
 */
export function stoppageDays(
  startDate: string,
  endDate: string | null,
  today: string,
): number {
  const hasta = endDate ?? today;
  if (hasta < startDate) return 0;
  return daysBetween(startDate, hasta) + 1;
}

/**
 * Días que se tardó en abrir el expediente. El manual dice «el mismo día»,
 * así que cero es lo correcto y cualquier otra cosa es deuda de prueba.
 */
export function daysToOpen(startDate: string, openedAt: string): number {
  return Math.max(0, daysBetween(startDate, openedAt));
}

export interface StoppageCostLine {
  concept: StoppageCostConcept;
  description: string | null;
  dailyAmount: number;
}

export interface StoppageCostTotal extends StoppageCostLine {
  /** Importe acumulado del concepto por los días de parada. */
  total: number;
}

export interface StoppageValuation {
  days: number;
  /** Lo que cuesta cada día natural que la obra siga parada. */
  dailyTotal: number;
  /** Coste corriente acumulado desde el día uno. */
  accruedTotal: number;
  lines: StoppageCostTotal[];
  /** Conceptos del manual que nadie ha valorado. */
  missingConcepts: StoppageCostConcept[];
}

/**
 * Valoración del expediente: lo que llevamos gastado por estar parados.
 *
 * El coste diario se guarda por concepto y el acumulado se calcula; al revés
 * habría que actualizarlo a mano cada día, que es la manera segura de que
 * deje de estar al día justo cuando hace falta.
 */
export function valueStoppage(
  lines: StoppageCostLine[],
  days: number,
): StoppageValuation {
  const conTotal: StoppageCostTotal[] = lines.map((l) => ({
    ...l,
    total: round2(l.dailyAmount * days),
  }));
  const valorados = new Set(
    lines.filter((l) => l.dailyAmount > 0).map((l) => l.concept),
  );
  return {
    days,
    dailyTotal: round2(lines.reduce((s, l) => s + l.dailyAmount, 0)),
    accruedTotal: round2(conTotal.reduce((s, l) => s + l.total, 0)),
    lines: conTotal,
    missingConcepts: MANUAL_COST_CONCEPTS.filter((c) => !valorados.has(c)),
  };
}

export const STOPPAGE_STATUSES = ['abierta', 'reanudada'] as const;
export type StoppageStatus = (typeof STOPPAGE_STATUSES)[number];

export const STOPPAGE_STATUS_LABELS: Record<StoppageStatus, string> = {
  abierta: 'Obra parada',
  reanudada: 'Reanudada',
};

export function stoppageStatus(endDate: string | null): StoppageStatus {
  return endDate === null ? 'abierta' : 'reanudada';
}

/* ─────────────────────────── avisos ─────────────────────────── */

export interface StoppageState {
  startDate: string;
  endDate: string | null;
  openedAt: string;
  attribution: StoppageAttribution;
  notifiedAt: string | null;
  claimedAmount: number | null;
  valuation: StoppageValuation;
}

/**
 * Lo que hay que leer del expediente, en el orden en que importa.
 *
 * Todos los avisos apuntan a lo mismo: un expediente sin valorar, sin
 * comunicar o abierto tarde no es un expediente, es una nota. Y una nota no
 * se cobra.
 */
export function stoppageWarnings(s: StoppageState): string[] {
  const warnings: string[] = [];
  const externa = isExternalCause(s.attribution);
  const retraso = daysToOpen(s.startDate, s.openedAt);

  if (retraso > 0) {
    warnings.push(
      `El expediente se abrió ${retraso} día(s) después de la parada. El manual dice que el mismo día, y no es una formalidad: lo que no se documentó mientras pasaba hay que reconstruirlo después, y eso es justo lo que la otra parte va a discutir.`,
    );
  }

  if (s.valuation.dailyTotal === 0) {
    warnings.push(
      'No hay ningún coste corriente valorado. Sin valoración el expediente no sirve para reclamar: acredita que la obra estuvo parada, no lo que costó.',
    );
  } else if (s.valuation.missingConcepts.length > 0) {
    warnings.push(
      `Sin valorar: ${s.valuation.missingConcepts
        .map((c) => STOPPAGE_COST_CONCEPT_LABELS[c].toLowerCase())
        .join(
          ', ',
        )}. Son conceptos que el manual enumera expresamente; si esta obra no los tiene, déjalo escrito para que conste que es una decisión y no un olvido.`,
    );
  }

  if (externa && s.notifiedAt === null) {
    warnings.push(
      'No consta comunicación formal a la Propiedad ni a la Dirección Facultativa. Una parada que no se ha comunicado por escrito no se reclama después: para la otra parte, no ocurrió.',
    );
  }

  if (!externa) {
    warnings.push(
      'La parada figura como imputable a nosotros: no hay reclamación que preparar. El expediente sigue sirviendo para saber lo que costó, que es la única forma de que no vuelva a pasar.',
    );
  }

  if (
    externa &&
    s.claimedAmount === null &&
    s.endDate !== null &&
    s.valuation.accruedTotal > 0
  ) {
    warnings.push(
      `La obra se reanudó y hay ${formatEuros(s.valuation.accruedTotal)} de coste acumulado sin reclamar. Con la obra otra vez en marcha, este expediente es lo único que queda de la parada.`,
    );
  }

  if (s.endDate === null && s.valuation.dailyTotal > 0) {
    warnings.push(
      `La obra sigue parada y consume ${formatEuros(s.valuation.dailyTotal)} cada día natural. No es una cifra para el archivo: es la que dice cuánto vale resolver la causa una semana antes.`,
    );
  }

  return warnings;
}

/* ────────────────────── esquemas y DTOs ────────────────────── */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD');

const money = z
  .number({ invalid_type_error: 'Debe ser un número' })
  .nonnegative('No puede ser negativo')
  .max(999_999_999_999.99);

export const stoppageCostSchema = z.object({
  concept: z.enum(STOPPAGE_COST_CONCEPTS),
  description: z.string().trim().max(300).nullish(),
  dailyAmount: money,
});

export const stoppageCreateSchema = z
  .object({
    projectId: z.string().uuid('La obra es obligatoria'),
    startDate: isoDate,
    endDate: isoDate.nullish(),
    cause: z.enum(STOPPAGE_CAUSES),
    attribution: z.enum(STOPPAGE_ATTRIBUTIONS),
    description: z
      .string()
      .trim()
      .min(1, 'Describe qué ha parado y por qué')
      .max(2000, 'Máximo 2000 caracteres'),
    /** Por defecto, el día de la parada: es lo que manda el manual. */
    openedAt: isoDate.nullish(),
    openedBy: z.string().trim().max(120).nullish(),
    notifiedAt: isoDate.nullish(),
    notifiedTo: z.string().trim().max(200).nullish(),
    claimedAmount: money.nullish(),
    claimedAt: isoDate.nullish(),
    notes: z.string().trim().max(2000).nullish(),
    costs: z.array(stoppageCostSchema).default([]),
  })
  .superRefine((s, ctx) => {
    // Nada puede ser anterior al día en que la obra paró: el expediente no se
    // abre antes de que haya algo que documentar.
    if (s.endDate && s.endDate < s.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'La reanudación no puede ser anterior a la parada',
        path: ['endDate'],
      });
    }
    if (s.openedAt && s.openedAt < s.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'El expediente no puede abrirse antes de que la obra pare',
        path: ['openedAt'],
      });
    }
    if (s.notifiedAt && s.notifiedAt < s.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'La comunicación no puede ser anterior a la parada',
        path: ['notifiedAt'],
      });
    }
  });

export const stoppageUpdateSchema = stoppageCreateSchema
  .innerType()
  .partial()
  .omit({ projectId: true });

export type StoppageCostInput = z.input<typeof stoppageCostSchema>;
export type StoppageCreateInput = z.input<typeof stoppageCreateSchema>;
export type StoppageUpdateInput = z.input<typeof stoppageUpdateSchema>;

export interface StoppageDto {
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  seq: number;
  stoppageNumber: string;
  startDate: string;
  endDate: string | null;
  cause: StoppageCause;
  attribution: StoppageAttribution;
  externalCause: boolean;
  description: string;
  openedAt: string;
  openedBy: string | null;
  /** Días que se tardó en abrir el expediente; cero es lo correcto. */
  daysToOpen: number;
  notifiedAt: string | null;
  notifiedTo: string | null;
  claimedAmount: number | null;
  claimedAt: string | null;
  status: StoppageStatus;
  valuation: StoppageValuation;
  warnings: string[];
  notes: string | null;
  createdAt: string;
}

/** Resumen de las paradas de una obra, para la ficha mensual. */
export interface StoppageReportDto {
  projectId: string;
  projectCode: string;
  projectName: string;
  stoppages: StoppageDto[];
  /** Días de parada acumulados en la obra. */
  totalDays: number;
  /** Coste corriente acumulado por todas las paradas. */
  totalAccrued: number;
  /** Coste acumulado de las paradas por causa ajena: lo reclamable. */
  claimableAccrued: number;
  totalClaimed: number;
  /** ¿Hay alguna parada abierta ahora mismo? */
  openCount: number;
  warnings: string[];
}

/** Avisos del conjunto de paradas de una obra. */
export function stoppageReportWarnings(rows: StoppageDto[]): string[] {
  const warnings: string[] = [];
  if (rows.length === 0) return warnings;

  const abiertas = rows.filter((r) => r.status === 'abierta');
  if (abiertas.length > 0) {
    const diario = round2(
      abiertas.reduce((s, r) => s + r.valuation.dailyTotal, 0),
    );
    warnings.push(
      `La obra tiene ${abiertas.length} parada(s) sin reanudar` +
        (diario > 0 ? `, consumiendo ${formatEuros(diario)} al día.` : '.'),
    );
  }

  const sinReclamar = rows.filter(
    (r) => r.externalCause && r.claimedAmount === null,
  );
  if (sinReclamar.length > 0) {
    const importe = round2(
      sinReclamar.reduce((s, r) => s + r.valuation.accruedTotal, 0),
    );
    if (importe > 0) {
      warnings.push(
        `Hay ${formatEuros(importe)} de coste por paradas ajenas sin reclamar (${sinReclamar
          .map((r) => r.stoppageNumber)
          .join(', ')}).`,
      );
    }
  }

  const tarde = rows.filter((r) => r.daysToOpen > 0);
  if (tarde.length > 0) {
    warnings.push(
      `${tarde.length} expediente(s) se abrieron después del día de la parada. Es el dato que la otra parte discute primero.`,
    );
  }

  return warnings;
}
