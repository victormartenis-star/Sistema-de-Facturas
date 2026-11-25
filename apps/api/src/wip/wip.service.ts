import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lte,
  sql,
  SQL,
} from 'drizzle-orm';
import {
  certifications,
  invoiceLines,
  invoices,
  projects,
  workInProgress,
  type DbOrTx,
  type Tx,
  type WorkInProgress,
} from '@erp/db';
import {
  CUENTAS_WIP,
  asientoRegularizacionWip,
  calcularWip,
  centsToNumeric,
  clavePeriodo,
  fromCents,
  sumCents,
  toCents,
  wipAnularSchema,
  wipCierreSchema,
  wipContabilizarSchema,
  type EstadoWip,
  type PropuestaWipDto,
  type ResultadoCierreWipDto,
  type WipAnularInput,
  type WipContabilizarInput,
  type WipCierreInput,
  type WipDto,
  type WipPropuestaQuery,
  type WipQuery,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { cambiarEstado } from '../common/cambiar-estado';
import { getRequestContext } from '../common/request-context';
import { verificarVersion } from '../common/version';
import { ContabilidadService } from '../contabilidad/contabilidad.service';
import { ControlPresupuestarioService } from '../cost-control/control-presupuestario.service';
import { DbService } from '../db/db.service';

/** Facturas de venta que cuentan como facturado. */
const VENTA_EMITIDA = ['aprobada', 'pagada', 'rectificada'] as const;

interface Periodo {
  periodo: string;
  year: number;
  month: number;
  /** Último día del mes: fecha del asiento. */
  fechaCierre: string;
}

function leerPeriodo(periodo: string): Periodo {
  const [year, month] = periodo.split('-').map(Number);
  const fechaCierre = new Date(Date.UTC(year, month, 0))
    .toISOString()
    .slice(0, 10);
  return { periodo, year, month, fechaCierre };
}

const obraNoEncontrada = () =>
  new NotFoundException({
    code: 'PROJECT_NOT_FOUND',
    message: 'Obra no encontrada',
  });

function wipDto(w: WorkInProgress, codigo: string): WipDto {
  const calc = calcularWip({
    produccion: w.production,
    facturado: w.invoiced,
    wipAnterior: w.previousWip,
    costeReal: w.actualCost,
  });
  return {
    ...calc,
    id: w.id,
    projectId: w.projectId,
    codigo,
    periodo: clavePeriodo(w.year, w.month),
    fechaCierre: w.closingDate,
    estado: w.status as EstadoWip,
    asientoId: w.journalEntryId,
    contraAsientoId: w.reversalEntryId,
    motivoAnulacion: w.cancelReason,
    version: w.version,
  };
}

/**
 * Obra en curso (WIP) al cierre de periodo, por el método del grado de avance
 * (NRV 14 PGC y adaptación sectorial de constructoras). Calcula por obra la
 * producción ejecutada y el facturado a origen y contabiliza solo la
 * regularización respecto del cierre anterior (4309 / 4389 contra 7050 de la
 * obra), por `ContabilidadService.contabilizarEnTx` (cuadre, cuentas y
 * periodo cerrado del mayor). Los cierres van en orden y solo se anula el
 * último, por contra-asiento.
 */
@Injectable()
export class WipService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly contabilidad: ContabilidadService,
    private readonly control: ControlPresupuestarioService,
  ) {}

  /* ─────────────────────────── datos ─────────────────────────── */

  /** Obras de la empresa accesibles (una concreta si se indica). */
  private async obras(projectId?: string) {
    const filtros: SQL[] = [
      eq(projects.companyId, this.dbs.getCompanyId()),
      isNull(projects.deletedAt),
    ];
    const accesibles = await this.dbs.getObrasAccesibles();
    if (accesibles !== null) {
      if (accesibles.length === 0) return [];
      filtros.push(inArray(projects.id, accesibles));
    }
    if (projectId) filtros.push(eq(projects.id, projectId));
    return this.dbs.db
      .select({ id: projects.id, code: projects.code, name: projects.name })
      .from(projects)
      .where(and(...filtros))
      .orderBy(asc(projects.code));
  }

  /** Último cierre contabilizado de una obra (o undefined). */
  private async ultimo(
    ex: DbOrTx,
    projectId: string,
  ): Promise<WorkInProgress | undefined> {
    const [w] = await ex
      .select()
      .from(workInProgress)
      .where(
        and(
          eq(workInProgress.companyId, this.dbs.getCompanyId()),
          eq(workInProgress.projectId, projectId),
          eq(workInProgress.status, 'contabilizado'),
        ),
      )
      .orderBy(desc(workInProgress.year), desc(workInProgress.month))
      .limit(1);
    return w;
  }

  /**
   * Producción ejecutada a origen hasta la fecha: última certificación a
   * origen (cualquier estado, no borrada). La comparte la provisión por
   * pérdidas previstas.
   */
  async produccionHasta(
    ex: DbOrTx,
    projectId: string,
    fecha: string,
  ): Promise<string> {
    const [cert] = await ex
      .select({ total: certifications.cumulativeAmount })
      .from(certifications)
      .where(
        and(
          eq(certifications.projectId, projectId),
          isNull(certifications.deletedAt),
          lte(certifications.certDate, fecha),
        ),
      )
      .orderBy(desc(certifications.seq))
      .limit(1);
    return centsToNumeric(toCents(cert?.total ?? '0'));
  }

  /** Producción, facturado y coste a origen de una obra hasta la fecha de cierre. */
  private async magnitudes(ex: DbOrTx, projectId: string, fecha: string) {
    const produccion = await this.produccionHasta(ex, projectId, fecha);
    const [fact] = await ex
      .select({
        total: sql<string>`coalesce(sum(${invoiceLines.baseAmount}), 0)`,
      })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .where(
        and(
          eq(invoiceLines.projectId, projectId),
          eq(invoices.kind, 'venta'),
          inArray(invoices.status, [...VENTA_EMITIDA]),
          isNull(invoices.deletedAt),
          lte(invoices.issueDate, fecha),
        ),
      );
    const coste = await this.control.costeRealHasta(ex, projectId, fecha);
    return {
      produccion,
      facturado: centsToNumeric(toCents(fact?.total ?? '0')),
      coste,
    };
  }

  /* ─────────────────────────── consultas ─────────────────────────── */

  /** Cálculo (borrador) del cierre de un periodo, sin contabilizar. */
  async propuesta(q: WipPropuestaQuery): Promise<PropuestaWipDto[]> {
    const p = leerPeriodo(q.periodo);
    const obras = await this.obras(q.projectId);
    if (q.projectId && obras.length === 0) throw obraNoEncontrada();
    const ids = obras.map((o) => o.id);
    const cerrados =
      ids.length === 0
        ? []
        : await this.dbs.db
            .select({ projectId: workInProgress.projectId })
            .from(workInProgress)
            .where(
              and(
                inArray(workInProgress.projectId, ids),
                eq(workInProgress.year, p.year),
                eq(workInProgress.month, p.month),
                eq(workInProgress.status, 'contabilizado'),
              ),
            );
    const yaCerradas = new Set(cerrados.map((c) => c.projectId));
    const out: PropuestaWipDto[] = [];
    for (const o of obras) {
      const [m, ult] = await Promise.all([
        this.magnitudes(this.dbs.db, o.id, p.fechaCierre),
        this.ultimo(this.dbs.db, o.id),
      ]);
      const calc = calcularWip({
        produccion: m.produccion,
        facturado: m.facturado,
        wipAnterior: ult?.wipAmount ?? '0',
        costeReal: m.coste,
      });
      // Sin producción, facturación ni WIP previo no hay nada que cerrar.
      const vacia =
        !q.projectId &&
        calc.produccion === 0 &&
        calc.facturado === 0 &&
        calc.wipAnterior === 0;
      if (vacia) continue;
      out.push({
        ...calc,
        projectId: o.id,
        codigo: o.code,
        nombre: o.name,
        periodo: p.periodo,
        fechaCierre: p.fechaCierre,
        contabilizado: yaCerradas.has(o.id),
        ultimoPeriodo: ult ? clavePeriodo(ult.year, ult.month) : null,
      });
    }
    return out;
  }

  async listar(q: WipQuery): Promise<WipDto[]> {
    const obras = await this.obras(q.projectId);
    if (obras.length === 0) return [];
    const codigo = new Map(obras.map((o) => [o.id, o.code]));
    const filtros: SQL[] = [
      eq(workInProgress.companyId, this.dbs.getCompanyId()),
      inArray(workInProgress.projectId, [...codigo.keys()]),
    ];
    if (q.estado) filtros.push(eq(workInProgress.status, q.estado));
    if (q.periodo) {
      const p = leerPeriodo(q.periodo);
      filtros.push(
        eq(workInProgress.year, p.year),
        eq(workInProgress.month, p.month),
      );
    }
    const filas = await this.dbs.db
      .select()
      .from(workInProgress)
      .where(and(...filtros))
      .orderBy(
        desc(workInProgress.year),
        desc(workInProgress.month),
        desc(workInProgress.createdAt),
      );
    return filas.map((w) => wipDto(w, codigo.get(w.projectId) ?? ''));
  }

  private async porId(id: string): Promise<WipDto> {
    const [w] = await this.dbs.db
      .select({ w: workInProgress, codigo: projects.code })
      .from(workInProgress)
      .innerJoin(projects, eq(projects.id, workInProgress.projectId))
      .where(
        and(
          eq(workInProgress.id, id),
          eq(workInProgress.companyId, this.dbs.getCompanyId()),
        ),
      );
    if (!w) {
      throw new NotFoundException({
        code: 'WIP_NOT_FOUND',
        message: 'Cierre de obra en curso no encontrado',
      });
    }
    return wipDto(w.w, w.codigo);
  }

  /* ─────────────────────────── contabilizar ─────────────────────────── */

  /** Cierre de una obra y periodo dentro de su transacción. */
  private async contabilizarEnTx(
    tx: Tx,
    projectId: string,
    codigo: string,
    p: Periodo,
  ): Promise<string> {
    const companyId = this.dbs.getCompanyId();
    // Serializa cierres concurrentes de la misma obra.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`wip:${projectId}`}))`,
    );
    const ult = await this.ultimo(tx, projectId);
    if (ult && ult.year === p.year && ult.month === p.month) {
      throw new ConflictException({
        code: 'WIP_ALREADY_POSTED',
        message: `La obra ${codigo} ya tiene contabilizada la obra en curso de ${p.periodo}`,
      });
    }
    if (ult && clavePeriodo(ult.year, ult.month) > p.periodo) {
      throw new ConflictException({
        code: 'WIP_PERIOD_OUT_OF_ORDER',
        message: `La obra ${codigo} ya tiene un cierre posterior (${clavePeriodo(ult.year, ult.month)}): anúlalo antes de cerrar ${p.periodo}`,
      });
    }
    const m = await this.magnitudes(tx, projectId, p.fechaCierre);
    const anterior = ult?.wipAmount ?? '0';
    const calc = calcularWip({
      produccion: m.produccion,
      facturado: m.facturado,
      wipAnterior: anterior,
      costeReal: m.coste,
    });
    const id = randomUUID();
    const lineas = asientoRegularizacionWip(anterior, calc.wip, CUENTAS_WIP);
    let asientoId: string | null = null;
    if (lineas.length > 0) {
      const concepto = `Obra en curso ${p.periodo} · ${codigo}`;
      const asiento = await this.contabilidad.contabilizarEnTx(tx, {
        companyId,
        fecha: p.fechaCierre,
        concepto,
        origen: 'obra_en_curso',
        origenId: id,
        lineas: lineas.map((l) => ({
          cuenta: l.cuenta,
          debe: l.debe,
          haber: l.haber,
          projectId: l.imputaObra ? projectId : null,
          concepto,
        })),
      });
      asientoId = asiento.id;
    }
    const [w] = await tx
      .insert(workInProgress)
      .values({
        id,
        companyId,
        projectId,
        year: p.year,
        month: p.month,
        closingDate: p.fechaCierre,
        production: m.produccion,
        invoiced: m.facturado,
        wipAmount: centsToNumeric(toCents(calc.wip)),
        previousWip: centsToNumeric(toCents(anterior)),
        adjustment: centsToNumeric(toCents(calc.regularizacion)),
        actualCost: m.coste,
        journalEntryId: asientoId,
        createdBy: getRequestContext()?.userId ?? null,
      })
      .returning();
    await this.audit.registrar(tx, {
      entityType: 'work_in_progress',
      entityId: w.id,
      action: 'create',
      newData: w,
    });
    return w.id;
  }

  async contabilizar(input: WipContabilizarInput): Promise<WipDto> {
    const d = wipContabilizarSchema.parse(input);
    const [obra] = await this.obras(d.projectId);
    if (!obra) throw obraNoEncontrada();
    const id = await this.dbs.db.transaction((tx) =>
      this.contabilizarEnTx(tx, obra.id, obra.code, leerPeriodo(d.periodo)),
    );
    return this.porId(id);
  }

  /**
   * Cierre del periodo para todas las obras con actividad: cada obra en su
   * transacción; las rechazadas (periodo contable cerrado, ya cerrada, fuera
   * de orden) se informan y no bloquean al resto.
   */
  async cierre(input: WipCierreInput): Promise<ResultadoCierreWipDto> {
    const { periodo } = wipCierreSchema.parse(input);
    const p = leerPeriodo(periodo);
    const pendientes = (await this.propuesta({ periodo })).filter(
      (o) => !o.contabilizado,
    );
    const res: ResultadoCierreWipDto = {
      periodo,
      contabilizados: 0,
      regularizacion: 0,
      omitidos: [],
    };
    const importes: bigint[] = [];
    for (const o of pendientes) {
      try {
        const id = await this.dbs.db.transaction((tx) =>
          this.contabilizarEnTx(tx, o.projectId, o.codigo, p),
        );
        const w = await this.porId(id);
        res.contabilizados += 1;
        importes.push(toCents(w.regularizacion));
      } catch (e) {
        if (!(e instanceof HttpException) || e.getStatus() >= 500) throw e;
        const cuerpo = e.getResponse() as { message?: string } | string;
        res.omitidos.push({
          projectId: o.projectId,
          codigo: o.codigo,
          motivo:
            typeof cuerpo === 'string' ? cuerpo : (cuerpo.message ?? e.message),
        });
      }
    }
    res.regularizacion = fromCents(sumCents(importes));
    return res;
  }

  /* ─────────────────────────── anular ─────────────────────────── */

  /**
   * Anula el último cierre de una obra por contra-asiento (con su fecha: si
   * ese periodo contable está cerrado, FISCAL_PERIOD_CLOSED). Tras anularlo
   * puede volver a cerrarse el periodo.
   */
  async anular(
    id: string,
    input: WipAnularInput,
    version: number | undefined,
  ): Promise<WipDto> {
    const { motivo } = wipAnularSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    const actual = await this.porId(id);
    const accesibles = await this.dbs.getObrasAccesibles();
    if (accesibles !== null && !accesibles.includes(actual.projectId)) {
      throw obraNoEncontrada();
    }
    await this.dbs.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`wip:${actual.projectId}`}))`,
      );
      const [w] = await tx
        .select()
        .from(workInProgress)
        .where(
          and(
            eq(workInProgress.id, id),
            eq(workInProgress.companyId, companyId),
          ),
        )
        .for('update');
      verificarVersion(w.version, version);
      if (w.status !== 'contabilizado') {
        throw new ConflictException({
          code: 'WIP_ALREADY_CANCELLED',
          message: 'El cierre ya está anulado',
        });
      }
      const ult = await this.ultimo(tx, w.projectId);
      if (ult && ult.id !== w.id) {
        throw new ConflictException({
          code: 'WIP_NOT_LATEST',
          message: `Solo se anula el último cierre de la obra (${clavePeriodo(ult.year, ult.month)})`,
        });
      }
      let contraId: string | null = null;
      if (w.journalEntryId) {
        const contra = await this.contabilidad.anularEnTx(
          tx,
          companyId,
          w.journalEntryId,
          `Anulación de obra en curso ${clavePeriodo(w.year, w.month)}: ${motivo}`,
          undefined,
        );
        contraId = contra.id;
      }
      await cambiarEstado(
        tx,
        workInProgress,
        'work_in_progress',
        id,
        'contabilizado',
        'anulado',
        { cancelReason: motivo, reversalEntryId: contraId },
        version,
      );
      await this.audit.registrar(tx, {
        entityType: 'work_in_progress',
        entityId: id,
        action: 'update',
        oldData: { status: 'contabilizado' },
        newData: { status: 'anulado', motivo, contraAsientoId: contraId },
      });
    });
    return this.porId(id);
  }
}
