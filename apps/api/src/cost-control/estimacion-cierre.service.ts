import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  projectCostEstimates,
  projects,
  users,
  type ProjectCostEstimate,
} from '@erp/db';
import {
  centsToNumeric,
  diferenciasAuditoria,
  estimacionCierreSetSchema,
  fromCents,
  toCents,
  todayIso,
  type EstimacionCierreObraDto,
  type EstimacionCierreSetInput,
  type VersionEstimacionCierreDto,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { getRequestContext } from '../common/request-context';
import { verificarVersion } from '../common/version';
import { DbService } from '../db/db.service';
import { ControlPresupuestarioService } from './control-presupuestario.service';

const obraNoEncontrada = () =>
  new NotFoundException({
    code: 'PROJECT_NOT_FOUND',
    message: 'Obra no encontrada',
  });

function versionDto(
  e: ProjectCostEstimate,
  nombre: string | null,
): VersionEstimacionCierreDto {
  return {
    version: e.version,
    fecha: e.effectiveDate,
    costeEstimado:
      e.estimatedCost === null ? null : fromCents(toCents(e.estimatedCost)),
    motivo: e.reason,
    usuarioId: e.createdBy,
    usuarioNombre: nombre,
    creadoEn: e.createdAt.toISOString(),
  };
}

/**
 * Estimación al cierre (EAC) editable por obra (SAP PS / Oracle PPM). Cada
 * cambio es una versión inmutable con fecha de efecto, motivo y usuario; la
 * vigente alimenta el cuadro de márgenes y la provisión por pérdidas por
 * `ControlPresupuestarioService.cargar` (una sola consulta, sin duplicar).
 * No se fija por debajo del coste real ya incurrido (EAC_BELOW_ACTUAL_COST).
 */
@Injectable()
export class EstimacionCierreService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly control: ControlPresupuestarioService,
  ) {}

  private async obra(projectId: string) {
    const accesibles = await this.dbs.getObrasAccesibles();
    if (accesibles !== null && !accesibles.includes(projectId)) {
      throw obraNoEncontrada();
    }
    const [p] = await this.dbs.db
      .select({
        id: projects.id,
        code: projects.code,
        contractAmount: projects.contractAmount,
      })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.companyId, this.dbs.getCompanyId()),
          isNull(projects.deletedAt),
        ),
      );
    if (!p) throw obraNoEncontrada();
    return p;
  }

  async obtener(projectId: string): Promise<EstimacionCierreObraDto> {
    const p = await this.obra(projectId);
    const [cuadro, historial] = await Promise.all([
      this.control.cuadroObraHasta(this.dbs.db, p.id, p.contractAmount),
      this.dbs.db
        .select({ e: projectCostEstimates, nombre: users.fullName })
        .from(projectCostEstimates)
        .leftJoin(users, eq(users.id, projectCostEstimates.createdBy))
        .where(
          and(
            eq(projectCostEstimates.companyId, this.dbs.getCompanyId()),
            eq(projectCostEstimates.projectId, p.id),
          ),
        )
        .orderBy(desc(projectCostEstimates.version)),
    ]);
    const versiones = historial.map((h) => versionDto(h.e, h.nombre));
    return {
      projectId: p.id,
      codigo: p.code,
      contrato: cuadro.contrato,
      presupuestado: cuadro.presupuestado,
      costeReal: cuadro.costeReal,
      comprometido: cuadro.comprometido,
      costeEstimadoCierreAutomatico: cuadro.costeEstimadoCierreAutomatico,
      costeEstimadoCierre: cuadro.costeEstimadoCierre,
      origen: cuadro.origenEstimacion,
      ajustadaAlReal: cuadro.estimacionAjustadaAlReal,
      margenProyectado: cuadro.margenProyectado,
      version: versiones[0]?.version ?? 0,
      vigente: versiones[0] ?? null,
      historial: versiones,
    };
  }

  /**
   * Fija (o retira, con `costeEstimado: null`) la estimación al cierre. Con
   * `If-Match`, la versión vigente leída (0 si nunca se fijó).
   */
  async fijar(
    projectId: string,
    input: EstimacionCierreSetInput,
    versionEsperada: number | undefined,
  ): Promise<EstimacionCierreObraDto> {
    const d = estimacionCierreSetSchema.parse(input);
    const p = await this.obra(projectId);
    const companyId = this.dbs.getCompanyId();
    const fecha = d.fecha ?? todayIso();
    await this.dbs.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`eac:${companyId}:${p.id}`}))`,
      );
      const [actual] = await tx
        .select()
        .from(projectCostEstimates)
        .where(
          and(
            eq(projectCostEstimates.companyId, companyId),
            eq(projectCostEstimates.projectId, p.id),
          ),
        )
        .orderBy(desc(projectCostEstimates.version))
        .limit(1);
      verificarVersion(actual?.version ?? 0, versionEsperada);
      if (actual && fecha < actual.effectiveDate) {
        throw new UnprocessableEntityException({
          code: 'EAC_DATE_OUT_OF_ORDER',
          message: `La fecha de efecto (${fecha}) es anterior a la de la estimación vigente (${actual.effectiveDate})`,
        });
      }
      if (d.costeEstimado !== null) {
        const { costeReal } = await this.control.proyeccionHasta(
          tx,
          p.id,
          p.contractAmount,
          fecha,
        );
        if (toCents(d.costeEstimado) < toCents(costeReal)) {
          throw new UnprocessableEntityException({
            code: 'EAC_BELOW_ACTUAL_COST',
            message: `La estimación al cierre (${d.costeEstimado.toFixed(2)}) no puede ser inferior al coste real ya incurrido a ${fecha} (${costeReal})`,
          });
        }
      }
      const [nueva] = await tx
        .insert(projectCostEstimates)
        .values({
          companyId,
          projectId: p.id,
          version: (actual?.version ?? 0) + 1,
          effectiveDate: fecha,
          estimatedCost:
            d.costeEstimado === null
              ? null
              : centsToNumeric(toCents(d.costeEstimado)),
          reason: d.motivo,
          createdBy: getRequestContext()?.userId ?? null,
        })
        .returning();
      const campos = ['estimatedCost', 'effectiveDate', 'version'] as const;
      const antes = actual
        ? Object.fromEntries(campos.map((c) => [c, actual[c]]))
        : null;
      await this.audit.registrar(tx, {
        entityType: 'project_cost_estimate',
        entityId: nueva.id,
        action: 'create',
        oldData: antes,
        newData: {
          ...nueva,
          cambios: diferenciasAuditoria(
            antes,
            Object.fromEntries(campos.map((c) => [c, nueva[c]])),
            campos,
          ),
        },
      });
    });
    return this.obtener(p.id);
  }
}
