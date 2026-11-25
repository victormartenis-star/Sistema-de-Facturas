import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql, SQL } from 'drizzle-orm';
import {
  lossProvisions,
  projects,
  type DbOrTx,
  type LossProvision,
  type Tx,
} from '@erp/db';
import {
  asientoProvisionPerdidas,
  calcularProvisionPerdidas,
  centsToNumeric,
  clavePeriodo,
  fromCents,
  provisionPerdidasAnularSchema,
  provisionPerdidasCierreSchema,
  provisionPerdidasContabilizarSchema,
  sumCents,
  toCents,
  type EstadoWip,
  type PropuestaProvisionPerdidasDto,
  type ProvisionPerdidasAnularInput,
  type ProvisionPerdidasCierreInput,
  type ProvisionPerdidasContabilizarInput,
  type ProvisionPerdidasDto,
  type ProvisionPerdidasPropuestaQuery,
  type ProvisionPerdidasQuery,
  type ResultadoCierreProvisionPerdidasDto,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { cambiarEstado } from '../common/cambiar-estado';
import { getRequestContext } from '../common/request-context';
import { verificarVersion } from '../common/version';
import { ContabilidadService } from '../contabilidad/contabilidad.service';
import { ControlPresupuestarioService } from '../cost-control/control-presupuestario.service';
import { DbService } from '../db/db.service';
import { WipService } from './wip.service';

/** Estados de obra en los que la pérdida ya está realizada: provisión 0. */
const OBRA_TERMINADA = ['finalizada', 'garantia', 'cerrada'] as const;

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

interface Obra {
  id: string;
  code: string;
  name: string;
  contractAmount: string | null;
  status: string;
}

const obraNoEncontrada = () =>
  new NotFoundException({
    code: 'PROJECT_NOT_FOUND',
    message: 'Obra no encontrada',
  });

function provisionDto(p: LossProvision, codigo: string): ProvisionPerdidasDto {
  const calc = calcularProvisionPerdidas({
    contrato: p.contractAmount,
    costeEstimadoCierre: p.estimatedCost,
    produccion: p.production,
    costeReal: p.actualCost,
    provisionAnterior: p.previousProvision,
    obraTerminada: p.projectFinished,
  });
  return {
    ...calc,
    id: p.id,
    projectId: p.projectId,
    codigo,
    periodo: clavePeriodo(p.year, p.month),
    fechaCierre: p.closingDate,
    produccion: fromCents(toCents(p.production)),
    costeReal: fromCents(toCents(p.actualCost)),
    estado: p.status as EstadoWip,
    asientoId: p.journalEntryId,
    contraAsientoId: p.reversalEntryId,
    motivoAnulacion: p.cancelReason,
    version: p.version,
  };
}

/**
 * Provisión por pérdidas previstas en obra (contratos onerosos, NRV 14 PGC y
 * adaptación sectorial de constructoras). Por obra y mes calcula la pérdida
 * total prevista (coste estimado al cierre del cuadro de márgenes − contrato),
 * descuenta la ya reconocida por el grado de avance (coste real − producción
 * ejecutada, como la obra en curso) y contabiliza solo el ajuste frente a la
 * provisión vigente: dotación 6954 (obra) a 4994 o exceso 4994 a 7954 (obra),
 * por `ContabilidadService.contabilizarEnTx`. Los cierres van en orden y solo
 * se anula el último, por contra-asiento.
 */
@Injectable()
export class ProvisionPerdidasService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly contabilidad: ContabilidadService,
    private readonly control: ControlPresupuestarioService,
    private readonly wip: WipService,
  ) {}

  /* ─────────────────────────── datos ─────────────────────────── */

  /** Obras de la empresa accesibles (una concreta si se indica). */
  private async obras(projectId?: string): Promise<Obra[]> {
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
      .select({
        id: projects.id,
        code: projects.code,
        name: projects.name,
        contractAmount: projects.contractAmount,
        status: projects.status,
      })
      .from(projects)
      .where(and(...filtros))
      .orderBy(asc(projects.code));
  }

  /** Último cierre contabilizado de una obra (o undefined). */
  private async ultimo(
    ex: DbOrTx,
    projectId: string,
  ): Promise<LossProvision | undefined> {
    const [p] = await ex
      .select()
      .from(lossProvisions)
      .where(
        and(
          eq(lossProvisions.companyId, this.dbs.getCompanyId()),
          eq(lossProvisions.projectId, projectId),
          eq(lossProvisions.status, 'contabilizado'),
        ),
      )
      .orderBy(desc(lossProvisions.year), desc(lossProvisions.month))
      .limit(1);
    return p;
  }

  /**
   * Magnitudes de una obra a la fecha de cierre, sin duplicar lógica:
   * producción ejecutada de la obra en curso y coste real / estimado al
   * cierre del cuadro de márgenes (una sola carga).
   */
  private async magnitudes(ex: DbOrTx, o: Obra, fecha: string) {
    const [produccion, proy] = await Promise.all([
      this.wip.produccionHasta(ex, o.id, fecha),
      this.control.proyeccionHasta(ex, o.id, o.contractAmount, fecha),
    ]);
    return {
      contrato: o.contractAmount,
      produccion,
      costeReal: proy.costeReal,
      costeEstimadoCierre: proy.costeEstimadoCierre,
      obraTerminada: (OBRA_TERMINADA as readonly string[]).includes(o.status),
    };
  }

  /* ─────────────────────────── consultas ─────────────────────────── */

  /** Cálculo (borrador) del cierre de un periodo, sin contabilizar. */
  async propuesta(
    q: ProvisionPerdidasPropuestaQuery,
  ): Promise<PropuestaProvisionPerdidasDto[]> {
    const p = leerPeriodo(q.periodo);
    const obras = await this.obras(q.projectId);
    if (q.projectId && obras.length === 0) throw obraNoEncontrada();
    const ids = obras.map((o) => o.id);
    const cerrados =
      ids.length === 0
        ? []
        : await this.dbs.db
            .select({ projectId: lossProvisions.projectId })
            .from(lossProvisions)
            .where(
              and(
                inArray(lossProvisions.projectId, ids),
                eq(lossProvisions.year, p.year),
                eq(lossProvisions.month, p.month),
                eq(lossProvisions.status, 'contabilizado'),
              ),
            );
    const yaCerradas = new Set(cerrados.map((c) => c.projectId));
    const out: PropuestaProvisionPerdidasDto[] = [];
    for (const o of obras) {
      // Sin contrato no hay ingreso previsto: se omite del listado general.
      if (!q.projectId && o.contractAmount === null) continue;
      const [m, ult] = await Promise.all([
        this.magnitudes(this.dbs.db, o, p.fechaCierre),
        this.ultimo(this.dbs.db, o.id),
      ]);
      const calc = calcularProvisionPerdidas({
        ...m,
        provisionAnterior: ult?.requiredProvision ?? '0',
      });
      // Solo interesan las obras con pérdida prevista o provisión que revertir.
      const sinNada = calc.perdidaTotal === 0 && calc.provisionAnterior === 0;
      if (!q.projectId && sinNada) continue;
      out.push({
        ...calc,
        projectId: o.id,
        codigo: o.code,
        nombre: o.name,
        periodo: p.periodo,
        fechaCierre: p.fechaCierre,
        produccion: fromCents(toCents(m.produccion)),
        costeReal: fromCents(toCents(m.costeReal)),
        obraTerminada: m.obraTerminada,
        contabilizado: yaCerradas.has(o.id),
        ultimoPeriodo: ult ? clavePeriodo(ult.year, ult.month) : null,
      });
    }
    return out;
  }

  async listar(q: ProvisionPerdidasQuery): Promise<ProvisionPerdidasDto[]> {
    const obras = await this.obras(q.projectId);
    if (obras.length === 0) return [];
    const codigo = new Map(obras.map((o) => [o.id, o.code]));
    const filtros: SQL[] = [
      eq(lossProvisions.companyId, this.dbs.getCompanyId()),
      inArray(lossProvisions.projectId, [...codigo.keys()]),
    ];
    if (q.estado) filtros.push(eq(lossProvisions.status, q.estado));
    if (q.periodo) {
      const p = leerPeriodo(q.periodo);
      filtros.push(
        eq(lossProvisions.year, p.year),
        eq(lossProvisions.month, p.month),
      );
    }
    const filas = await this.dbs.db
      .select()
      .from(lossProvisions)
      .where(and(...filtros))
      .orderBy(
        desc(lossProvisions.year),
        desc(lossProvisions.month),
        desc(lossProvisions.createdAt),
      );
    return filas.map((p) => provisionDto(p, codigo.get(p.projectId) ?? ''));
  }

  private async porId(id: string): Promise<ProvisionPerdidasDto> {
    const [p] = await this.dbs.db
      .select({ p: lossProvisions, codigo: projects.code })
      .from(lossProvisions)
      .innerJoin(projects, eq(projects.id, lossProvisions.projectId))
      .where(
        and(
          eq(lossProvisions.id, id),
          eq(lossProvisions.companyId, this.dbs.getCompanyId()),
        ),
      );
    if (!p) {
      throw new NotFoundException({
        code: 'LOSS_PROVISION_NOT_FOUND',
        message: 'Cierre de provisión por pérdidas no encontrado',
      });
    }
    return provisionDto(p.p, p.codigo);
  }

  /* ─────────────────────────── contabilizar ─────────────────────────── */

  /** Cierre de una obra y periodo dentro de su transacción. */
  private async contabilizarEnTx(tx: Tx, o: Obra, p: Periodo): Promise<string> {
    const companyId = this.dbs.getCompanyId();
    // Serializa cierres concurrentes de la misma obra.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`provision_perdidas:${o.id}`}))`,
    );
    const ult = await this.ultimo(tx, o.id);
    if (ult && ult.year === p.year && ult.month === p.month) {
      throw new ConflictException({
        code: 'LOSS_PROVISION_ALREADY_POSTED',
        message: `La obra ${o.code} ya tiene contabilizada la provisión por pérdidas de ${p.periodo}`,
      });
    }
    if (ult && clavePeriodo(ult.year, ult.month) > p.periodo) {
      throw new ConflictException({
        code: 'LOSS_PROVISION_PERIOD_OUT_OF_ORDER',
        message: `La obra ${o.code} ya tiene un cierre de provisión posterior (${clavePeriodo(ult.year, ult.month)}): anúlalo antes de cerrar ${p.periodo}`,
      });
    }
    const m = await this.magnitudes(tx, o, p.fechaCierre);
    const anterior = ult?.requiredProvision ?? '0';
    const calc = calcularProvisionPerdidas({
      ...m,
      provisionAnterior: anterior,
    });
    const id = randomUUID();
    const lineas = asientoProvisionPerdidas(calc.ajuste);
    let asientoId: string | null = null;
    if (lineas.length > 0) {
      const concepto = `Provisión por pérdidas previstas ${p.periodo} · ${o.code}`;
      const asiento = await this.contabilidad.contabilizarEnTx(tx, {
        companyId,
        fecha: p.fechaCierre,
        concepto,
        origen: 'provision_perdidas',
        origenId: id,
        lineas: lineas.map((l) => ({
          cuenta: l.cuenta,
          debe: l.debe,
          haber: l.haber,
          projectId: l.imputaObra ? o.id : null,
          concepto,
        })),
      });
      asientoId = asiento.id;
    }
    const n = (v: number) => centsToNumeric(toCents(v));
    const [row] = await tx
      .insert(lossProvisions)
      .values({
        id,
        companyId,
        projectId: o.id,
        year: p.year,
        month: p.month,
        closingDate: p.fechaCierre,
        contractAmount:
          m.contrato === null ? null : centsToNumeric(toCents(m.contrato)),
        estimatedCost: m.costeEstimadoCierre,
        production: m.produccion,
        actualCost: m.costeReal,
        projectFinished: m.obraTerminada,
        totalLoss: n(calc.perdidaTotal),
        recognizedLoss: n(calc.perdidaReconocida),
        requiredProvision: n(calc.provisionNecesaria),
        previousProvision: centsToNumeric(toCents(anterior)),
        adjustment: n(calc.ajuste),
        journalEntryId: asientoId,
        createdBy: getRequestContext()?.userId ?? null,
      })
      .returning();
    await this.audit.registrar(tx, {
      entityType: 'loss_provision',
      entityId: row.id,
      action: 'create',
      newData: row,
    });
    return row.id;
  }

  async contabilizar(
    input: ProvisionPerdidasContabilizarInput,
  ): Promise<ProvisionPerdidasDto> {
    const d = provisionPerdidasContabilizarSchema.parse(input);
    const [obra] = await this.obras(d.projectId);
    if (!obra) throw obraNoEncontrada();
    const id = await this.dbs.db.transaction((tx) =>
      this.contabilizarEnTx(tx, obra, leerPeriodo(d.periodo)),
    );
    return this.porId(id);
  }

  /**
   * Cierre del periodo para todas las obras con pérdida prevista o provisión
   * vigente: cada obra en su transacción; las rechazadas (periodo contable
   * cerrado, ya cerrada, fuera de orden) se informan y no bloquean al resto.
   */
  async cierre(
    input: ProvisionPerdidasCierreInput,
  ): Promise<ResultadoCierreProvisionPerdidasDto> {
    const { periodo } = provisionPerdidasCierreSchema.parse(input);
    const p = leerPeriodo(periodo);
    const pendientes = (await this.propuesta({ periodo })).filter(
      (o) => !o.contabilizado,
    );
    const obras = new Map((await this.obras()).map((o) => [o.id, o] as const));
    const res: ResultadoCierreProvisionPerdidasDto = {
      periodo,
      contabilizados: 0,
      ajuste: 0,
      omitidos: [],
    };
    const importes: bigint[] = [];
    for (const o of pendientes) {
      const obra = obras.get(o.projectId);
      if (!obra) continue;
      try {
        const id = await this.dbs.db.transaction((tx) =>
          this.contabilizarEnTx(tx, obra, p),
        );
        const r = await this.porId(id);
        res.contabilizados += 1;
        importes.push(toCents(r.ajuste));
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
    res.ajuste = fromCents(sumCents(importes));
    return res;
  }

  /* ─────────────────────────── anular ─────────────────────────── */

  /**
   * Anula el último cierre de una obra por contra-asiento (con su fecha: si
   * ese periodo contable está cerrado, FISCAL_PERIOD_CLOSED). La provisión
   * vigente vuelve a ser la del cierre anterior y el periodo puede cerrarse
   * de nuevo.
   */
  async anular(
    id: string,
    input: ProvisionPerdidasAnularInput,
    version: number | undefined,
  ): Promise<ProvisionPerdidasDto> {
    const { motivo } = provisionPerdidasAnularSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    const actual = await this.porId(id);
    const accesibles = await this.dbs.getObrasAccesibles();
    if (accesibles !== null && !accesibles.includes(actual.projectId)) {
      throw obraNoEncontrada();
    }
    await this.dbs.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`provision_perdidas:${actual.projectId}`}))`,
      );
      const [row] = await tx
        .select()
        .from(lossProvisions)
        .where(
          and(
            eq(lossProvisions.id, id),
            eq(lossProvisions.companyId, companyId),
          ),
        )
        .for('update');
      verificarVersion(row.version, version);
      if (row.status !== 'contabilizado') {
        throw new ConflictException({
          code: 'LOSS_PROVISION_ALREADY_CANCELLED',
          message: 'El cierre de provisión ya está anulado',
        });
      }
      const ult = await this.ultimo(tx, row.projectId);
      if (ult && ult.id !== row.id) {
        throw new ConflictException({
          code: 'LOSS_PROVISION_NOT_LATEST',
          message: `Solo se anula el último cierre de provisión de la obra (${clavePeriodo(ult.year, ult.month)})`,
        });
      }
      let contraId: string | null = null;
      if (row.journalEntryId) {
        const contra = await this.contabilidad.anularEnTx(
          tx,
          companyId,
          row.journalEntryId,
          `Anulación de provisión por pérdidas ${clavePeriodo(row.year, row.month)}: ${motivo}`,
          undefined,
        );
        contraId = contra.id;
      }
      await cambiarEstado(
        tx,
        lossProvisions,
        'loss_provision',
        id,
        'contabilizado',
        'anulado',
        { cancelReason: motivo, reversalEntryId: contraId },
        version,
      );
      await this.audit.registrar(tx, {
        entityType: 'loss_provision',
        entityId: id,
        action: 'update',
        oldData: { status: 'contabilizado' },
        newData: { status: 'anulado', motivo, contraAsientoId: contraId },
      });
    });
    return this.porId(id);
  }
}
