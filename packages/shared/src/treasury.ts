import { addDays, round2, startOfWeek } from './calculo';

/**
 * Tesorería: vencimientos (cobros y pagos previstos) y previsión de caja a
 * trece semanas, con el saldo semana a semana y aviso de tensión.
 */

export const MILESTONE_DIRECTIONS = ['cobro', 'pago'] as const;
export type MilestoneDirection = (typeof MILESTONE_DIRECTIONS)[number];

export const MILESTONE_DIRECTION_LABELS: Record<MilestoneDirection, string> = {
  cobro: 'Cobro',
  pago: 'Pago',
};

export const MILESTONE_KINDS = ['ordinario', 'retencion'] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

export const MILESTONE_KIND_LABELS: Record<MilestoneKind, string> = {
  ordinario: 'Ordinario',
  retencion: 'Retención de garantía',
};

export const MILESTONE_STATUSES = ['previsto', 'pagado'] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  previsto: 'Previsto',
  pagado: 'Liquidado',
};

export interface MilestoneDto {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  contactName: string;
  direction: MilestoneDirection;
  kind: MilestoneKind;
  dueDate: string;
  amount: number;
  status: MilestoneStatus;
  paidAt: string | null;
}

/* ─────────────────── tesorería a 13 semanas ─────────────────── */

/**
 * El horizonte del manual: trece semanas, ni más ni menos.
 *
 * Es el plazo en el que un problema de caja todavía se puede resolver
 * —adelantar una certificación, negociar un aplazamiento, tirar de póliza—.
 * A un mes ya no da tiempo a reaccionar, y a seis la previsión es literatura.
 */
export const TREASURY_HORIZON_WEEKS = 13;

/** Un movimiento de caja previsto dentro del horizonte. */
export interface CashItem {
  dueDate: string;
  direction: MilestoneDirection;
  amount: number;
  /**
   * ¿Hay factura emitida y aprobada detrás?
   *
   * Lo confirmado es deuda cierta con fecha. Lo previsto —una certificación
   * sin facturar, un albarán sin factura— va a ocurrir casi seguro, pero
   * puede moverse de semana. Mezclarlos da una previsión que parece más firme
   * de lo que es; dejar fuera lo previsto da una que se queda corta en los
   * pagos, que es peor.
   */
  confirmed: boolean;
  concept: string;
}

export interface WeekBucketDto {
  /** Lunes de la semana. */
  weekStart: string;
  label: string;
  cobrosConfirmados: number;
  cobrosPrevistos: number;
  pagosConfirmados: number;
  pagosPrevistos: number;
  cobros: number;
  pagos: number;
  neto: number;
  /** Saldo al cierre de la semana; null si no se sabe el saldo de partida. */
  saldo: number | null;
  /** El saldo se queda en negativo esa semana. */
  tension: boolean;
}

export interface ThirteenWeekDto {
  from: string;
  to: string;
  /** Saldo de caja al empezar el horizonte; null si nadie lo ha dicho. */
  openingBalance: number | null;
  weeks: WeekBucketDto[];
  totalCobros: number;
  totalPagos: number;
  neto: number;
  /** Saldo al final de las trece semanas; null sin saldo de partida. */
  closingBalance: number | null;
  /** El peor momento del horizonte, que casi nunca es el último. */
  minBalance: number | null;
  minBalanceWeek: string | null;
  /** Primera semana en negativo: la fecha límite para hacer algo. */
  firstTensionWeek: string | null;
  warnings: string[];
}

/** Etiqueta corta de una semana: «Sem. 08/09». */
export function weekLabel(weekStart: string): string {
  const [, m, d] = weekStart.split('-');
  return `Sem. ${d}/${m}`;
}

/**
 * Previsión de caja a trece semanas.
 *
 * `openingBalance` es el saldo real de las cuentas el día que arranca el
 * horizonte. Sin él no se devuelve saldo ninguno: una previsión que empieza
 * en cero no dice si hay tensión de caja, dice si esas trece semanas son
 * netamente positivas, que es otra pregunta y bastante menos útil. Una
 * empresa con 400.000 € en el banco aguanta una semana de −50.000 € sin
 * enterarse; otra con 10.000 €, no.
 */
export function buildThirteenWeek(
  startDate: string,
  openingBalance: number | null,
  items: CashItem[],
): ThirteenWeekDto {
  const from = startOfWeek(startDate);
  const semanas: string[] = [];
  for (let i = 0; i < TREASURY_HORIZON_WEEKS; i++) {
    semanas.push(addDays(from, i * 7));
  }
  const to = addDays(semanas[semanas.length - 1], 6);

  const vacio = () => ({
    cobrosConfirmados: 0,
    cobrosPrevistos: 0,
    pagosConfirmados: 0,
    pagosPrevistos: 0,
  });
  const totales = new Map(semanas.map((s) => [s, vacio()]));

  for (const item of items) {
    // Lo vencido y sin cobrar antes del horizonte no desaparece: se arrastra
    // a la primera semana, que es donde hay que resolverlo.
    const semana = item.dueDate < from ? from : startOfWeek(item.dueDate);
    const bucket = totales.get(semana);
    if (!bucket) continue; // fuera del horizonte
    if (item.direction === 'cobro') {
      if (item.confirmed) bucket.cobrosConfirmados += item.amount;
      else bucket.cobrosPrevistos += item.amount;
    } else if (item.confirmed) {
      bucket.pagosConfirmados += item.amount;
    } else {
      bucket.pagosPrevistos += item.amount;
    }
  }

  let saldo = openingBalance;
  let minBalance: number | null = null;
  let minBalanceWeek: string | null = null;
  let firstTensionWeek: string | null = null;

  const weeks: WeekBucketDto[] = semanas.map((weekStart) => {
    const t = totales.get(weekStart) ?? vacio();
    const cobros = round2(t.cobrosConfirmados + t.cobrosPrevistos);
    const pagos = round2(t.pagosConfirmados + t.pagosPrevistos);
    const neto = round2(cobros - pagos);

    if (saldo !== null) {
      saldo = round2(saldo + neto);
      if (minBalance === null || saldo < minBalance) {
        minBalance = saldo;
        minBalanceWeek = weekStart;
      }
      if (saldo < 0 && firstTensionWeek === null) firstTensionWeek = weekStart;
    }

    return {
      weekStart,
      label: weekLabel(weekStart),
      cobrosConfirmados: round2(t.cobrosConfirmados),
      cobrosPrevistos: round2(t.cobrosPrevistos),
      pagosConfirmados: round2(t.pagosConfirmados),
      pagosPrevistos: round2(t.pagosPrevistos),
      cobros,
      pagos,
      neto,
      saldo,
      tension: saldo !== null && saldo < 0,
    };
  });

  const totalCobros = round2(weeks.reduce((s, w) => s + w.cobros, 0));
  const totalPagos = round2(weeks.reduce((s, w) => s + w.pagos, 0));

  return {
    from,
    to,
    openingBalance,
    weeks,
    totalCobros,
    totalPagos,
    neto: round2(totalCobros - totalPagos),
    closingBalance: saldo,
    minBalance,
    minBalanceWeek,
    firstTensionWeek,
    warnings: thirteenWeekWarnings({
      openingBalance,
      weeks,
      minBalance,
      minBalanceWeek,
      firstTensionWeek,
      totalCobros,
      totalPagos,
    }),
  };
}

/** Lo que hay que leer del cuadro antes de comprometer un pago. */
export function thirteenWeekWarnings(r: {
  openingBalance: number | null;
  weeks: WeekBucketDto[];
  minBalance: number | null;
  minBalanceWeek: string | null;
  firstTensionWeek: string | null;
  totalCobros: number;
  totalPagos: number;
}): string[] {
  const warnings: string[] = [];

  if (r.openingBalance === null) {
    warnings.push(
      'Falta el saldo de caja de partida. Sin él esto no es una previsión de tesorería, es la suma de los vencimientos: dice si las trece semanas son positivas, no si se llega a fin de mes.',
    );
  }

  if (r.firstTensionWeek) {
    warnings.push(
      `La caja se queda en negativo la semana del ${r.firstTensionWeek}. Es la fecha límite para hacer algo: adelantar una certificación, negociar un aplazamiento o tirar de póliza. Después ya no se decide, se sufre.`,
    );
  } else if (
    r.minBalance !== null &&
    r.minBalanceWeek !== null &&
    r.minBalance < r.totalPagos / TREASURY_HORIZON_WEEKS
  ) {
    warnings.push(
      `El punto más bajo del horizonte es la semana del ${r.minBalanceWeek} y queda por debajo de un pago semanal medio. No hay tensión, pero tampoco margen para un imprevisto.`,
    );
  }

  const previstos = round2(
    r.weeks.reduce((s, w) => s + w.cobrosPrevistos + w.pagosPrevistos, 0),
  );
  const total = round2(r.totalCobros + r.totalPagos);
  if (total > 0 && previstos / total > 0.4) {
    warnings.push(
      `El ${Math.round((previstos / total) * 100)} % del cuadro no tiene todavía vencimiento en firme: certificaciones sin facturar, facturas sin aprobar y albaranes sin factura. Son los que más se mueven de semana, y los que aparecen de golpe si nadie los tramita.`,
    );
  }

  const sinMovimiento = r.weeks.filter(
    (w) => w.cobros === 0 && w.pagos === 0,
  ).length;
  if (sinMovimiento >= TREASURY_HORIZON_WEEKS - 2) {
    warnings.push(
      'Casi todo el horizonte está vacío. O no hay facturas registradas con vencimiento, o los vencimientos caen más allá de trece semanas.',
    );
  }

  return warnings;
}
