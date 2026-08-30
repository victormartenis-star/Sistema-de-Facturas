import { z } from 'zod';

/**
 * Checklist de apertura de obra (anexo A del manual de procesos).
 *
 * Dos decisiones de diseño que lo separan de una lista de casillas:
 *
 * 1. **Lo que el sistema puede comprobar, lo comprueba.** Si los responsables
 *    están asignados en la ficha de la obra o la licencia consta solicitada,
 *    no se le pide a nadie que lo marque: pedir una confirmación manual de un
 *    dato que ya está en el sistema es cómo se consigue que la gente marque
 *    todo sin mirar.
 * 2. **Hay un orden que no se puede invertir.** Plan de seguridad redactado →
 *    acta de aprobación firmada → comunicación de apertura de centro de
 *    trabajo → inicio de los trabajos. Hacerlo al revés expone a una
 *    infracción en materia de prevención y a la paralización de la obra, así
 *    que el sistema no deja marcar un paso sin el anterior.
 */

export const CHECKLIST_ITEMS_KEYS = [
  'codigo_obra',
  'contrato_firmado',
  'responsables_asignados',
  'presupuesto_cargado',
  'acta_traspaso',
  'plan_seguridad',
  'acta_aprobacion_plan',
  'apertura_centro_trabajo',
  'libro_subcontratacion',
  'licencias_solicitadas',
  'acometidas_provisionales',
  'plan_contratacion',
  'subcontratas_validadas',
  'encargado_designado',
  'calendario_certificaciones',
] as const;

export type ChecklistItemKey = (typeof CHECKLIST_ITEMS_KEYS)[number];

export interface ChecklistItemDef {
  key: ChecklistItemKey;
  label: string;
  /** Quién responde de que esté hecho. */
  responsible: string;
  /**
   * true = el sistema lo deduce de sus propios datos; false = alguien tiene
   * que confirmarlo porque ocurre fuera del ERP (una firma, un registro).
   */
  auto: boolean;
  /** Sin esto no deberían arrancar los trabajos. */
  blocksStart: boolean;
  /** Pasos que tienen que estar cumplidos antes que este. */
  requires?: ChecklistItemKey[];
  /** Por qué importa, en una frase. */
  why?: string;
}

export const CHECKLIST_ITEMS: ChecklistItemDef[] = [
  {
    key: 'codigo_obra',
    label: 'Código de obra asignado y dado de alta',
    responsible: 'Estudios',
    auto: true,
    blocksStart: true,
    why: 'Mismo código en el ERP, en la carpeta de red y como centro de coste en contabilidad.',
  },
  {
    key: 'contrato_firmado',
    label: 'Contrato con el cliente firmado y revisado por el abogado externo',
    responsible: 'Dirección',
    auto: false,
    blocksStart: true,
    why: 'Todo contrato pasa por el abogado antes de firmar.',
  },
  {
    key: 'responsables_asignados',
    label: 'Jefe de Grupo y Jefe de Obra asignados por escrito',
    responsible: 'Dirección Técnica',
    auto: true,
    blocksStart: true,
    why: 'Nombre y apellidos antes del inicio, no «ya lo veremos».',
  },
  {
    key: 'presupuesto_cargado',
    label: 'Presupuesto de venta, coste objetivo y planificación cargados',
    responsible: 'Estudios',
    auto: true,
    blocksStart: true,
    why: 'Sin coste objetivo y sin reparto por meses no hay nada contra lo que medir la desviación.',
  },
  {
    key: 'acta_traspaso',
    label: 'Acta de traspaso Estudios → Producción firmada',
    responsible: 'Estudios + Jefe de Obra',
    auto: false,
    blocksStart: true,
    why: 'El jefe de obra acepta por escrito el coste meta, las hipótesis y los riesgos. Sin acta no arranca la obra.',
  },
  {
    key: 'plan_seguridad',
    label: 'Plan de seguridad y salud redactado (o evaluación de riesgos)',
    responsible: 'Servicio de prevención',
    auto: false,
    blocksStart: true,
    why: 'Plan en obras con proyecto; evaluación de riesgos específica en obras sin proyecto.',
  },
  {
    key: 'acta_aprobacion_plan',
    label: 'Acta de aprobación del plan firmada por el coordinador',
    responsible: 'Coordinador de la propiedad',
    auto: false,
    blocksStart: true,
    requires: ['plan_seguridad'],
    why: 'Sin acta no puede comunicarse la apertura del centro de trabajo.',
  },
  {
    key: 'apertura_centro_trabajo',
    label: 'Comunicación de apertura de centro de trabajo presentada',
    responsible: 'Administración',
    auto: false,
    blocksStart: true,
    requires: ['acta_aprobacion_plan'],
    why: 'Previa al inicio de los trabajos y expuesta en obra en lugar visible.',
  },
  {
    key: 'libro_subcontratacion',
    label: 'Libro de subcontratación habilitado',
    responsible: 'Compras',
    auto: false,
    blocksStart: true,
    why: 'Habilitado antes del inicio; se anota cada subcontratación y su nivel.',
  },
  {
    key: 'licencias_solicitadas',
    label: 'Licencias de obra, cala y ocupación de vía pública solicitadas',
    responsible: 'Producción',
    auto: true,
    blocksStart: true,
  },
  {
    key: 'acometidas_provisionales',
    label: 'Acometidas provisionales resueltas y definitivas iniciadas',
    responsible: 'Producción',
    auto: true,
    blocksStart: true,
    why: 'La definitiva tarda meses o años: se tramita en paralelo desde el primer día.',
  },
  {
    key: 'plan_contratacion',
    label: 'Plan de contratación con fechas límite por paquete',
    responsible: 'Compras',
    auto: false,
    blocksStart: false,
  },
  {
    key: 'subcontratas_validadas',
    label: 'Subcontratas del arranque validadas documentalmente',
    responsible: 'Compras',
    auto: false,
    blocksStart: true,
    why: 'Sin documentación validada no hay acceso a obra: el control tiene que llegar a la valla.',
  },
  {
    key: 'encargado_designado',
    label: 'Encargado designado, formado y con checklist entregado',
    responsible: 'Producción',
    auto: true,
    blocksStart: true,
  },
  {
    key: 'calendario_certificaciones',
    label: 'Calendario de certificaciones y condiciones de cobro comunicado',
    responsible: 'Dirección',
    auto: false,
    blocksStart: false,
    why: 'La empresa financia el desfase entre lo ejecutado y lo cobrado.',
  },
];

const BY_KEY = new Map(CHECKLIST_ITEMS.map((i) => [i.key, i]));

export function checklistItem(key: ChecklistItemKey): ChecklistItemDef {
  const item = BY_KEY.get(key);
  if (!item) throw new Error(`Punto de checklist desconocido: ${key}`);
  return item;
}

/* ─────────────────────── evaluación ─────────────────────── */

/** Lo que el sistema sabe por su cuenta de cada punto automático. */
export type AutoFacts = Partial<
  Record<ChecklistItemKey, { done: boolean; detail: string }>
>;

/** Confirmaciones manuales guardadas. */
export interface ManualMark {
  key: ChecklistItemKey;
  doneAt: string;
  markedBy: string | null;
  notes: string | null;
}

export interface ChecklistRowDto {
  key: ChecklistItemKey;
  label: string;
  responsible: string;
  auto: boolean;
  blocksStart: boolean;
  why: string | null;
  done: boolean;
  /** Qué ha visto el sistema, en los puntos automáticos. */
  detail: string | null;
  doneAt: string | null;
  markedBy: string | null;
  notes: string | null;
  /** Puntos previos que faltan; mientras haya alguno, no se puede marcar. */
  blockedBy: ChecklistItemKey[];
}

export interface ChecklistDto {
  projectId: string;
  projectCode: string;
  projectName: string;
  rows: ChecklistRowDto[];
  doneCount: number;
  totalCount: number;
  /** Puntos que bloquean el arranque y siguen sin cumplirse. */
  pendingBlockers: ChecklistRowDto[];
  /** ¿Puede arrancar la obra? */
  canStart: boolean;
  warnings: string[];
}

/**
 * Construye el checklist combinando lo que el sistema deduce con lo que se ha
 * confirmado a mano, y calcula qué puntos están bloqueados por su predecesor.
 */
export function buildChecklist(
  auto: AutoFacts,
  manual: ManualMark[],
): ChecklistRowDto[] {
  const marks = new Map(manual.map((m) => [m.key, m]));

  const isDone = (key: ChecklistItemKey): boolean => {
    const def = checklistItem(key);
    return def.auto ? (auto[key]?.done ?? false) : marks.has(key);
  };

  return CHECKLIST_ITEMS.map((def) => {
    const mark = marks.get(def.key);
    const fact = auto[def.key];
    return {
      key: def.key,
      label: def.label,
      responsible: def.responsible,
      auto: def.auto,
      blocksStart: def.blocksStart,
      why: def.why ?? null,
      done: isDone(def.key),
      detail: fact?.detail ?? null,
      doneAt: mark?.doneAt ?? null,
      markedBy: mark?.markedBy ?? null,
      notes: mark?.notes ?? null,
      blockedBy: (def.requires ?? []).filter((r) => !isDone(r)),
    };
  });
}

/**
 * Motivo por el que un punto no puede marcarse todavía, o null si sí puede.
 *
 * Es donde se aplica el orden que no se puede invertir: comunicar la apertura
 * del centro de trabajo sin el acta de aprobación del plan firmada no es un
 * despiste de orden, es una infracción.
 */
export function checklistBlockReason(
  key: ChecklistItemKey,
  rows: ChecklistRowDto[],
): string | null {
  const row = rows.find((r) => r.key === key);
  if (!row) return 'Punto de checklist desconocido';
  if (row.auto) {
    return 'Este punto lo comprueba el sistema: no se marca a mano.';
  }
  if (row.blockedBy.length === 0) return null;

  const faltan = row.blockedBy.map((k) => checklistItem(k).label).join(', ');
  return `Antes hace falta: ${faltan}. El orden no se puede invertir.`;
}

export function checklistSummary(
  rows: ChecklistRowDto[],
): Pick<
  ChecklistDto,
  'doneCount' | 'totalCount' | 'pendingBlockers' | 'canStart'
> {
  const pendingBlockers = rows.filter((r) => r.blocksStart && !r.done);
  return {
    doneCount: rows.filter((r) => r.done).length,
    totalCount: rows.length,
    pendingBlockers,
    canStart: pendingBlockers.length === 0,
  };
}

/* ────────────────────── esquemas ────────────────────── */

export const checklistMarkSchema = z.object({
  key: z.enum(CHECKLIST_ITEMS_KEYS),
  done: z.boolean(),
  markedBy: z.string().trim().max(120).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

export type ChecklistMarkInput = z.input<typeof checklistMarkSchema>;
