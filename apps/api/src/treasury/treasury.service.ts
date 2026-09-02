import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, gte, isNull, lte, ne, SQL } from 'drizzle-orm';
import {
  certifications,
  contacts,
  deliveryNotes,
  invoices,
  paymentMilestones,
  projects,
} from '@erp/db';
import {
  CashflowBucketDto,
  CashflowGrouping,
  CashflowReportDto,
  CashItem,
  MilestoneDirection,
  MilestoneDto,
  MilestoneStatus,
  ThirteenWeekDto,
  addDays,
  addMonths,
  buildThirteenWeek,
  round2,
  startOfMonth,
  startOfWeek,
  todayIso,
} from '@erp/shared';
import { ComplianceService } from '../compliance/compliance.service';
import { DbService } from '../db/db.service';

const MONTHS_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

function bucketLabel(periodStart: string, groupBy: CashflowGrouping): string {
  if (groupBy === 'mes') {
    const [y, m] = periodStart.split('-');
    return `${MONTHS_ES[Number(m) - 1]} ${y}`;
  }
  const [, m, d] = periodStart.split('-');
  return `Sem. ${d}/${m}`;
}

@Injectable()
export class TreasuryService {
  constructor(
    private readonly dbs: DbService,
    private readonly compliance: ComplianceService,
  ) {}

  async milestones(options: {
    direction?: MilestoneDirection;
    status?: MilestoneStatus;
    from?: string;
    to?: string;
  }): Promise<MilestoneDto[]> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const filters: SQL[] = [
      eq(paymentMilestones.companyId, companyId),
      isNull(invoices.deletedAt),
      ne(invoices.status, 'anulada'),
    ];
    if (options.direction) {
      filters.push(eq(paymentMilestones.direction, options.direction));
    }
    if (options.status) {
      filters.push(eq(paymentMilestones.status, options.status));
    }
    if (options.from)
      filters.push(gte(paymentMilestones.dueDate, options.from));
    if (options.to) filters.push(lte(paymentMilestones.dueDate, options.to));

    const rows = await this.dbs.db
      .select({
        milestone: paymentMilestones,
        invoiceNumber: invoices.invoiceNumber,
        contactName: contacts.legalName,
      })
      .from(paymentMilestones)
      .innerJoin(invoices, eq(paymentMilestones.invoiceId, invoices.id))
      .innerJoin(contacts, eq(invoices.contactId, contacts.id))
      .where(and(...filters))
      .orderBy(asc(paymentMilestones.dueDate));

    return rows.map(({ milestone, invoiceNumber, contactName }) => ({
      id: milestone.id,
      invoiceId: milestone.invoiceId,
      invoiceNumber,
      contactName,
      direction: milestone.direction as MilestoneDirection,
      kind: milestone.kind as MilestoneDto['kind'],
      dueDate: milestone.dueDate,
      amount: Number(milestone.amount),
      status: milestone.status as MilestoneStatus,
      paidAt: milestone.paidAt,
    }));
  }

  /** Liquida o reabre un vencimiento y sincroniza el estado de la factura. */
  async setStatus(id: string, status: MilestoneStatus): Promise<void> {
    const [row] = await this.dbs.db
      .select()
      .from(paymentMilestones)
      .where(eq(paymentMilestones.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Vencimiento no encontrado');
    }
    if (row.status === status) {
      throw new ConflictException('El vencimiento ya está en ese estado');
    }
    // Homologación PRL: no se paga a una subcontrata bloqueada. Reabrir un
    // vencimiento sí se permite siempre (es deshacer, no comprometer dinero).
    if (status === 'pagado' && row.direction === 'pago') {
      const [invoice] = await this.dbs.db
        .select({ contactId: invoices.contactId })
        .from(invoices)
        .where(eq(invoices.id, row.invoiceId))
        .limit(1);
      if (invoice) {
        await this.compliance.assertCanTransact(
          invoice.contactId,
          'liquidar el pago',
        );
      }
    }
    await this.dbs.db.transaction(async (tx) => {
      await tx
        .update(paymentMilestones)
        .set({
          status,
          paidAt: status === 'pagado' ? todayIso() : null,
          updatedAt: new Date(),
        })
        .where(eq(paymentMilestones.id, id));

      // La factura queda pagada cuando no le quedan vencimientos previstos
      const [pending] = await tx
        .select({ id: paymentMilestones.id })
        .from(paymentMilestones)
        .where(
          and(
            eq(paymentMilestones.invoiceId, row.invoiceId),
            eq(paymentMilestones.status, 'previsto'),
          ),
        )
        .limit(1);
      await tx
        .update(invoices)
        .set({
          status: pending ? 'aprobada' : 'pagada',
          updatedAt: new Date(),
        })
        .where(
          and(eq(invoices.id, row.invoiceId), ne(invoices.status, 'anulada')),
        );
    });
  }

  /**
   * Previsión de flujo de caja: agrupa los vencimientos previstos por
   * semana o mes y marca con alerta de tensión los periodos en los que
   * el saldo acumulado (cobros - pagos) queda en negativo.
   */
  async cashflow(
    from?: string,
    to?: string,
    groupBy: CashflowGrouping = 'semana',
  ): Promise<CashflowReportDto> {
    const start = from ?? todayIso();
    const end = to ?? addDays(start, 90);
    const items = await this.milestones({
      status: 'previsto',
      from: start,
      to: end,
    });

    const keyOf = groupBy === 'mes' ? startOfMonth : startOfWeek;
    const step =
      groupBy === 'mes'
        ? (iso: string) => addMonths(iso, 1)
        : (iso: string) => addDays(iso, 7);

    // Construye todos los periodos del horizonte, aunque estén vacíos
    const totals = new Map<string, { cobros: number; pagos: number }>();
    for (let cursor = keyOf(start); cursor <= end; cursor = step(cursor)) {
      totals.set(cursor, { cobros: 0, pagos: 0 });
    }
    for (const item of items) {
      const key = keyOf(item.dueDate);
      const bucket = totals.get(key) ?? { cobros: 0, pagos: 0 };
      if (item.direction === 'cobro') bucket.cobros += item.amount;
      else bucket.pagos += item.amount;
      totals.set(key, bucket);
    }

    let saldo = 0;
    let alertas = 0;
    const buckets: CashflowBucketDto[] = [...totals.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([periodStart, t]) => {
        const cobros = round2(t.cobros);
        const pagos = round2(t.pagos);
        const neto = round2(cobros - pagos);
        saldo = round2(saldo + neto);
        const tension = saldo < 0;
        if (tension) alertas += 1;
        return {
          periodStart,
          label: bucketLabel(periodStart, groupBy),
          cobros,
          pagos,
          neto,
          saldoAcumulado: saldo,
          tension,
        };
      });

    return {
      from: start,
      to: end,
      groupBy,
      buckets,
      totalCobros: round2(buckets.reduce((s, b) => s + b.cobros, 0)),
      totalPagos: round2(buckets.reduce((s, b) => s + b.pagos, 0)),
      saldoFinal: saldo,
      alertas,
    };
  }

  /**
   * Tesorería a trece semanas.
   *
   * Además de los vencimientos ya facturados incorpora lo que va a pasar casi
   * seguro pero todavía no tiene factura: las certificaciones emitidas y sin
   * facturar (cobro) y los albaranes validados sin factura (pago). Dejarlos
   * fuera daría una previsión sistemáticamente optimista en los pagos, que es
   * el error caro: el cobro que no llega se nota, el pago que aparece de
   * repente hunde la semana.
   *
   * El saldo de partida entra como dato: es el de las cuentas, y el ERP no lo
   * sabe. Sin él se devuelven los importes pero ningún saldo.
   */
  async thirteenWeek(
    openingBalance: number | null,
    from?: string,
  ): Promise<ThirteenWeekDto> {
    const start = from ?? todayIso();
    const items: CashItem[] = [];

    // 1. Lo facturado y aprobado: deuda cierta con fecha.
    const vencimientos = await this.milestones({ status: 'previsto' });
    for (const m of vencimientos) {
      items.push({
        dueDate: m.dueDate,
        direction: m.direction,
        amount: m.amount,
        confirmed: true,
        concept: `${m.invoiceNumber} · ${m.contactName}`,
      });
    }

    // 2. Certificaciones emitidas y sin facturar: cobro a la vista.
    const certis = await this.dbs.db
      .select({
        certDate: certifications.certDate,
        periodAmount: certifications.periodAmount,
        retentionAmount: certifications.retentionAmount,
        projectCode: projects.code,
        terms: contacts.paymentTermsDays,
      })
      .from(certifications)
      .innerJoin(projects, eq(certifications.projectId, projects.id))
      .leftJoin(contacts, eq(projects.clientId, contacts.id))
      .where(
        and(
          eq(certifications.status, 'borrador'),
          isNull(certifications.deletedAt),
        ),
      );
    for (const c of certis) {
      // Lo que se cobra es el periodo menos la retención de garantía: la
      // retención se libera al final, no en este horizonte.
      const importe = round2(
        Number(c.periodAmount) - Number(c.retentionAmount),
      );
      if (importe <= 0) continue;
      items.push({
        dueDate: addDays(c.certDate, c.terms ?? 60),
        direction: 'cobro',
        amount: importe,
        confirmed: false,
        concept: `${c.projectCode} · certificación sin facturar`,
      });
    }

    // 3. Facturas de compra registradas y todavía sin aprobar.
    //
    // No generan vencimiento hasta que se aprueban, así que hoy son invisibles
    // para la tesorería. Pero el dinero se debe igual: si la aprobación se
    // retrasa una semana, la previsión de pagos sale vacía justo en el
    // horizonte en el que había que decidir. El error va en la dirección mala.
    const borradores = await this.dbs.db
      .select({
        issueDate: invoices.issueDate,
        dueDate: invoices.dueDate,
        invoiceNumber: invoices.invoiceNumber,
        contactName: contacts.legalName,
        terms: contacts.paymentTermsDays,
        total: invoices.totalAmount,
        retention: invoices.retentionAmount,
      })
      .from(invoices)
      .innerJoin(contacts, eq(invoices.contactId, contacts.id))
      .where(
        and(
          eq(invoices.kind, 'compra'),
          eq(invoices.status, 'borrador'),
          isNull(invoices.deletedAt),
        ),
      );
    for (const f of borradores) {
      // La retención de garantía no se paga en este horizonte: se libera al
      // final de la obra.
      const importe = round2(Number(f.total) - Number(f.retention ?? 0));
      if (importe <= 0) continue;
      items.push({
        dueDate: f.dueDate ?? addDays(f.issueDate, f.terms ?? 30),
        direction: 'pago',
        amount: importe,
        confirmed: false,
        concept: `${f.invoiceNumber} · ${f.contactName} (sin aprobar)`,
      });
    }

    // 4. Albaranes validados sin factura: el pago que aún no ha aparecido.
    const albaranes = await this.dbs.db
      .select({
        noteDate: deliveryNotes.noteDate,
        amount: deliveryNotes.amount,
        contactName: contacts.legalName,
        terms: contacts.paymentTermsDays,
      })
      .from(deliveryNotes)
      .innerJoin(contacts, eq(deliveryNotes.contactId, contacts.id))
      .where(
        and(isNull(deliveryNotes.invoiceId), isNull(deliveryNotes.deletedAt)),
      );
    for (const a of albaranes) {
      items.push({
        dueDate: addDays(a.noteDate, a.terms ?? 30),
        direction: 'pago',
        amount: Number(a.amount),
        confirmed: false,
        concept: `${a.contactName} · albarán sin factura`,
      });
    }

    return buildThirteenWeek(start, openingBalance, items);
  }
}
