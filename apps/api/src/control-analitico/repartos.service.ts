import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  allocationCycleReceivers,
  allocationCycleSenders,
  allocationCycles,
  allocationRunLines,
  allocationRuns,
  costCenters,
  projects,
  type AllocationCycle,
  type AllocationRun,
  type DbOrTx,
  type Tx,
} from '@erp/db';
import {
  centsToNumeric,
  cicloRepartoCompletoSchema,
  cicloRepartoCreateSchema,
  cicloRepartoUpdateSchema,
  periodoRepartoSchema,
  repartoCiclo,
  revertirRepartoSchema,
  toCents,
  type CicloRepartoCreateInput,
  type CicloRepartoDto,
  type CicloRepartoUpdateInput,
  type CriterioReparto,
  type EjecucionRepartoDto,
  type LineaRepartoDto,
  type PeriodoReparto,
  type ReceptorCicloDto,
  type RevertirRepartoInput,
  type SimulacionRepartoDto,
  type TipoCicloReparto,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { verificarVersion } from '../common/version';
import { DbService } from '../db/db.service';
import { exigirPeriodoAbierto, saldosCentros } from './analitica';
import { centroNoEncontrado } from './centros-coste.service';

const cicloNoEncontrado = () =>
  new NotFoundException({
    code: 'ALLOCATION_CYCLE_NOT_FOUND',
    message: 'Ciclo de reparto no encontrado',
  });

interface ReceptorEntrada {
  projectId?: string | null;
  costCenterId?: string | null;
  pesoPct?: number | null;
}

interface CicloCargado {
  c: AllocationCycle;
  emisores: { centroId: string; codigo: string; nombre: string }[];
  receptores: ReceptorCicloDto[];
}

/**
 * Ciclos de reparto (SAP KSV1/KSU1 y su ejecución KSV5/KSU5). Una ejecución
 * es un documento del mayor analítico: por periodo y ciclo solo hay una
 * vigente, se revierte en orden inverso (la última vigente de la empresa) y
 * ni se ejecuta ni se revierte en periodos contables cerrados. No genera
 * asientos FI: el coste no se duplica ni cambia el resultado.
 */
@Injectable()
export class RepartosService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  private ctx() {
    return this.dbs.getContext();
  }

  /* ───────────────────────────── carga ───────────────────────────── */

  private async cargar(ex: DbOrTx, id: string): Promise<CicloCargado> {
    const companyId = this.ctx().companyId;
    const [c] = await ex
      .select()
      .from(allocationCycles)
      .where(
        and(
          eq(allocationCycles.id, id),
          eq(allocationCycles.companyId, companyId),
        ),
      );
    if (!c) throw cicloNoEncontrado();
    return (await this.componer(ex, [c]))[0];
  }

  private async componer(
    ex: DbOrTx,
    cs: AllocationCycle[],
  ): Promise<CicloCargado[]> {
    if (cs.length === 0) return [];
    const ids = cs.map((c) => c.id);
    const [emisores, receptores] = await Promise.all([
      ex
        .select({
          cycleId: allocationCycleSenders.cycleId,
          centroId: costCenters.id,
          codigo: costCenters.code,
          nombre: costCenters.name,
        })
        .from(allocationCycleSenders)
        .innerJoin(
          costCenters,
          eq(costCenters.id, allocationCycleSenders.costCenterId),
        )
        .where(inArray(allocationCycleSenders.cycleId, ids))
        .orderBy(asc(costCenters.code)),
      ex
        .select({
          r: allocationCycleReceivers,
          obraCodigo: projects.code,
          obraNombre: projects.name,
          centroCodigo: costCenters.code,
          centroNombre: costCenters.name,
        })
        .from(allocationCycleReceivers)
        .leftJoin(projects, eq(projects.id, allocationCycleReceivers.projectId))
        .leftJoin(
          costCenters,
          eq(costCenters.id, allocationCycleReceivers.costCenterId),
        )
        .where(inArray(allocationCycleReceivers.cycleId, ids))
        .orderBy(asc(allocationCycleReceivers.id)),
    ]);
    return cs.map((c) => ({
      c,
      emisores: emisores
        .filter((e) => e.cycleId === c.id)
        .map(({ centroId, codigo, nombre }) => ({ centroId, codigo, nombre })),
      receptores: receptores
        .filter((x) => x.r.cycleId === c.id)
        .map((x) => ({
          tipo: x.r.projectId ? ('obra' as const) : ('centro' as const),
          id: (x.r.projectId ?? x.r.costCenterId)!,
          codigo: (x.obraCodigo ?? x.centroCodigo)!,
          nombre: (x.obraNombre ?? x.centroNombre)!,
          pesoPct: x.r.weightPct === null ? null : Number(x.r.weightPct),
        }))
        // Orden estable de receptores (desempate determinista del resto).
        .sort((a, b) =>
          a.tipo === b.tipo
            ? a.codigo.localeCompare(b.codigo)
            : a.tipo === 'obra'
              ? -1
              : 1,
        ),
    }));
  }

  private dto(x: CicloCargado): CicloRepartoDto {
    return {
      id: x.c.id,
      codigo: x.c.code,
      nombre: x.c.name,
      tipo: x.c.type as TipoCicloReparto,
      criterio: x.c.basis as CriterioReparto,
      cuentaImputacion: x.c.assessmentAccount,
      activo: x.c.isActive,
      emisores: x.emisores,
      receptores: x.receptores,
      version: x.c.version,
    };
  }

  async listar(): Promise<CicloRepartoDto[]> {
    const cs = await this.dbs.db
      .select()
      .from(allocationCycles)
      .where(eq(allocationCycles.companyId, this.ctx().companyId))
      .orderBy(asc(allocationCycles.code));
    return (await this.componer(this.dbs.db, cs)).map((x) => this.dto(x));
  }

  async obtener(id: string): Promise<CicloRepartoDto> {
    return this.dto(await this.cargar(this.dbs.db, id));
  }

  /* ────────────────────────── alta y edición ────────────────────────── */

  /** Emisores y receptores de la empresa; obras accesibles para el usuario. */
  private async validarMiembros(
    tx: Tx,
    emisores: string[],
    receptores: ReceptorEntrada[],
  ) {
    const companyId = this.ctx().companyId;
    const centros = [
      ...new Set([
        ...emisores,
        ...receptores
          .map((r) => r.costCenterId)
          .filter((x): x is string => !!x),
      ]),
    ];
    const encontrados = await tx
      .select({ id: costCenters.id })
      .from(costCenters)
      .where(
        and(
          eq(costCenters.companyId, companyId),
          inArray(costCenters.id, centros),
        ),
      );
    if (encontrados.length !== centros.length) throw centroNoEncontrado();
    const obras = receptores
      .map((r) => r.projectId)
      .filter((x): x is string => !!x);
    if (obras.length > 0) {
      const accesibles = await this.dbs.getObrasAccesibles();
      const ok = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.companyId, companyId),
            isNull(projects.deletedAt),
            inArray(projects.id, obras),
          ),
        );
      if (
        ok.length !== new Set(obras).size ||
        (accesibles !== null && obras.some((o) => !accesibles.includes(o)))
      ) {
        throw new NotFoundException({
          code: 'PROJECT_NOT_FOUND',
          message: 'Alguna obra receptora no existe o no es accesible',
        });
      }
    }
  }

  private async escribirMiembros(
    tx: Tx,
    cycleId: string,
    emisores: string[],
    receptores: ReceptorEntrada[],
  ) {
    const companyId = this.ctx().companyId;
    await tx
      .delete(allocationCycleSenders)
      .where(eq(allocationCycleSenders.cycleId, cycleId));
    await tx
      .delete(allocationCycleReceivers)
      .where(eq(allocationCycleReceivers.cycleId, cycleId));
    await tx.insert(allocationCycleSenders).values(
      [...new Set(emisores)].map((costCenterId) => ({
        companyId,
        cycleId,
        costCenterId,
      })),
    );
    await tx.insert(allocationCycleReceivers).values(
      receptores.map((r) => ({
        companyId,
        cycleId,
        projectId: r.projectId ?? null,
        costCenterId: r.costCenterId ?? null,
        weightPct: r.pesoPct ? r.pesoPct.toFixed(4) : null,
      })),
    );
  }

  async crear(input: CicloRepartoCreateInput): Promise<CicloRepartoDto> {
    const d = cicloRepartoCreateSchema.parse(input);
    const { companyId, userId } = this.ctx();
    const id = await this.dbs.db.transaction(async (tx) => {
      await this.validarMiembros(tx, d.emisores, d.receptores);
      const [c] = await tx
        .insert(allocationCycles)
        .values({
          companyId,
          code: d.codigo,
          name: d.nombre,
          type: d.tipo,
          basis: d.criterio,
          assessmentAccount: d.cuentaImputacion ?? null,
          createdBy: userId,
        })
        .onConflictDoNothing()
        .returning();
      if (!c) {
        throw new ConflictException({
          code: 'ALLOCATION_CODE_DUPLICATE',
          message: `Ya existe el ciclo ${d.codigo}`,
        });
      }
      await this.escribirMiembros(tx, c.id, d.emisores, d.receptores);
      await this.audit.registrar(tx, {
        entityType: 'allocation_cycle',
        entityId: c.id,
        action: 'create',
        newData: { ...c, emisores: d.emisores, receptores: d.receptores },
      });
      return c.id;
    });
    return this.obtener(id);
  }

  async actualizar(
    id: string,
    input: CicloRepartoUpdateInput,
    version?: number,
  ): Promise<CicloRepartoDto> {
    const d = cicloRepartoUpdateSchema.parse(input);
    await this.dbs.db.transaction(async (tx) => {
      const [bloqueado] = await tx
        .select()
        .from(allocationCycles)
        .where(
          and(
            eq(allocationCycles.id, id),
            eq(allocationCycles.companyId, this.ctx().companyId),
          ),
        )
        .for('update');
      if (!bloqueado) throw cicloNoEncontrado();
      verificarVersion(bloqueado.version, version);
      const actual = (await this.componer(tx, [bloqueado]))[0];
      // Estado resultante completo, validado con las mismas reglas del alta.
      const resultado = cicloRepartoCompletoSchema.safeParse({
        nombre: d.nombre ?? bloqueado.name,
        tipo: d.tipo ?? bloqueado.type,
        criterio: d.criterio ?? bloqueado.basis,
        cuentaImputacion:
          d.cuentaImputacion !== undefined
            ? d.cuentaImputacion
            : bloqueado.assessmentAccount,
        emisores: d.emisores ?? actual.emisores.map((e) => e.centroId),
        receptores:
          d.receptores ??
          actual.receptores.map((r) => ({
            projectId: r.tipo === 'obra' ? r.id : null,
            costCenterId: r.tipo === 'centro' ? r.id : null,
            pesoPct: r.pesoPct,
          })),
      });
      if (!resultado.success) {
        throw new UnprocessableEntityException({
          code: 'VALIDATION_ERROR',
          message: resultado.error.issues.map((i) => i.message).join('; '),
        });
      }
      const n = resultado.data;
      if (d.emisores || d.receptores) {
        await this.validarMiembros(tx, n.emisores, n.receptores);
        await this.escribirMiembros(tx, id, n.emisores, n.receptores);
      }
      const [nuevo] = await tx
        .update(allocationCycles)
        .set({
          name: n.nombre,
          type: n.tipo,
          basis: n.criterio,
          assessmentAccount: n.cuentaImputacion ?? null,
          ...(d.activo !== undefined && { isActive: d.activo }),
          version: bloqueado.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(allocationCycles.id, id))
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'allocation_cycle',
        entityId: id,
        action: 'update',
        oldData: this.dto(actual),
        newData: { ...nuevo, emisores: n.emisores, receptores: n.receptores },
      });
    });
    return this.obtener(id);
  }

  /* ──────────────────────── cálculo del reparto ──────────────────────── */

  /** Peso de cada obra receptora según el criterio del ciclo. */
  private async pesos(
    ex: DbOrTx,
    criterio: CriterioReparto,
    obras: string[],
    p: PeriodoReparto,
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>(obras.map((o) => [o, '0']));
    if (obras.length === 0 || criterio === 'porcentaje') return out;
    const ids = sql.join(
      obras.map((o) => sql`${o}`),
      sql`, `,
    );
    const consulta =
      criterio === 'presupuesto'
        ? sql`select b.project_id as obra, coalesce(sum(bi.total_amount), 0)::text as peso
            from budgets b join budget_items bi on bi.budget_id = b.id
            where b.project_id in (${ids}) and b.status = 'activo' and b.deleted_at is null
            group by b.project_id`
        : criterio === 'produccion'
          ? sql`select p.id as obra, (
                coalesce((select c.cumulative_amount from certifications c where c.project_id = p.id
                  and c.deleted_at is null and c.cert_date <= ${p.hasta} order by c.seq desc limit 1), 0)
              - coalesce((select c.cumulative_amount from certifications c where c.project_id = p.id
                  and c.deleted_at is null and c.cert_date < ${p.desde} order by c.seq desc limit 1), 0)
              )::text as peso
              from projects p where p.id in (${ids})`
          : sql`select pp.project_id as obra,
                coalesce(sum(pp.ordinary_hours + coalesce(pp.overtime_hours, 0)), 0)::text as peso
              from partes_personal pp
              where pp.project_id in (${ids}) and pp.deleted_at is null
                and pp.work_date between ${p.desde} and ${p.hasta}
              group by pp.project_id`;
    const r = await ex.execute(consulta);
    for (const f of r.rows as { obra: string; peso: string }[]) {
      // Una producción negativa (abono) no resta base: cuenta como cero.
      out.set(f.obra, toCents(f.peso) > 0n ? f.peso : '0');
    }
    return out;
  }

  private async calcular(
    ex: DbOrTx,
    x: CicloCargado,
    p: PeriodoReparto,
  ): Promise<SimulacionRepartoDto> {
    const companyId = this.ctx().companyId;
    const criterio = x.c.basis as CriterioReparto;
    const obras = x.receptores
      .filter((r) => r.tipo === 'obra')
      .map((r) => r.id);
    const [pesos, saldos] = await Promise.all([
      this.pesos(ex, criterio, obras, p),
      saldosCentros(
        ex,
        companyId,
        p,
        x.emisores.map((e) => e.centroId),
      ),
    ]);
    const receptores = x.receptores.map((r) => ({
      clave: `${r.tipo}:${r.id}`,
      peso:
        criterio === 'porcentaje' ? (r.pesoPct ?? 0) : (pesos.get(r.id) ?? '0'),
    }));
    if (receptores.every((r) => toCents(r.peso) === 0n)) {
      throw new UnprocessableEntityException({
        code: 'ALLOCATION_NO_BASE',
        message: `Ningún receptor tiene base de reparto (${criterio}) en el periodo`,
      });
    }
    const emisores = saldos.map((s) => ({
      centroId: s.centroId,
      partidas: s.porCuenta
        .filter((c) => c.saldo !== 0)
        .map((c) => ({ cuenta: c.cuenta, importe: c.saldo })),
    }));
    const r = repartoCiclo({
      tipo: x.c.type as TipoCicloReparto,
      cuentaImputacion: x.c.assessmentAccount,
      emisores,
      receptores,
    });
    const porClave = new Map(
      x.receptores.map((rc) => [`${rc.tipo}:${rc.id}`, rc]),
    );
    const codigoEmisor = new Map(x.emisores.map((e) => [e.centroId, e.codigo]));
    const lineas: LineaRepartoDto[] = r.lineas.map((l) => {
      const rc = porClave.get(l.receptor)!;
      return {
        ...l,
        emisorCodigo: codigoEmisor.get(l.emisor) ?? '',
        receptorTipo: rc.tipo,
        receptorId: rc.id,
        receptorCodigo: rc.codigo,
        receptorNombre: rc.nombre,
      };
    });
    return {
      cicloId: x.c.id,
      codigo: x.c.code,
      desde: p.desde,
      hasta: p.hasta,
      criterio,
      totalRepartido: r.totalRepartido,
      bases: receptores.map((rc, i) => ({
        clave: rc.clave,
        peso: Number(rc.peso),
        pct: r.cuotas[i].pct,
      })),
      porEmisor: r.porEmisor,
      porReceptor: r.porReceptor,
      lineas,
    };
  }

  /** Previsualización: el reparto que se contabilizaría, sin escribir nada. */
  async simular(id: string, input: PeriodoReparto) {
    const p = periodoRepartoSchema.parse(input);
    const x = await this.cargar(this.dbs.db, id);
    return this.calcular(this.dbs.db, x, p);
  }

  /* ─────────────────────── ejecución y reversión ─────────────────────── */

  private ejecucionDto(
    r: AllocationRun,
    codigo: string,
    lineas?: LineaRepartoDto[],
  ): EjecucionRepartoDto {
    return {
      id: r.id,
      cicloId: r.cycleId,
      cicloCodigo: codigo,
      seq: r.seq,
      desde: r.periodFrom,
      hasta: r.periodTo,
      estado: r.status as 'contabilizado' | 'revertido',
      total: Number(r.totalAmount),
      motivoReversion: r.reverseReason,
      revertidoEn: r.reversedAt?.toISOString() ?? null,
      creadoEn: r.createdAt.toISOString(),
      version: r.version,
      ...(lineas ? { lineas } : {}),
    };
  }

  private async bloquear(tx: Tx) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`reparto:${this.ctx().companyId}`}))`,
    );
  }

  async ejecutar(id: string, input: PeriodoReparto) {
    const p = periodoRepartoSchema.parse(input);
    const { companyId, userId } = this.ctx();
    return this.dbs.db.transaction(async (tx) => {
      await this.bloquear(tx);
      const x = await this.cargar(tx, id);
      if (!x.c.isActive) {
        throw new ConflictException({
          code: 'ALLOCATION_CYCLE_INACTIVE',
          message: 'El ciclo está inactivo',
        });
      }
      await exigirPeriodoAbierto(tx, companyId, p);
      const [solapada] = await tx
        .select({
          desde: allocationRuns.periodFrom,
          hasta: allocationRuns.periodTo,
        })
        .from(allocationRuns)
        .where(
          and(
            eq(allocationRuns.cycleId, id),
            eq(allocationRuns.status, 'contabilizado'),
            sql`${allocationRuns.periodFrom} <= ${p.hasta} and ${allocationRuns.periodTo} >= ${p.desde}`,
          ),
        )
        .limit(1);
      if (solapada) {
        throw new ConflictException({
          code: 'ALLOCATION_ALREADY_POSTED',
          message: `El ciclo ya tiene una ejecución vigente en ${solapada.desde} – ${solapada.hasta}: revierte antes`,
        });
      }
      const sim = await this.calcular(tx, x, p);
      if (sim.lineas.length === 0) {
        throw new UnprocessableEntityException({
          code: 'ALLOCATION_NOTHING_TO_ALLOCATE',
          message:
            'Los centros emisores no tienen saldo que repartir en el periodo',
        });
      }
      const [{ seq }] = await tx
        .select({
          seq: sql<number>`coalesce(max(${allocationRuns.seq}), 0) + 1`,
        })
        .from(allocationRuns)
        .where(eq(allocationRuns.companyId, companyId));
      const [run] = await tx
        .insert(allocationRuns)
        .values({
          companyId,
          cycleId: id,
          seq: Number(seq),
          periodFrom: p.desde,
          periodTo: p.hasta,
          totalAmount: centsToNumeric(toCents(sim.totalRepartido)),
          createdBy: userId,
        })
        .returning();
      await tx.insert(allocationRunLines).values(
        sim.lineas.map((l) => ({
          companyId,
          runId: run.id,
          senderCostCenterId: l.emisor,
          receiverProjectId: l.receptorTipo === 'obra' ? l.receptorId : null,
          receiverCostCenterId:
            l.receptorTipo === 'centro' ? l.receptorId : null,
          accountCode: l.cuenta,
          baseAmount: centsToNumeric(toCents(l.base)),
          weight: l.peso.toFixed(4),
          amount: centsToNumeric(toCents(l.importe)),
          residueCents: l.residuo,
        })),
      );
      await this.audit.registrar(tx, {
        entityType: 'allocation_run',
        entityId: run.id,
        action: 'create',
        newData: {
          ciclo: x.c.code,
          seq: run.seq,
          desde: p.desde,
          hasta: p.hasta,
          total: run.totalAmount,
          lineas: sim.lineas.length,
        },
      });
      return this.ejecucionDto(run, x.c.code, sim.lineas);
    });
  }

  async revertir(runId: string, input: RevertirRepartoInput, version?: number) {
    const { motivo } = revertirRepartoSchema.parse(input);
    const { companyId, userId } = this.ctx();
    return this.dbs.db.transaction(async (tx) => {
      await this.bloquear(tx);
      const [run] = await tx
        .select()
        .from(allocationRuns)
        .where(
          and(
            eq(allocationRuns.id, runId),
            eq(allocationRuns.companyId, companyId),
          ),
        )
        .for('update');
      if (!run) {
        throw new NotFoundException({
          code: 'ALLOCATION_RUN_NOT_FOUND',
          message: 'Ejecución de reparto no encontrada',
        });
      }
      verificarVersion(run.version, version);
      if (run.status === 'revertido') {
        throw new ConflictException({
          code: 'ALLOCATION_RUN_REVERSED',
          message: 'La ejecución ya está revertida',
        });
      }
      const [ultima] = await tx
        .select({ id: allocationRuns.id, seq: allocationRuns.seq })
        .from(allocationRuns)
        .where(
          and(
            eq(allocationRuns.companyId, companyId),
            eq(allocationRuns.status, 'contabilizado'),
          ),
        )
        .orderBy(desc(allocationRuns.seq))
        .limit(1);
      if (ultima.id !== run.id) {
        throw new ConflictException({
          code: 'ALLOCATION_NOT_LATEST',
          message: `Revierte antes la ejecución nº ${ultima.seq}: los repartos se deshacen en orden inverso`,
        });
      }
      await exigirPeriodoAbierto(tx, companyId, {
        desde: run.periodFrom,
        hasta: run.periodTo,
      });
      const [nuevo] = await tx
        .update(allocationRuns)
        .set({
          status: 'revertido',
          reverseReason: motivo,
          reversedAt: new Date(),
          reversedBy: userId,
          version: run.version + 1,
        })
        .where(eq(allocationRuns.id, runId))
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'allocation_run',
        entityId: runId,
        action: 'update',
        oldData: { status: run.status, version: run.version },
        newData: { status: nuevo.status, motivo, version: nuevo.version },
      });
      const [c] = await tx
        .select({ code: allocationCycles.code })
        .from(allocationCycles)
        .where(eq(allocationCycles.id, run.cycleId));
      return this.ejecucionDto(nuevo, c.code);
    });
  }

  async ejecuciones(f: { cicloId?: string }): Promise<EjecucionRepartoDto[]> {
    const filas = await this.dbs.db
      .select({ r: allocationRuns, codigo: allocationCycles.code })
      .from(allocationRuns)
      .innerJoin(
        allocationCycles,
        eq(allocationCycles.id, allocationRuns.cycleId),
      )
      .where(
        and(
          eq(allocationRuns.companyId, this.ctx().companyId),
          ...(f.cicloId ? [eq(allocationRuns.cycleId, f.cicloId)] : []),
        ),
      )
      .orderBy(desc(allocationRuns.seq));
    return filas.map((x) => this.ejecucionDto(x.r, x.codigo));
  }

  async ejecucion(runId: string): Promise<EjecucionRepartoDto> {
    const companyId = this.ctx().companyId;
    const [x] = await this.dbs.db
      .select({ r: allocationRuns, codigo: allocationCycles.code })
      .from(allocationRuns)
      .innerJoin(
        allocationCycles,
        eq(allocationCycles.id, allocationRuns.cycleId),
      )
      .where(
        and(
          eq(allocationRuns.id, runId),
          eq(allocationRuns.companyId, companyId),
        ),
      );
    if (!x) {
      throw new NotFoundException({
        code: 'ALLOCATION_RUN_NOT_FOUND',
        message: 'Ejecución de reparto no encontrada',
      });
    }
    const lineas = await this.dbs.db
      .select({
        l: allocationRunLines,
        emisor: costCenters.code,
        obraCodigo: projects.code,
        obraNombre: projects.name,
      })
      .from(allocationRunLines)
      .innerJoin(
        costCenters,
        eq(costCenters.id, allocationRunLines.senderCostCenterId),
      )
      .leftJoin(projects, eq(projects.id, allocationRunLines.receiverProjectId))
      .where(eq(allocationRunLines.runId, runId))
      .orderBy(asc(allocationRunLines.accountCode), asc(allocationRunLines.id));
    const centros = new Map(
      (
        await this.dbs.db
          .select({
            id: costCenters.id,
            code: costCenters.code,
            name: costCenters.name,
          })
          .from(costCenters)
          .where(eq(costCenters.companyId, companyId))
      ).map((c) => [c.id, c]),
    );
    // Rol obra: solo ve las líneas de sus obras.
    const accesibles = await this.dbs.getObrasAccesibles();
    return this.ejecucionDto(
      x.r,
      x.codigo,
      lineas
        .filter(
          ({ l }) =>
            accesibles === null ||
            (l.receiverProjectId !== null &&
              accesibles.includes(l.receiverProjectId)),
        )
        .map(({ l, emisor, obraCodigo, obraNombre }) => {
          const centro = l.receiverCostCenterId
            ? centros.get(l.receiverCostCenterId)
            : undefined;
          const receptorTipo = l.receiverProjectId ? 'obra' : 'centro';
          const receptorId = (l.receiverProjectId ?? l.receiverCostCenterId)!;
          return {
            emisor: l.senderCostCenterId,
            emisorCodigo: emisor,
            receptor: `${receptorTipo}:${receptorId}`,
            receptorTipo,
            receptorId,
            receptorCodigo: obraCodigo ?? centro?.code ?? '',
            receptorNombre: obraNombre ?? centro?.name ?? '',
            cuenta: l.accountCode,
            base: Number(l.baseAmount),
            peso: Number(l.weight),
            importe: Number(l.amount),
            residuo: l.residueCents,
          };
        }),
    );
  }
}
