import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  consolidationClosings,
  consolidationFxRates,
  corporateGroups,
  type ConsolidationFxRate,
  type CorporateGroup,
  type Tx,
} from '@erp/db';
import {
  tipoCambioCreateSchema,
  tipoCambioUpdateSchema,
  type TipoCambioConsolidacion,
  type TipoCambioCreateInput,
  type TipoCambioDto,
  type TipoCambioRegistro,
  type TipoCambioUpdateInput,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { verificarVersion } from '../common/version';
import { DbService } from '../db/db.service';

/**
 * Tipos de cambio de consolidación por grupo (SAP Group Reporting: exchange
 * rate types; Oracle FCCS: rates cube). Los gestiona la matriz; un tipo que
 * toca un periodo cerrado no se crea ni se modifica
 * (`CONSOLIDATION_PERIOD_CLOSED`), porque cambiaría un consolidado congelado.
 */
@Injectable()
export class TiposCambioService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  private async grupo(id: string): Promise<CorporateGroup> {
    const [g] = await this.dbs.db
      .select()
      .from(corporateGroups)
      .where(
        and(
          eq(corporateGroups.id, id),
          eq(corporateGroups.companyId, this.dbs.getContext().companyId),
        ),
      );
    if (!g) {
      throw new NotFoundException({
        code: 'HOLDING_NOT_FOUND',
        message: 'Grupo no encontrado',
      });
    }
    return g;
  }

  private dto(r: ConsolidationFxRate): TipoCambioDto {
    return {
      id: r.id,
      grupoId: r.groupId,
      moneda: r.currency,
      tipo: r.rateType as TipoCambioConsolidacion,
      desde: r.validFrom,
      hasta: r.validTo,
      tasa: Number(r.rate),
      version: r.version,
    };
  }

  private async exigirAbierto(
    tx: Tx,
    groupId: string,
    desde: string,
    hasta: string,
  ) {
    const [c] = await tx
      .select({
        desde: consolidationClosings.periodFrom,
        hasta: consolidationClosings.periodTo,
      })
      .from(consolidationClosings)
      .where(
        and(
          eq(consolidationClosings.groupId, groupId),
          sql`${consolidationClosings.periodFrom} <= ${hasta} and ${consolidationClosings.periodTo} >= ${desde}`,
        ),
      )
      .limit(1);
    if (c) {
      throw new ConflictException({
        code: 'CONSOLIDATION_PERIOD_CLOSED',
        message: `El tipo de cambio afecta a la consolidación cerrada ${c.desde} – ${c.hasta}`,
      });
    }
  }

  async listar(groupId: string): Promise<TipoCambioDto[]> {
    const g = await this.grupo(groupId);
    const filas = await this.dbs.db
      .select()
      .from(consolidationFxRates)
      .where(
        and(
          eq(consolidationFxRates.companyId, g.companyId),
          eq(consolidationFxRates.groupId, g.id),
        ),
      )
      .orderBy(
        asc(consolidationFxRates.currency),
        asc(consolidationFxRates.rateType),
        asc(consolidationFxRates.validFrom),
      );
    return filas.map((r) => this.dto(r));
  }

  /** Registros para el motor de consolidación (grupo ya cargado y autorizado). */
  async registros(g: CorporateGroup): Promise<TipoCambioRegistro[]> {
    const filas = await this.dbs.db
      .select()
      .from(consolidationFxRates)
      .where(
        and(
          eq(consolidationFxRates.companyId, g.companyId),
          eq(consolidationFxRates.groupId, g.id),
        ),
      );
    return filas.map((r) => ({
      moneda: r.currency,
      tipo: r.rateType as TipoCambioConsolidacion,
      desde: r.validFrom,
      hasta: r.validTo,
      tasa: r.rate,
    }));
  }

  async crear(
    groupId: string,
    input: TipoCambioCreateInput,
  ): Promise<TipoCambioDto> {
    const d = tipoCambioCreateSchema.parse(input);
    const g = await this.grupo(groupId);
    if (d.moneda === g.baseCurrency) {
      throw new UnprocessableEntityException({
        code: 'FX_SAME_CURRENCY',
        message: `${d.moneda} es la moneda de presentación del grupo: no necesita tipo de cambio`,
      });
    }
    const hasta = d.hasta ?? d.desde;
    const { userId } = this.dbs.getContext();
    const r = await this.dbs.db.transaction(async (tx) => {
      await this.exigirAbierto(tx, g.id, d.desde, hasta);
      const [nuevo] = await tx
        .insert(consolidationFxRates)
        .values({
          companyId: g.companyId,
          groupId: g.id,
          currency: d.moneda,
          rateType: d.tipo,
          validFrom: d.desde,
          validTo: hasta,
          rate: d.tasa.toFixed(8),
          createdBy: userId,
        })
        .onConflictDoNothing()
        .returning();
      if (!nuevo) {
        throw new ConflictException({
          code: 'FX_RATE_DUPLICATE',
          message: `Ya hay un tipo ${d.tipo} de ${d.moneda} para ${d.desde}${hasta !== d.desde ? ` – ${hasta}` : ''}: modifícalo`,
        });
      }
      await this.audit.registrar(tx, {
        entityType: 'consolidation_fx_rate',
        entityId: nuevo.id,
        action: 'create',
        newData: nuevo,
      });
      return nuevo;
    });
    return this.dto(r);
  }

  async actualizar(
    groupId: string,
    id: string,
    input: TipoCambioUpdateInput,
    version?: number,
  ): Promise<TipoCambioDto> {
    const d = tipoCambioUpdateSchema.parse(input);
    const g = await this.grupo(groupId);
    const r = await this.dbs.db.transaction(async (tx) => {
      const [actual] = await tx
        .select()
        .from(consolidationFxRates)
        .where(
          and(
            eq(consolidationFxRates.id, id),
            eq(consolidationFxRates.groupId, g.id),
            eq(consolidationFxRates.companyId, g.companyId),
          ),
        )
        .for('update');
      if (!actual) {
        throw new NotFoundException({
          code: 'FX_RATE_NOT_FOUND',
          message: 'Tipo de cambio no encontrado',
        });
      }
      verificarVersion(actual.version, version);
      await this.exigirAbierto(tx, g.id, actual.validFrom, actual.validTo);
      const [nuevo] = await tx
        .update(consolidationFxRates)
        .set({
          rate: d.tasa.toFixed(8),
          version: actual.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(consolidationFxRates.id, id))
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'consolidation_fx_rate',
        entityId: id,
        action: 'update',
        oldData: actual,
        newData: nuevo,
      });
      return nuevo;
    });
    return this.dto(r);
  }
}
