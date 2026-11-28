import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, SQL } from 'drizzle-orm';
import {
  costCenters,
  forecastScenarios,
  forecastSnapshots,
  projects,
  type ForecastScenario,
  type ForecastSnapshot,
} from '@erp/db';
import {
  escenarioCreateSchema,
  escenarioUpdateSchema,
  fotoPrevisionCreateSchema,
  fromCents,
  previsionObra,
  previsionQuerySchema,
  sumCents,
  toCents,
  totalesPrevision,
  varianzaPrevision,
  type CosteCompletoObraDto,
  type EscenarioCreateInput,
  type EscenarioDto,
  type EscenarioUpdateInput,
  type FotoPrevisionCreateInput,
  type FotoPrevisionDto,
  type PrevisionDto,
  type PrevisionObraDto,
  type PrevisionQuery,
  type TipoEscenario,
  type TotalesPrevision,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { verificarVersion } from '../common/version';
import { ControlPresupuestarioService } from '../cost-control/control-presupuestario.service';
import { DbService } from '../db/db.service';
import { indirectosPorObra } from './analitica';

/** Obras vivas que entran en la previsión de la sociedad. */
const ESTADOS_PREVISION = ['adjudicada', 'en_curso', 'pausada'] as const;

const escenarioNoEncontrado = () =>
  new NotFoundException({
    code: 'FORECAST_SCENARIO_NOT_FOUND',
    message: 'Escenario no encontrado',
  });

/** Escenarios predeterminados (base, optimista y tensionado). */
const PREDETERMINADOS: EscenarioCreateInput[] = [
  { codigo: 'BASE', nombre: 'Base', tipo: 'base' },
  {
    codigo: 'OPTIMISTA',
    nombre: 'Optimista',
    tipo: 'optimista',
    ajusteCostePct: -5,
    ajusteIngresoPct: 2,
  },
  {
    codigo: 'TENSIONADO',
    nombre: 'Tensionado',
    tipo: 'pesimista',
    ajusteCostePct: 10,
    ajusteIngresoPct: -5,
    retrasoMeses: 2,
  },
];

interface LineaFoto {
  projectId: string;
  eac: number;
  ingresosPrevistos: number;
  margen: number;
}

/**
 * Rolling forecast (Oracle EPM Planning / SAP BPC-like): real a la fecha de
 * corte del cuadro de márgenes (coste directo, EAC y certificado) más los
 * indirectos repartidos por el control analítico, proyectado por escenario
 * y comparado con el presupuesto y con una foto anterior (línea base).
 * Solo las obras accesibles al usuario (`getObrasAccesibles`).
 */
@Injectable()
export class ForecastService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly control: ControlPresupuestarioService,
  ) {}

  private ctx() {
    return this.dbs.getContext();
  }

  /* ──────────────────────────── escenarios ──────────────────────────── */

  private escenarioDto(e: ForecastScenario): EscenarioDto {
    return {
      id: e.id,
      codigo: e.code,
      nombre: e.name,
      tipo: e.kind as TipoEscenario,
      ajusteCostePct: Number(e.costAdjustPct),
      ajusteIngresoPct: Number(e.revenueAdjustPct),
      retrasoMeses: e.delayMonths,
      incluirIndirectos: e.includeOverhead,
      activo: e.isActive,
      version: e.version,
    };
  }

  private async escenario(id: string): Promise<ForecastScenario> {
    const [e] = await this.dbs.db
      .select()
      .from(forecastScenarios)
      .where(
        and(
          eq(forecastScenarios.id, id),
          eq(forecastScenarios.companyId, this.ctx().companyId),
        ),
      );
    if (!e) throw escenarioNoEncontrado();
    return e;
  }

  async escenarios(): Promise<EscenarioDto[]> {
    const filas = await this.dbs.db
      .select()
      .from(forecastScenarios)
      .where(eq(forecastScenarios.companyId, this.ctx().companyId))
      .orderBy(asc(forecastScenarios.code));
    return filas.map((e) => this.escenarioDto(e));
  }

  async crearEscenario(input: EscenarioCreateInput): Promise<EscenarioDto> {
    const d = escenarioCreateSchema.parse(input);
    const { companyId, userId } = this.ctx();
    const e = await this.dbs.db.transaction(async (tx) => {
      const [nuevo] = await tx
        .insert(forecastScenarios)
        .values({
          companyId,
          code: d.codigo,
          name: d.nombre,
          kind: d.tipo,
          costAdjustPct: d.ajusteCostePct.toFixed(2),
          revenueAdjustPct: d.ajusteIngresoPct.toFixed(2),
          delayMonths: d.retrasoMeses,
          includeOverhead: d.incluirIndirectos,
          createdBy: userId,
        })
        .onConflictDoNothing()
        .returning();
      if (!nuevo) {
        throw new ConflictException({
          code: 'FORECAST_CODE_DUPLICATE',
          message: `Ya existe el escenario ${d.codigo}`,
        });
      }
      await this.audit.registrar(tx, {
        entityType: 'forecast_scenario',
        entityId: nuevo.id,
        action: 'create',
        newData: nuevo,
      });
      return nuevo;
    });
    return this.escenarioDto(e);
  }

  /** Crea los que falten de base, optimista y tensionado (idempotente). */
  async escenariosPredeterminados(): Promise<EscenarioDto[]> {
    const { companyId, userId } = this.ctx();
    await this.dbs.db.transaction(async (tx) => {
      for (const p of PREDETERMINADOS) {
        const d = escenarioCreateSchema.parse(p);
        const [nuevo] = await tx
          .insert(forecastScenarios)
          .values({
            companyId,
            code: d.codigo,
            name: d.nombre,
            kind: d.tipo,
            costAdjustPct: d.ajusteCostePct.toFixed(2),
            revenueAdjustPct: d.ajusteIngresoPct.toFixed(2),
            delayMonths: d.retrasoMeses,
            includeOverhead: d.incluirIndirectos,
            createdBy: userId,
          })
          .onConflictDoNothing()
          .returning();
        if (nuevo) {
          await this.audit.registrar(tx, {
            entityType: 'forecast_scenario',
            entityId: nuevo.id,
            action: 'create',
            newData: nuevo,
          });
        }
      }
    });
    return this.escenarios();
  }

  async actualizarEscenario(
    id: string,
    input: EscenarioUpdateInput,
    version?: number,
  ): Promise<EscenarioDto> {
    const d = escenarioUpdateSchema.parse(input);
    const e = await this.dbs.db.transaction(async (tx) => {
      const [actual] = await tx
        .select()
        .from(forecastScenarios)
        .where(
          and(
            eq(forecastScenarios.id, id),
            eq(forecastScenarios.companyId, this.ctx().companyId),
          ),
        )
        .for('update');
      if (!actual) throw escenarioNoEncontrado();
      verificarVersion(actual.version, version);
      const [nuevo] = await tx
        .update(forecastScenarios)
        .set({
          ...(d.nombre !== undefined && { name: d.nombre }),
          ...(d.tipo !== undefined && { kind: d.tipo }),
          ...(d.ajusteCostePct !== undefined && {
            costAdjustPct: d.ajusteCostePct.toFixed(2),
          }),
          ...(d.ajusteIngresoPct !== undefined && {
            revenueAdjustPct: d.ajusteIngresoPct.toFixed(2),
          }),
          ...(d.retrasoMeses !== undefined && { delayMonths: d.retrasoMeses }),
          ...(d.incluirIndirectos !== undefined && {
            includeOverhead: d.incluirIndirectos,
          }),
          ...(d.activo !== undefined && { isActive: d.activo }),
          version: actual.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(forecastScenarios.id, id))
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'forecast_scenario',
        entityId: id,
        action: 'update',
        oldData: actual,
        newData: nuevo,
      });
      return nuevo;
    });
    return this.escenarioDto(e);
  }

  /* ─────────────────────────── obras y costes ─────────────────────────── */

  private async obras(projectId?: string) {
    const filtros: SQL[] = [
      eq(projects.companyId, this.ctx().companyId),
      isNull(projects.deletedAt),
    ];
    const accesibles = await this.dbs.getObrasAccesibles();
    if (accesibles !== null) {
      if (accesibles.length === 0) return [];
      filtros.push(inArray(projects.id, accesibles));
    }
    if (projectId) filtros.push(eq(projects.id, projectId));
    else filtros.push(inArray(projects.status, [...ESTADOS_PREVISION]));
    const filas = await this.dbs.db
      .select()
      .from(projects)
      .where(and(...filtros))
      .orderBy(asc(projects.code));
    if (projectId && filas.length === 0) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        message: 'Obra no encontrada',
      });
    }
    return filas;
  }

  /** Coste completo por obra a una fecha: directo + indirectos repartidos. */
  async costeObras(hasta: string): Promise<CosteCompletoObraDto[]> {
    const obras = await this.obras();
    const ids = obras.map((o) => o.id);
    const [cuadros, indirectos, centros] = await Promise.all([
      this.control.cuadrosObras(
        this.dbs.db,
        obras.map((o) => ({ id: o.id, contrato: o.contractAmount })),
        hasta,
      ),
      indirectosPorObra(this.dbs.db, this.ctx().companyId, ids, hasta),
      this.dbs.db
        .select({ id: costCenters.id, code: costCenters.code })
        .from(costCenters)
        .where(eq(costCenters.companyId, this.ctx().companyId)),
    ]);
    const codigo = new Map(centros.map((c) => [c.id, c.code]));
    return obras.map((o) => {
      const directo = toCents(cuadros.get(o.id)!.costeReal);
      const ind = indirectos.get(o.id);
      const total = ind?.total ?? 0n;
      return {
        projectId: o.id,
        codigo: o.code,
        nombre: o.name,
        costeDirecto: fromCents(directo),
        indirectos: fromCents(total),
        costeCompleto: fromCents(directo + total),
        porCentro: [...(ind?.porCentro ?? new Map<string, bigint>())].map(
          ([centroId, v]) => ({
            centroId,
            codigo: codigo.get(centroId) ?? '',
            importe: fromCents(v),
          }),
        ),
      };
    });
  }

  /* ──────────────────────────── previsión ──────────────────────────── */

  private fotoDto(f: ForecastSnapshot): FotoPrevisionDto {
    return {
      id: f.id,
      escenarioId: f.scenarioId,
      fecha: f.cutoffDate,
      etiqueta: f.label,
      totales: f.totals as TotalesPrevision,
      creadaEn: f.createdAt.toISOString(),
    };
  }

  private async baseline(
    escenarioId: string,
    baselineId?: string,
  ): Promise<ForecastSnapshot | null> {
    const companyId = this.ctx().companyId;
    if (baselineId) {
      const [f] = await this.dbs.db
        .select()
        .from(forecastSnapshots)
        .where(
          and(
            eq(forecastSnapshots.id, baselineId),
            eq(forecastSnapshots.companyId, companyId),
          ),
        );
      if (!f) {
        throw new NotFoundException({
          code: 'FORECAST_SNAPSHOT_NOT_FOUND',
          message: 'Foto de previsión no encontrada',
        });
      }
      return f;
    }
    const [f] = await this.dbs.db
      .select()
      .from(forecastSnapshots)
      .where(
        and(
          eq(forecastSnapshots.companyId, companyId),
          eq(forecastSnapshots.scenarioId, escenarioId),
        ),
      )
      .orderBy(desc(forecastSnapshots.createdAt))
      .limit(1);
    return f ?? null;
  }

  async prevision(input: PrevisionQuery): Promise<PrevisionDto> {
    const q = previsionQuerySchema.parse(input);
    const e = await this.escenario(q.escenarioId);
    const obras = await this.obras(q.projectId);
    const ids = obras.map((o) => o.id);
    const [cuadros, indirectos, base] = await Promise.all([
      this.control.cuadrosObras(
        this.dbs.db,
        obras.map((o) => ({ id: o.id, contrato: o.contractAmount })),
        q.fecha,
      ),
      indirectosPorObra(this.dbs.db, this.ctx().companyId, ids, q.fecha),
      this.baseline(e.id, q.baselineId),
    ]);
    const esc = {
      ajusteCostePct: e.costAdjustPct,
      ajusteIngresoPct: e.revenueAdjustPct,
      retrasoMeses: e.delayMonths,
      incluirIndirectos: e.includeOverhead,
    };
    const lineasBase = new Map(
      ((base?.lines as LineaFoto[] | undefined) ?? []).map((l) => [
        l.projectId,
        l,
      ]),
    );
    const resultado: PrevisionObraDto[] = obras.map((o) => {
      const c = cuadros.get(o.id)!;
      const r = previsionObra(
        {
          contrato: o.contractAmount,
          presupuestado: c.presupuestado,
          costeReal: c.costeReal,
          indirectos: fromCents(indirectos.get(o.id)?.total ?? 0n),
          certificado: c.certificado,
          costeEstimadoCierre: c.costeEstimadoCierre,
          fechaCorte: q.fecha,
          finPrevista: o.expectedEnd,
        },
        esc,
        q.horizonte,
      );
      const lb = lineasBase.get(o.id);
      return {
        ...r,
        projectId: o.id,
        codigo: o.code,
        nombre: o.name,
        contrato: o.contractAmount === null ? null : Number(o.contractAmount),
        finPrevista: o.expectedEnd,
        varianza: lb ? varianzaPrevision(r, lb) : null,
      };
    });
    const totales = totalesPrevision(resultado);
    // Serie agregada por mes (suma exacta).
    const porMes = new Map<string, { coste: bigint; ingreso: bigint }>();
    for (const r of resultado) {
      for (const s of r.serie) {
        const m = porMes.get(s.mes) ?? { coste: 0n, ingreso: 0n };
        m.coste += toCents(s.coste);
        m.ingreso += toCents(s.ingreso);
        porMes.set(s.mes, m);
      }
    }
    const serie = [...porMes]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, q.horizonte)
      .map(([mes, v]) => ({
        mes,
        coste: fromCents(v.coste),
        ingreso: fromCents(v.ingreso),
      }));
    const totalesBase = base ? (base.totals as TotalesPrevision) : null;
    return {
      escenario: this.escenarioDto(e),
      fecha: q.fecha,
      horizonte: q.horizonte,
      generadoEn: new Date().toISOString(),
      obras: resultado,
      totales,
      serie,
      alertas: resultado.flatMap((r) =>
        r.alertas.map((alerta) => ({ projectId: r.projectId, alerta })),
      ),
      baseline: base
        ? {
            id: base.id,
            fecha: base.cutoffDate,
            etiqueta: base.label,
            totales: totalesBase!,
          }
        : null,
      // Sobre las mismas obras: la foto puede tener otras (o menos).
      varianza: base
        ? varianzaPrevision(
            totales,
            totalesPrevision(
              resultado
                .filter((r) => lineasBase.has(r.projectId))
                .map((r) => ({
                  ...r,
                  ...lineasBase.get(r.projectId)!,
                })),
            ),
          )
        : null,
    };
  }

  /** Foto inmutable de la previsión: será la línea base de las siguientes. */
  async crearFoto(input: FotoPrevisionCreateInput): Promise<FotoPrevisionDto> {
    const d = fotoPrevisionCreateSchema.parse(input);
    const e = await this.escenario(d.escenarioId);
    if (!e.isActive) {
      throw new ConflictException({
        code: 'FORECAST_SCENARIO_INACTIVE',
        message: 'El escenario está inactivo',
      });
    }
    const p = await this.prevision({
      escenarioId: e.id,
      fecha: d.fecha,
      horizonte: 12,
    });
    const { companyId, userId } = this.ctx();
    const lineas: LineaFoto[] = p.obras.map((o) => ({
      projectId: o.projectId,
      eac: o.eac,
      ingresosPrevistos: o.ingresosPrevistos,
      margen: o.margen,
    }));
    const f = await this.dbs.db.transaction(async (tx) => {
      const [nueva] = await tx
        .insert(forecastSnapshots)
        .values({
          companyId,
          scenarioId: e.id,
          cutoffDate: d.fecha,
          label: d.etiqueta,
          totals: p.totales,
          lines: lineas,
          createdBy: userId,
        })
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'forecast_snapshot',
        entityId: nueva.id,
        action: 'create',
        newData: {
          escenario: e.code,
          fecha: d.fecha,
          etiqueta: d.etiqueta,
          totales: p.totales,
          obras: lineas.length,
          suma: fromCents(sumCents(lineas.map((l) => toCents(l.eac)))),
        },
      });
      return nueva;
    });
    return this.fotoDto(f);
  }

  async fotos(escenarioId?: string): Promise<FotoPrevisionDto[]> {
    const filas = await this.dbs.db
      .select()
      .from(forecastSnapshots)
      .where(
        and(
          eq(forecastSnapshots.companyId, this.ctx().companyId),
          ...(escenarioId
            ? [eq(forecastSnapshots.scenarioId, escenarioId)]
            : []),
        ),
      )
      .orderBy(desc(forecastSnapshots.createdAt));
    return filas.map((f) => this.fotoDto(f));
  }
}
