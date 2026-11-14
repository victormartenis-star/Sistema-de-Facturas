import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  budgetItems,
  budgets,
  categories,
  certifications,
  certStatusEnum,
  contacts,
  deliveryNotes,
  deliveryNoteStatusEnum,
  invoiceLines,
  invoices,
  invoiceStatusEnum,
  milestoneStatusEnum,
  paymentMilestones,
  partesMaquinaria,
  partesPersonal,
  projectPhases,
  projects,
  projectStatusEnum,
  purchaseOrders,
} from '@erp/db';
import {
  centsToNumeric,
  computeIvaObra,
  EXPORT_MAX_FILAS,
  EXPORT_RECURSOS,
  ExportColumn,
  ExportJsonRow,
  ExportQuery,
  ExportRecurso,
  FacturaIvaInput,
  periodoIvaDeFecha,
  RangoPeriodoIva,
  rangoPeriodoIva,
  toCents,
  toCsv,
  toExportJson,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { CostControlService } from '../cost-control/cost-control.service';
import { DbService } from '../db/db.service';

/** Conjunto de filas ya leídas y listas para serializar. */
interface Dataset {
  total: number;
  csv: (opciones: {
    separador: ';' | ',';
    decimal: 'punto' | 'coma';
  }) => string;
  json: () => ExportJsonRow[];
}

function dataset<T>(columns: ExportColumn<T>[], rows: T[]): Dataset {
  return {
    total: rows.length,
    csv: (opciones) => toCsv(columns, rows, opciones),
    json: () => toExportJson(columns, rows),
  };
}

export interface ExportResult {
  contentType: string;
  fileName: string;
  body: string | ExportJsonRow[];
}

const ESTADOS_EMITIDA = ['aprobada', 'pagada', 'rectificada'] as const;

type Col<T> = ExportColumn<T>;
const texto = <T>(key: string, header: string, v: Col<T>['value']): Col<T> => ({
  key,
  header,
  type: 'texto',
  value: v,
});
const importe = <T>(
  key: string,
  header: string,
  v: Col<T>['value'],
): Col<T> => ({ key, header, type: 'importe', value: v });
const numero = <T>(
  key: string,
  header: string,
  v: Col<T>['value'],
): Col<T> => ({
  key,
  header,
  type: 'numero',
  value: v,
});
const fecha = <T>(key: string, header: string, v: Col<T>['value']): Col<T> => ({
  key,
  header,
  type: 'fecha',
  value: v,
});
const booleano = <T>(
  key: string,
  header: string,
  v: Col<T>['value'],
): Col<T> => ({ key, header, type: 'booleano', value: v });

const isoFecha = (d: Date | null) => (d ? d.toISOString() : null);
const resta = (a: string, b: string) => centsToNumeric(toCents(a) - toCents(b));

/**
 * Exportaciones CSV/JSON de recursos del ERP.
 *
 * Criterios fiscales aprobados por el titular: el periodo de IVA es
 * TRIMESTRAL y está implementado en `economia-iva`: el parámetro `periodo`
 * (`AAAA-T1`..`AAAA-T4`, ver `packages/shared/src/periodo-iva.ts`) deriva
 * `from`/`to`; si se indica junto a `from`/`to` que no coinciden, 400. El
 * dataset añade la columna `periodo` (trimestre de la consulta cuando el
 * rango cae en un único trimestre; vacía si abarca varios, porque las filas
 * agregan todo el rango). Facturae usa el método estándar para facturas no
 * enviadas previamente; y la clase de rectificativa (`total` / `diferencias`)
 * se elige siempre de forma explícita, sin valor por defecto (ver
 * `packages/shared/src/facturae.ts`).
 */
@Injectable()
export class ExportsService {
  constructor(
    private readonly dbs: DbService,
    private readonly costControl: CostControlService,
    private readonly audit: AuditService,
  ) {}

  async exportar(
    recurso: ExportRecurso,
    q: ExportQuery,
  ): Promise<ExportResult> {
    if (!(EXPORT_RECURSOS as readonly string[]).includes(recurso)) {
      throw new NotFoundException('Recurso de exportación no encontrado');
    }
    const ds = await this.cargar(recurso, q);
    if (ds.total > EXPORT_MAX_FILAS) {
      throw new UnprocessableEntityException(
        `La exportación supera ${EXPORT_MAX_FILAS} filas: acota el rango de fechas o la obra`,
      );
    }

    void this.audit.log({
      entityType: 'export',
      entityId: q.projectId ?? this.dbs.getCompanyId(),
      action: 'export',
      meta: {
        recurso,
        format: q.format,
        filas: ds.total,
        filtros: {
          projectId: q.projectId,
          budgetId: q.budgetId,
          from: q.from,
          to: q.to,
          status: q.status,
          kind: q.kind,
        },
      },
    });

    const dia = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    if (q.format === 'json') {
      return {
        contentType: 'application/json; charset=utf-8',
        fileName: `${recurso}-${dia}.json`,
        body: ds.json(),
      };
    }
    return {
      contentType: 'text/csv; charset=utf-8',
      fileName: `${recurso}-${dia}.csv`,
      body: ds.csv({ separador: q.sep, decimal: q.decimal }),
    };
  }

  private cargar(recurso: ExportRecurso, q: ExportQuery): Promise<Dataset> {
    switch (recurso) {
      case 'obras':
        return this.obras(q);
      case 'presupuesto-partidas':
        return this.presupuestoPartidas(q);
      case 'albaranes':
        return this.albaranes(q);
      case 'facturas':
        return this.facturas(q);
      case 'facturas-lineas':
        return this.facturasLineas(q);
      case 'certificaciones':
        return this.certificaciones(q);
      case 'partes-personal':
        return this.partesPersonal(q);
      case 'partes-maquinaria':
        return this.partesMaquinaria(q);
      case 'vencimientos':
        return this.vencimientos(q);
      case 'economia-desviaciones':
        return this.economiaDesviaciones(q);
      case 'economia-resumen':
        return this.economiaResumen(q);
      case 'economia-iva':
        return this.economiaIva(q);
    }
  }

  /* ───────────────────────── visibilidad y filtros ───────────────────────── */

  /**
   * Obras visibles para esta exportación: `null` = todas; lista = solo esas
   * (puede ser vacía). Usa `getObrasAccesibles()` como el resto de listados;
   * un `projectId` fuera de las obras accesibles es 404, como en la API.
   */
  private async obrasVisibles(projectId?: string): Promise<string[] | null> {
    const allowed = await this.dbs.getObrasAccesibles();
    if (projectId) {
      if (allowed !== null && !allowed.includes(projectId)) {
        throw new NotFoundException('Obra no encontrada');
      }
      const companyId = this.dbs.getCompanyId();
      const [p] = await this.dbs.db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.id, projectId),
            eq(projects.companyId, companyId),
            isNull(projects.deletedAt),
          ),
        )
        .limit(1);
      if (!p) throw new NotFoundException('Obra no encontrada');
      return [projectId];
    }
    return allowed;
  }

  private estado<T extends string>(
    valor: string | undefined,
    validos: readonly T[],
  ): T | undefined {
    if (valor === undefined) return undefined;
    if (!(validos as readonly string[]).includes(valor)) {
      throw new BadRequestException(
        `Estado no válido: ${valor}. Valores: ${validos.join(', ')}`,
      );
    }
    return valor as T;
  }

  private requerir(valor: string | undefined, nombre: string): string {
    if (!valor) {
      throw new BadRequestException(`El parámetro "${nombre}" es obligatorio`);
    }
    return valor;
  }

  private lineasEnObras(ids: string[]) {
    return this.dbs.db
      .select({ id: invoiceLines.invoiceId })
      .from(invoiceLines)
      .where(inArray(invoiceLines.projectId, ids));
  }

  /* ───────────────────────────── recursos ───────────────────────────── */

  private async obras(q: ExportQuery): Promise<Dataset> {
    const ids = await this.obrasVisibles(q.projectId);
    const estado = this.estado(q.status, projectStatusEnum.enumValues);
    type Fila = typeof projects.$inferSelect;
    const rows: Fila[] =
      ids !== null && ids.length === 0
        ? []
        : await this.dbs.db
            .select()
            .from(projects)
            .where(
              and(
                eq(projects.companyId, this.dbs.getCompanyId()),
                isNull(projects.deletedAt),
                ids ? inArray(projects.id, ids) : undefined,
                estado ? eq(projects.status, estado) : undefined,
              ),
            )
            .orderBy(asc(projects.code))
            .limit(EXPORT_MAX_FILAS + 1);
    return dataset<Fila>(
      [
        texto('code', 'Código', (r) => r.code),
        texto('name', 'Nombre', (r) => r.name),
        texto('status', 'Estado', (r) => r.status),
        fecha('startDate', 'Inicio', (r) => r.startDate),
        fecha('expectedEnd', 'Fin previsto', (r) => r.expectedEnd),
        importe(
          'contractAmount',
          'Importe de contrato',
          (r) => r.contractAmount,
        ),
        numero('retentionPct', 'Retención %', (r) => r.retentionPct),
      ],
      rows,
    );
  }

  private async presupuestoPartidas(q: ExportQuery): Promise<Dataset> {
    const projectId = this.requerir(q.projectId, 'projectId');
    await this.obrasVisibles(projectId);
    const [budget] = await this.dbs.db
      .select()
      .from(budgets)
      .where(
        and(
          eq(budgets.companyId, this.dbs.getCompanyId()),
          eq(budgets.projectId, projectId),
          isNull(budgets.deletedAt),
          q.budgetId
            ? eq(budgets.id, q.budgetId)
            : eq(budgets.status, 'activo'),
        ),
      )
      .limit(1);
    if (q.budgetId && !budget) {
      throw new NotFoundException('Presupuesto no encontrado');
    }
    const items = budget
      ? await this.dbs.db
          .select({ item: budgetItems, phaseCode: projectPhases.code })
          .from(budgetItems)
          .leftJoin(projectPhases, eq(budgetItems.phaseId, projectPhases.id))
          .where(eq(budgetItems.budgetId, budget.id))
          .orderBy(asc(budgetItems.level), asc(budgetItems.sortOrder))
          .limit(EXPORT_MAX_FILAS + 1)
      : [];
    type Fila = (typeof items)[number];
    return dataset<Fila>(
      [
        texto('budgetName', 'Presupuesto', () => budget?.name ?? null),
        texto('budgetStatus', 'Estado', () => budget?.status ?? null),
        texto('code', 'Código', (r) => r.item.code),
        texto('parentCode', 'Código padre', (r) => r.item.parentCode),
        numero('level', 'Nivel', (r) => r.item.level),
        texto('name', 'Resumen', (r) => r.item.name),
        texto('unit', 'Unidad', (r) => r.item.unit),
        numero('quantity', 'Cantidad', (r) => r.item.quantity),
        numero('unitPrice', 'Precio unitario', (r) => r.item.unitPrice),
        importe('totalAmount', 'Importe', (r) => r.item.totalAmount),
        texto('phaseCode', 'Partida', (r) => r.phaseCode),
      ],
      items,
    );
  }

  private async albaranes(q: ExportQuery): Promise<Dataset> {
    const ids = await this.obrasVisibles(q.projectId);
    const estado = this.estado(q.status, deliveryNoteStatusEnum.enumValues);
    const filas =
      ids !== null && ids.length === 0
        ? []
        : await this.dbs.db
            .select({
              note: deliveryNotes,
              contactName: contacts.legalName,
              contactTaxId: contacts.taxId,
              projectCode: projects.code,
              phaseCode: projectPhases.code,
              orderNumber: purchaseOrders.orderNumber,
              invoiceNumber: invoices.invoiceNumber,
            })
            .from(deliveryNotes)
            .innerJoin(contacts, eq(deliveryNotes.contactId, contacts.id))
            .leftJoin(projects, eq(deliveryNotes.projectId, projects.id))
            .leftJoin(
              projectPhases,
              eq(deliveryNotes.phaseId, projectPhases.id),
            )
            .leftJoin(
              purchaseOrders,
              eq(deliveryNotes.orderId, purchaseOrders.id),
            )
            .leftJoin(invoices, eq(deliveryNotes.invoiceId, invoices.id))
            .where(
              and(
                eq(deliveryNotes.companyId, this.dbs.getCompanyId()),
                isNull(deliveryNotes.deletedAt),
                ids ? inArray(deliveryNotes.projectId, ids) : undefined,
                estado ? eq(deliveryNotes.status, estado) : undefined,
                q.from ? gte(deliveryNotes.noteDate, q.from) : undefined,
                q.to ? lte(deliveryNotes.noteDate, q.to) : undefined,
              ),
            )
            .orderBy(
              desc(deliveryNotes.noteDate),
              asc(deliveryNotes.noteNumber),
            )
            .limit(EXPORT_MAX_FILAS + 1);
    type Fila = (typeof filas)[number];
    return dataset<Fila>(
      [
        texto('noteNumber', 'Nº albarán', (r) => r.note.noteNumber),
        fecha('noteDate', 'Fecha', (r) => r.note.noteDate),
        texto('contactName', 'Proveedor', (r) => r.contactName),
        texto('contactTaxId', 'NIF', (r) => r.contactTaxId),
        texto('projectCode', 'Obra', (r) => r.projectCode),
        texto('phaseCode', 'Partida', (r) => r.phaseCode),
        texto('orderNumber', 'Pedido', (r) => r.orderNumber),
        importe('amount', 'Importe', (r) => r.note.amount),
        texto('status', 'Estado', (r) => r.note.status),
        fecha('validatedAt', 'Validado el', (r) =>
          isoFecha(r.note.validatedAt),
        ),
        texto('invoiceNumber', 'Factura', (r) => r.invoiceNumber),
      ],
      filas,
    );
  }

  /** Filtros comunes de facturas (cabecera). */
  private filtrosFactura(
    q: ExportQuery,
    ids: string[] | null,
    estado: (typeof invoiceStatusEnum.enumValues)[number] | undefined,
  ): (SQL | undefined)[] {
    return [
      eq(invoices.companyId, this.dbs.getCompanyId()),
      isNull(invoices.deletedAt),
      q.kind ? eq(invoices.kind, q.kind) : undefined,
      estado ? eq(invoices.status, estado) : undefined,
      q.from ? gte(invoices.issueDate, q.from) : undefined,
      q.to ? lte(invoices.issueDate, q.to) : undefined,
      ids ? inArray(invoices.id, this.lineasEnObras(ids)) : undefined,
    ];
  }

  private async facturas(q: ExportQuery): Promise<Dataset> {
    const ids = await this.obrasVisibles(q.projectId);
    const estado = this.estado(q.status, invoiceStatusEnum.enumValues);
    const original = alias(invoices, 'original');
    const filas =
      ids !== null && ids.length === 0
        ? []
        : await this.dbs.db
            .select({
              invoice: invoices,
              contactName: contacts.legalName,
              contactTaxId: contacts.taxId,
              rectifiesNumber: original.invoiceNumber,
            })
            .from(invoices)
            .innerJoin(contacts, eq(invoices.contactId, contacts.id))
            .leftJoin(original, eq(invoices.rectifiesInvoiceId, original.id))
            .where(and(...this.filtrosFactura(q, ids, estado)))
            .orderBy(desc(invoices.issueDate), asc(invoices.invoiceNumber))
            .limit(EXPORT_MAX_FILAS + 1);
    type Fila = (typeof filas)[number];
    return dataset<Fila>(
      [
        texto('kind', 'Tipo', (r) => r.invoice.kind),
        texto('invoiceNumber', 'Nº factura', (r) => r.invoice.invoiceNumber),
        fecha('issueDate', 'Fecha', (r) => r.invoice.issueDate),
        fecha('dueDate', 'Vencimiento', (r) => r.invoice.dueDate),
        texto('contactName', 'Contacto', (r) => r.contactName),
        texto('contactTaxId', 'NIF', (r) => r.contactTaxId),
        texto('status', 'Estado', (r) => r.invoice.status),
        importe('baseAmount', 'Base imponible', (r) => r.invoice.baseAmount),
        importe('vatAmount', 'IVA', (r) => r.invoice.vatAmount),
        importe('totalAmount', 'Total', (r) => r.invoice.totalAmount),
        booleano('isp', 'ISP', (r) => r.invoice.isp),
        numero('retentionPct', 'Retención %', (r) => r.invoice.retentionPct),
        importe(
          'retentionAmount',
          'Retención',
          (r) => r.invoice.retentionAmount,
        ),
        importe('payableAmount', 'A pagar/cobrar ahora', (r) =>
          resta(r.invoice.totalAmount, r.invoice.retentionAmount),
        ),
        fecha(
          'retentionReleaseDate',
          'Liberación retención',
          (r) => r.invoice.retentionReleaseDate,
        ),
        texto(
          'rectifiesInvoiceNumber',
          'Rectifica a',
          (r) => r.rectifiesNumber,
        ),
        texto(
          'rectificationKind',
          'Clase de rectificación',
          (r) => r.invoice.rectificationKind,
        ),
      ],
      filas,
    );
  }

  private async facturasLineas(q: ExportQuery): Promise<Dataset> {
    const ids = await this.obrasVisibles(q.projectId);
    const estado = this.estado(q.status, invoiceStatusEnum.enumValues);
    const filas =
      ids !== null && ids.length === 0
        ? []
        : await this.dbs.db
            .select({
              invoice: invoices,
              line: invoiceLines,
              projectCode: projects.code,
              phaseCode: projectPhases.code,
              categoryName: categories.name,
            })
            .from(invoiceLines)
            .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
            .leftJoin(projects, eq(invoiceLines.projectId, projects.id))
            .leftJoin(projectPhases, eq(invoiceLines.phaseId, projectPhases.id))
            .leftJoin(categories, eq(invoiceLines.categoryId, categories.id))
            .where(
              and(
                ...this.filtrosFactura(q, null, estado),
                // Solo las líneas de las obras visibles.
                ids ? inArray(invoiceLines.projectId, ids) : undefined,
              ),
            )
            .orderBy(
              desc(invoices.issueDate),
              asc(invoices.invoiceNumber),
              asc(invoiceLines.sortOrder),
            )
            .limit(EXPORT_MAX_FILAS + 1);
    type Fila = (typeof filas)[number];
    return dataset<Fila>(
      [
        texto('invoiceNumber', 'Nº factura', (r) => r.invoice.invoiceNumber),
        texto('kind', 'Tipo', (r) => r.invoice.kind),
        fecha('issueDate', 'Fecha', (r) => r.invoice.issueDate),
        texto('status', 'Estado', (r) => r.invoice.status),
        texto('description', 'Descripción', (r) => r.line.description),
        importe('baseAmount', 'Base imponible', (r) => r.line.baseAmount),
        numero('vatPct', 'IVA %', (r) => r.line.vatPct),
        texto('projectCode', 'Obra', (r) => r.projectCode),
        texto('phaseCode', 'Partida', (r) => r.phaseCode),
        texto('categoryName', 'Categoría', (r) => r.categoryName),
      ],
      filas,
    );
  }

  private async certificaciones(q: ExportQuery): Promise<Dataset> {
    const ids = await this.obrasVisibles(q.projectId);
    const estado = this.estado(q.status, certStatusEnum.enumValues);
    const original = alias(certifications, 'original');
    const filas =
      ids !== null && ids.length === 0
        ? []
        : await this.dbs.db
            .select({
              cert: certifications,
              projectCode: projects.code,
              invoiceNumber: invoices.invoiceNumber,
              rectifiesSeq: original.seq,
            })
            .from(certifications)
            .innerJoin(projects, eq(certifications.projectId, projects.id))
            .leftJoin(invoices, eq(certifications.invoiceId, invoices.id))
            .leftJoin(
              original,
              eq(certifications.rectifiesCertificationId, original.id),
            )
            .where(
              and(
                eq(certifications.companyId, this.dbs.getCompanyId()),
                isNull(certifications.deletedAt),
                ids ? inArray(certifications.projectId, ids) : undefined,
                estado ? eq(certifications.status, estado) : undefined,
                q.from ? gte(certifications.certDate, q.from) : undefined,
                q.to ? lte(certifications.certDate, q.to) : undefined,
              ),
            )
            .orderBy(asc(projects.code), asc(certifications.seq))
            .limit(EXPORT_MAX_FILAS + 1);
    type Fila = (typeof filas)[number];
    return dataset<Fila>(
      [
        texto('projectCode', 'Obra', (r) => r.projectCode),
        numero('seq', 'Nº', (r) => r.cert.seq),
        fecha('certDate', 'Fecha', (r) => r.cert.certDate),
        numero('cumulativePct', '% acumulado', (r) => r.cert.cumulativePct),
        importe(
          'cumulativeAmount',
          'Importe acumulado',
          (r) => r.cert.cumulativeAmount,
        ),
        importe('previousAmount', 'Importe anterior', (r) =>
          resta(r.cert.cumulativeAmount, r.cert.periodAmount),
        ),
        importe(
          'periodAmount',
          'Importe del periodo',
          (r) => r.cert.periodAmount,
        ),
        numero('retentionPct', 'Retención %', (r) => r.cert.retentionPct),
        importe('retentionAmount', 'Retención', (r) => r.cert.retentionAmount),
        texto('status', 'Estado', (r) => r.cert.status),
        texto('invoiceNumber', 'Factura', (r) => r.invoiceNumber),
        numero('rectifiesSeq', 'Rectifica a nº', (r) => r.rectifiesSeq),
      ],
      filas,
    );
  }

  private async partesPersonal(q: ExportQuery): Promise<Dataset> {
    const ids = await this.obrasVisibles(q.projectId);
    const filas =
      ids !== null && ids.length === 0
        ? []
        : await this.dbs.db
            .select({
              parte: partesPersonal,
              projectCode: projects.code,
              phaseCode: projectPhases.code,
            })
            .from(partesPersonal)
            .innerJoin(projects, eq(partesPersonal.projectId, projects.id))
            .leftJoin(
              projectPhases,
              eq(partesPersonal.phaseId, projectPhases.id),
            )
            .where(
              and(
                eq(partesPersonal.companyId, this.dbs.getCompanyId()),
                isNull(partesPersonal.deletedAt),
                ids ? inArray(partesPersonal.projectId, ids) : undefined,
                q.from ? gte(partesPersonal.workDate, q.from) : undefined,
                q.to ? lte(partesPersonal.workDate, q.to) : undefined,
              ),
            )
            .orderBy(
              desc(partesPersonal.workDate),
              asc(partesPersonal.workerName),
            )
            .limit(EXPORT_MAX_FILAS + 1);
    type Fila = (typeof filas)[number];
    return dataset<Fila>(
      [
        fecha('workDate', 'Fecha', (r) => r.parte.workDate),
        texto('projectCode', 'Obra', (r) => r.projectCode),
        texto('phaseCode', 'Partida', (r) => r.phaseCode),
        texto('workerName', 'Trabajador', (r) => r.parte.workerName),
        numero(
          'ordinaryHours',
          'Horas ordinarias',
          (r) => r.parte.ordinaryHours,
        ),
        numero('overtimeHours', 'Horas extra', (r) => r.parte.overtimeHours),
        importe(
          'ordinaryRate',
          'Tarifa ordinaria',
          (r) => r.parte.ordinaryRate,
        ),
        importe('overtimeRate', 'Tarifa extra', (r) => r.parte.overtimeRate),
        importe('totalCost', 'Coste total', (r) => r.parte.totalCost),
        fecha('approvedAt', 'Aprobado el', (r) => isoFecha(r.parte.approvedAt)),
      ],
      filas,
    );
  }

  private async partesMaquinaria(q: ExportQuery): Promise<Dataset> {
    const ids = await this.obrasVisibles(q.projectId);
    const filas =
      ids !== null && ids.length === 0
        ? []
        : await this.dbs.db
            .select({
              parte: partesMaquinaria,
              projectCode: projects.code,
              phaseCode: projectPhases.code,
            })
            .from(partesMaquinaria)
            .innerJoin(projects, eq(partesMaquinaria.projectId, projects.id))
            .leftJoin(
              projectPhases,
              eq(partesMaquinaria.phaseId, projectPhases.id),
            )
            .where(
              and(
                eq(partesMaquinaria.companyId, this.dbs.getCompanyId()),
                isNull(partesMaquinaria.deletedAt),
                ids ? inArray(partesMaquinaria.projectId, ids) : undefined,
                q.from ? gte(partesMaquinaria.workDate, q.from) : undefined,
                q.to ? lte(partesMaquinaria.workDate, q.to) : undefined,
              ),
            )
            .orderBy(
              desc(partesMaquinaria.workDate),
              asc(partesMaquinaria.machineName),
            )
            .limit(EXPORT_MAX_FILAS + 1);
    type Fila = (typeof filas)[number];
    return dataset<Fila>(
      [
        fecha('workDate', 'Fecha', (r) => r.parte.workDate),
        texto('projectCode', 'Obra', (r) => r.projectCode),
        texto('phaseCode', 'Partida', (r) => r.phaseCode),
        texto('machineName', 'Máquina', (r) => r.parte.machineName),
        texto('ownership', 'Titularidad', (r) => r.parte.ownership),
        numero('hoursUsed', 'Horas', (r) => r.parte.hoursUsed),
        numero('fuelLiters', 'Combustible (l)', (r) => r.parte.fuelLiters),
        importe('hourlyRate', 'Tarifa horaria', (r) => r.parte.hourlyRate),
        importe('totalCost', 'Coste total', (r) => r.parte.totalCost),
        fecha('approvedAt', 'Aprobado el', (r) => isoFecha(r.parte.approvedAt)),
      ],
      filas,
    );
  }

  private async vencimientos(q: ExportQuery): Promise<Dataset> {
    const ids = await this.obrasVisibles(q.projectId);
    const estado = this.estado(q.status, milestoneStatusEnum.enumValues);
    const filas =
      ids !== null && ids.length === 0
        ? []
        : await this.dbs.db
            .select({
              milestone: paymentMilestones,
              invoiceNumber: invoices.invoiceNumber,
              contactName: contacts.legalName,
            })
            .from(paymentMilestones)
            .innerJoin(invoices, eq(paymentMilestones.invoiceId, invoices.id))
            .innerJoin(contacts, eq(invoices.contactId, contacts.id))
            .where(
              and(
                eq(paymentMilestones.companyId, this.dbs.getCompanyId()),
                isNull(invoices.deletedAt),
                q.kind ? eq(invoices.kind, q.kind) : undefined,
                estado ? eq(paymentMilestones.status, estado) : undefined,
                q.from ? gte(paymentMilestones.dueDate, q.from) : undefined,
                q.to ? lte(paymentMilestones.dueDate, q.to) : undefined,
                ids ? inArray(invoices.id, this.lineasEnObras(ids)) : undefined,
              ),
            )
            .orderBy(asc(paymentMilestones.dueDate))
            .limit(EXPORT_MAX_FILAS + 1);
    type Fila = (typeof filas)[number];
    return dataset<Fila>(
      [
        texto('invoiceNumber', 'Nº factura', (r) => r.invoiceNumber),
        texto('direction', 'Sentido', (r) => r.milestone.direction),
        texto('kind', 'Clase', (r) => r.milestone.kind),
        fecha('dueDate', 'Vencimiento', (r) => r.milestone.dueDate),
        importe('amount', 'Importe', (r) => r.milestone.amount),
        texto('status', 'Estado', (r) => r.milestone.status),
        fecha('paidAt', 'Pagado el', (r) => r.milestone.paidAt),
        texto('contactName', 'Contacto', (r) => r.contactName),
      ],
      filas,
    );
  }

  private async economiaDesviaciones(q: ExportQuery): Promise<Dataset> {
    const projectId = this.requerir(q.projectId, 'projectId');
    await this.obrasVisibles(projectId);
    const { desviaciones } = await this.costControl.getEconomics(projectId);
    type Fila = (typeof desviaciones)[number];
    return dataset<Fila>(
      [
        texto('phaseCode', 'Partida', (r) => r.code),
        texto('phaseName', 'Nombre', (r) => r.name),
        importe('budget', 'Presupuesto', (r) => r.budget),
        importe(
          'facturasCompra',
          'Facturas de compra',
          (r) => r.costes.facturasCompra,
        ),
        importe(
          'partesPersonal',
          'Partes de personal',
          (r) => r.costes.partesPersonal,
        ),
        importe(
          'partesMaquinaria',
          'Partes de maquinaria',
          (r) => r.costes.partesMaquinaria,
        ),
        importe('actual', 'Coste real', (r) => r.actual),
        importe('deviation', 'Desviación', (r) => r.deviation),
        numero('deviationPct', 'Desviación %', (r) => r.deviationPct),
        booleano('overBudget', 'Sobrecoste', (r) => r.overBudget),
      ],
      desviaciones,
    );
  }

  private async economiaResumen(q: ExportQuery): Promise<Dataset> {
    const estado = this.estado(q.status, projectStatusEnum.enumValues);
    const obras = await this.dbs.db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.companyId, this.dbs.getCompanyId()),
          isNull(projects.deletedAt),
          q.projectId ? eq(projects.id, q.projectId) : undefined,
          estado ? eq(projects.status, estado) : undefined,
        ),
      )
      .orderBy(asc(projects.code))
      .limit(EXPORT_MAX_FILAS + 1);
    const filas = [];
    for (const p of obras) {
      const e = await this.costControl.getEconomics(p.id);
      filas.push({ p, e });
    }
    type Fila = (typeof filas)[number];
    return dataset<Fila>(
      [
        texto('projectCode', 'Obra', (r) => r.p.code),
        texto('projectName', 'Nombre', (r) => r.p.name),
        importe('certificado', 'Certificado', (r) => r.e.margen.certificado),
        importe(
          'facturadoVenta',
          'Facturado',
          (r) => r.e.margen.facturadoVenta,
        ),
        importe('costeReal', 'Coste real', (r) => r.e.margen.costeReal),
        importe(
          'margenSobreCertificado',
          'Margen s/ certificado',
          (r) => r.e.margen.margenSobreCertificado,
        ),
        numero(
          'margenSobreCertificadoPct',
          'Margen s/ certificado %',
          (r) => r.e.margen.margenSobreCertificadoPct,
        ),
        importe(
          'pendienteFacturar',
          'Pendiente de facturar',
          (r) => r.e.margen.pendienteFacturar,
        ),
        importe(
          'retencionPendienteCliente',
          'Retención pendiente de cobrar',
          (r) => r.e.retenciones.aCobrarDeCliente.pendiente,
        ),
        importe(
          'retencionPendienteProveedores',
          'Retención pendiente de pagar',
          (r) => r.e.retenciones.aPagarAProveedores.pendiente,
        ),
      ],
      filas,
    );
  }

  private async economiaIva(q: ExportQuery): Promise<Dataset> {
    let { from, to } = q;
    if (q.periodo !== undefined) {
      let rango: RangoPeriodoIva;
      try {
        rango = rangoPeriodoIva(q.periodo);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      if (
        (from !== undefined && from !== rango.from) ||
        (to !== undefined && to !== rango.to)
      ) {
        throw new BadRequestException(
          `"periodo" ${q.periodo} (${rango.from}..${rango.to}) no coincide con from/to indicados`,
        );
      }
      from = rango.from;
      to = rango.to;
    }
    from = this.requerir(from, 'from');
    to = this.requerir(to, 'to');
    let periodo: string | null = null;
    try {
      const p = periodoIvaDeFecha(from);
      periodo = p === periodoIvaDeFecha(to) ? p : null;
    } catch {
      periodo = null; // fuera del dominio de periodos: columna vacía
    }
    await this.obrasVisibles(q.projectId);
    const lineas = await this.dbs.db
      .select({
        invoiceId: invoiceLines.invoiceId,
        kind: invoices.kind,
        isp: invoices.isp,
        baseAmount: invoiceLines.baseAmount,
        vatPct: invoiceLines.vatPct,
        projectId: invoiceLines.projectId,
      })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
      .where(
        and(
          eq(invoices.companyId, this.dbs.getCompanyId()),
          isNull(invoices.deletedAt),
          inArray(invoices.status, [...ESTADOS_EMITIDA]),
          gte(invoices.issueDate, from),
          lte(invoices.issueDate, to),
          // Con obra: todas las líneas de las facturas que la tocan (pesos del
          // prorrateo del IVA); computeIvaObra devuelve solo la parte de la obra.
          q.projectId
            ? inArray(
                invoiceLines.invoiceId,
                this.dbs.db
                  .select({ id: invoiceLines.invoiceId })
                  .from(invoiceLines)
                  .where(eq(invoiceLines.projectId, q.projectId)),
              )
            : undefined,
        ),
      );
    const porFactura = new Map<string, FacturaIvaInput>();
    for (const l of lineas) {
      const f = porFactura.get(l.invoiceId) ?? {
        kind: l.kind,
        isp: l.isp,
        lines: [],
      };
      f.lines.push({
        baseAmount: Number(l.baseAmount),
        vatPct: Number(l.vatPct),
        projectId: l.projectId,
      });
      porFactura.set(l.invoiceId, f);
    }
    const iva = computeIvaObra([...porFactura.values()], q.projectId);
    interface Fila {
      periodo: string | null;
      lado: string;
      vatPct: number | null;
      baseAmount: number;
      vatAmount: number;
    }
    const filas: Fila[] = [
      ...iva.repercutido.map((g) => ({ periodo, lado: 'repercutido', ...g })),
      ...iva.soportado.map((g) => ({ periodo, lado: 'soportado', ...g })),
      {
        periodo,
        lado: 'isp_emitida',
        vatPct: null,
        baseAmount: iva.ispEmitidas.baseAmount,
        vatAmount: 0,
      },
      {
        periodo,
        lado: 'isp_recibida',
        vatPct: null,
        baseAmount: iva.ispRecibidas.baseAmount,
        vatAmount: iva.ispRecibidas.selfAssessedVat,
      },
    ];
    return dataset<Fila>(
      [
        texto('periodo', 'Periodo', (r) => r.periodo),
        texto('lado', 'Lado', (r) => r.lado),
        numero('vatPct', 'IVA %', (r) => r.vatPct),
        importe('baseAmount', 'Base', (r) => r.baseAmount),
        importe('vatAmount', 'Cuota', (r) => r.vatAmount),
      ],
      filas,
    );
  }
}
