import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  bankGuarantees,
  certificacionesSubcontrata,
  contratosSubcontrata,
  paymentMilestones,
  projects,
  retentionReleaseLines,
  retentionReleases,
  subcontractChanges,
  type DbOrTx,
  type RetentionRelease,
} from '@erp/db';
import {
  ESTADOS_AVAL_VIVOS,
  ErrorProyecto,
  aplicarModificado,
  anularLiberacionSchema,
  centsToNumeric,
  esCertSubcontrataVigente,
  fromCents,
  liberacionRetencionSchema,
  modificadoSubcontrataSchema,
  mulDivRound,
  planLiberacionRetenciones,
  resumenRetencionesObra,
  todayIso,
  toCents,
  type AnularLiberacionInput,
  type CertSubcontrataStatus,
  type LadoRetencion,
  type LiberacionRetencionDto,
  type LiberacionRetencionInput,
  type ModificadoSubcontrataDto,
  type ModificadoSubcontrataInput,
  type RetencionesProyectoDto,
  type TipoLiberacionRetencion,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { cambiarEstado } from '../common/cambiar-estado';
import { usuarioPersistible } from '../common/request-context';
import { verificarVersion } from '../common/version';
import { DbService } from '../db/db.service';
import { sustituidoPorAval } from './retenciones';

function regla<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ErrorProyecto) {
      throw new UnprocessableEntityException({
        code: e.codigo,
        message: e.message,
      });
    }
    throw e;
  }
}

/** Facturas que generan retenciones vivas (mismo criterio que la interfaz). */
const FACTURAS_CONTABLES = sql.raw(`('aprobada', 'pagada', 'rectificada')`);

/**
 * Project System: retenciones de garantía de la obra (las que nos retiene el
 * cliente en sus certificaciones y las que retenemos a subcontratas), su
 * liberación por hito o por sustitución con aval bancario, y los modificados
 * del contrato de subcontrata.
 *
 * Liberar una retención adelanta su vencimiento (y guarda el anterior); el
 * cobro o pago lo hace después tesorería, así que no hay asiento propio ni
 * duplicidad. Anular la liberación devuelve el vencimiento si aún no se ha
 * cobrado o pagado nada de él.
 */
@Injectable()
export class ProjectSystemService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  private async obra(ex: DbOrTx, projectId: string) {
    const accesibles = await this.dbs.getObrasAccesibles();
    if (accesibles !== null && !accesibles.includes(projectId)) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        message: 'Obra no encontrada',
      });
    }
    const [p] = await ex
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.companyId, this.dbs.getCompanyId()),
          isNull(projects.deletedAt),
        ),
      );
    if (!p)
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        message: 'Obra no encontrada',
      });
    return p;
  }

  /** Vencimientos de retención de la obra (facturas con alguna línea de la obra). */
  private async retencionesDe(ex: DbOrTx, projectId: string, ids?: string[]) {
    const r = await ex.execute(sql`
      select pm.id, pm.direction as lado, pm.amount::text as importe,
        pm.settled_amount::text as liquidado, pm.due_date::text as vencimiento,
        pm.status, pm.version,
        i.id as "invoiceId", i.invoice_number as "invoiceNumber",
        c.id as "contactId", c.legal_name as "contactName"
      from payment_milestones pm
      join invoices i on i.id = pm.invoice_id
      join contacts c on c.id = i.contact_id
      where pm.company_id = ${this.dbs.getCompanyId()} and pm.kind = 'retencion'
        and i.status in ${FACTURAS_CONTABLES} and i.deleted_at is null
        and exists (select 1 from invoice_lines il where il.invoice_id = i.id and il.project_id = ${projectId})
        ${
          ids
            ? sql`and pm.id in (${sql.join(
                ids.map((x) => sql`${x}`),
                sql`, `,
              )})`
            : sql``
        }
      order by pm.due_date, pm.id`);
    return r.rows as {
      id: string;
      lado: LadoRetencion;
      importe: string;
      liquidado: string;
      vencimiento: string;
      status: string;
      version: number;
      invoiceId: string;
      invoiceNumber: string;
      contactId: string;
      contactName: string;
    }[];
  }

  /** Liberación vigente de cada vencimiento. */
  private async liberacionesVigentes(ex: DbOrTx, milestoneIds: string[]) {
    if (milestoneIds.length === 0)
      return new Map<
        string,
        { r: RetentionRelease; anterior: string; avalRef: string | null }
      >();
    const filas = await ex
      .select({
        l: retentionReleaseLines,
        r: retentionReleases,
        avalRef: bankGuarantees.reference,
      })
      .from(retentionReleaseLines)
      .innerJoin(
        retentionReleases,
        eq(retentionReleases.id, retentionReleaseLines.releaseId),
      )
      .leftJoin(
        bankGuarantees,
        eq(bankGuarantees.id, retentionReleases.guaranteeId),
      )
      .where(
        and(
          inArray(retentionReleaseLines.milestoneId, milestoneIds),
          eq(retentionReleases.status, 'vigente'),
        ),
      );
    return new Map(
      filas.map((f) => [
        f.l.milestoneId,
        { r: f.r, anterior: f.l.previousDueDate, avalRef: f.avalRef },
      ]),
    );
  }

  async retenciones(
    projectId: string,
    fecha?: string,
  ): Promise<RetencionesProyectoDto> {
    const corte = fecha ?? todayIso();
    await this.obra(this.dbs.db, projectId);
    const filas = await this.retencionesDe(this.dbs.db, projectId);
    const lib = await this.liberacionesVigentes(
      this.dbs.db,
      filas.map((f) => f.id),
    );
    return {
      projectId,
      fecha: corte,
      resumen: resumenRetencionesObra(
        corte,
        filas.map((f) => ({
          lado: f.lado,
          importe: f.importe,
          liquidado: f.liquidado,
          vencimiento: f.vencimiento,
          sustituidaAval: lib.get(f.id)?.r.kind === 'aval',
          liberadaHito: lib.get(f.id)?.r.kind === 'hito',
        })),
      ),
      retenciones: filas.map((f) => {
        const l = lib.get(f.id);
        return {
          vencimientoId: f.id,
          lado: f.lado,
          invoiceId: f.invoiceId,
          invoiceNumber: f.invoiceNumber,
          contactId: f.contactId,
          contactName: f.contactName,
          importe: fromCents(toCents(f.importe)),
          liquidado: fromCents(toCents(f.liquidado)),
          pendiente: fromCents(toCents(f.importe) - toCents(f.liquidado)),
          vencimiento: f.vencimiento,
          vencimientoOriginal: l?.anterior ?? null,
          liberacion: l
            ? {
                id: l.r.id,
                tipo: l.r.kind as TipoLiberacionRetencion,
                avalId: l.r.guaranteeId,
                avalReferencia: l.avalRef,
                fecha: l.r.releaseDate,
              }
            : null,
        };
      }),
    };
  }

  private async liberacionDto(
    ex: DbOrTx,
    r: RetentionRelease,
  ): Promise<LiberacionRetencionDto> {
    const lineas = await ex
      .select()
      .from(retentionReleaseLines)
      .where(eq(retentionReleaseLines.releaseId, r.id));
    return {
      id: r.id,
      tipo: r.kind as TipoLiberacionRetencion,
      lado: r.side as LadoRetencion,
      projectId: r.projectId!,
      contactId: r.contactId,
      avalId: r.guaranteeId,
      fecha: r.releaseDate,
      importe: fromCents(toCents(r.amount)),
      estado: r.status as 'vigente' | 'anulado',
      motivo: r.reason,
      motivoAnulacion: r.cancelReason,
      lineas: lineas.map((l) => ({
        vencimientoId: l.milestoneId,
        importe: fromCents(toCents(l.amount)),
        vencimientoAnterior: l.previousDueDate,
      })),
      version: r.version,
    };
  }

  async liberaciones(projectId: string): Promise<LiberacionRetencionDto[]> {
    await this.obra(this.dbs.db, projectId);
    const filas = await this.dbs.db
      .select()
      .from(retentionReleases)
      .where(
        and(
          eq(retentionReleases.companyId, this.dbs.getCompanyId()),
          eq(retentionReleases.projectId, projectId),
        ),
      )
      .orderBy(desc(retentionReleases.createdAt));
    const out: LiberacionRetencionDto[] = [];
    for (const r of filas) out.push(await this.liberacionDto(this.dbs.db, r));
    return out;
  }

  /**
   * Libera retenciones de un mismo tercero y lado de la obra por hito o por
   * sustitución con un aval: el aval es del tipo de retención, del mismo
   * tercero, vivo y con la dirección que corresponde (recibido de la
   * subcontrata para lo que le retenemos; emitido por nosotros para lo que
   * nos retiene el cliente) y cubre lo sustituido.
   */
  async liberar(
    projectId: string,
    input: LiberacionRetencionInput,
  ): Promise<LiberacionRetencionDto> {
    const d = liberacionRetencionSchema.parse(input);
    if (d.fecha > todayIso()) {
      throw new UnprocessableEntityException({
        code: 'PS_RETENTION_NOT_OPEN',
        message: 'La fecha de liberación no puede ser futura',
      });
    }
    const companyId = this.dbs.getCompanyId();
    const id = await this.dbs.db.transaction(async (tx) => {
      await this.obra(tx, projectId);
      const ids = [...new Set(d.vencimientoIds)].sort();
      // Bloqueo estable de los vencimientos (orden por id).
      await tx
        .select({ id: paymentMilestones.id })
        .from(paymentMilestones)
        .where(inArray(paymentMilestones.id, ids))
        .orderBy(paymentMilestones.id)
        .for('update');
      const filas = await this.retencionesDe(tx, projectId, ids);
      if (filas.length !== ids.length) {
        throw new UnprocessableEntityException({
          code: 'PS_RETENTION_NOT_FOUND',
          message: 'Alguna retención no es de esta obra',
        });
      }
      const lado = filas[0].lado;
      const contactId = filas[0].contactId;
      if (filas.some((f) => f.lado !== lado || f.contactId !== contactId)) {
        throw new UnprocessableEntityException({
          code: 'PS_RETENTION_MIXED',
          message: 'Libera a la vez solo retenciones del mismo tercero y lado',
        });
      }
      const ya = await this.liberacionesVigentes(tx, ids);
      if (ya.size > 0) {
        throw new ConflictException({
          code: 'PS_RETENTION_ALREADY_RELEASED',
          message: 'Alguna retención ya está liberada',
        });
      }
      let aval: { saldoVivo: string; yaSustituido: string } | null = null;
      if (d.tipo === 'aval') {
        const [g] = await tx
          .select()
          .from(bankGuarantees)
          .where(
            and(
              eq(bankGuarantees.id, d.avalId!),
              eq(bankGuarantees.companyId, companyId),
            ),
          )
          .for('update');
        const direccion = lado === 'pago' ? 'recibido' : 'emitido';
        if (
          !g ||
          g.type !== 'retencion_garantia' ||
          g.direction !== direccion ||
          g.contactId !== contactId ||
          !(ESTADOS_AVAL_VIVOS as readonly string[]).includes(g.status)
        ) {
          throw new UnprocessableEntityException({
            code: 'PS_GUARANTEE_INVALID',
            message: `El aval debe ser de retención de garantía, ${direccion}, vivo y del mismo tercero`,
          });
        }
        aval = {
          saldoVivo: g.outstandingAmount,
          yaSustituido: await sustituidoPorAval(tx, g.id),
        };
      }
      const plan = regla(() =>
        planLiberacionRetenciones({
          fecha: d.fecha,
          retenciones: filas.map((f) => ({
            id: f.id,
            pendiente: centsToNumeric(
              toCents(f.importe) - toCents(f.liquidado),
            ),
            vencimiento: f.vencimiento,
          })),
          aval,
        }),
      );
      const [rel] = await tx
        .insert(retentionReleases)
        .values({
          companyId,
          kind: d.tipo,
          side: lado,
          projectId,
          contactId,
          guaranteeId: d.avalId ?? null,
          releaseDate: d.fecha,
          amount: centsToNumeric(toCents(plan.total)),
          reason: d.motivo,
          createdBy: usuarioPersistible(),
        })
        .returning();
      await tx.insert(retentionReleaseLines).values(
        plan.lineas.map((l) => ({
          companyId,
          releaseId: rel.id,
          milestoneId: l.id,
          amount: centsToNumeric(toCents(l.importe)),
          previousDueDate: l.vencimientoAnterior,
        })),
      );
      for (const f of filas) {
        await tx
          .update(paymentMilestones)
          .set({
            dueDate: d.fecha,
            version: f.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(paymentMilestones.id, f.id));
      }
      await this.audit.registrar(tx, [
        {
          entityType: 'retention_release',
          entityId: rel.id,
          action: 'create',
          newData: { ...rel, lineas: plan.lineas },
        },
        ...filas.map((f) => ({
          entityType: 'payment_milestone' as const,
          entityId: f.id,
          action: 'update' as const,
          oldData: { dueDate: f.vencimiento },
          newData: { dueDate: d.fecha, liberacion: rel.id },
        })),
      ]);
      return rel.id;
    });
    const [r] = await this.dbs.db
      .select()
      .from(retentionReleases)
      .where(eq(retentionReleases.id, id));
    return this.liberacionDto(this.dbs.db, r);
  }

  /** Deshace una liberación si sus retenciones no se han cobrado ni pagado. */
  async anularLiberacion(
    id: string,
    input: AnularLiberacionInput,
    version: number | undefined,
  ): Promise<LiberacionRetencionDto> {
    const { motivo } = anularLiberacionSchema.parse(input);
    await this.dbs.db.transaction(async (tx) => {
      const [r] = await tx
        .select()
        .from(retentionReleases)
        .where(
          and(
            eq(retentionReleases.id, id),
            eq(retentionReleases.companyId, this.dbs.getCompanyId()),
          ),
        )
        .for('update');
      if (!r)
        throw new NotFoundException({
          code: 'PS_RELEASE_NOT_FOUND',
          message: 'Liberación no encontrada',
        });
      await this.obra(tx, r.projectId!);
      verificarVersion(r.version, version);
      if (r.status !== 'vigente') {
        throw new ConflictException({
          code: 'PS_RELEASE_ALREADY_CANCELLED',
          message: 'La liberación ya está anulada',
        });
      }
      const lineas = await tx
        .select()
        .from(retentionReleaseLines)
        .where(eq(retentionReleaseLines.releaseId, r.id));
      const ms = await tx
        .select()
        .from(paymentMilestones)
        .where(
          inArray(
            paymentMilestones.id,
            lineas.map((l) => l.milestoneId),
          ),
        )
        .orderBy(paymentMilestones.id)
        .for('update');
      for (const l of lineas) {
        const m = ms.find((x) => x.id === l.milestoneId)!;
        // Liquidado más allá de lo que había al liberar: ya se cobró o pagó.
        if (toCents(m.amount) - toCents(m.settledAmount) < toCents(l.amount)) {
          throw new ConflictException({
            code: 'PS_RELEASE_SETTLED',
            message:
              'La retención liberada ya se ha cobrado o pagado (total o parcialmente): no se deshace',
          });
        }
      }
      for (const l of lineas) {
        const m = ms.find((x) => x.id === l.milestoneId)!;
        await tx
          .update(paymentMilestones)
          .set({
            dueDate: l.previousDueDate,
            version: m.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(paymentMilestones.id, m.id));
      }
      await cambiarEstado(
        tx,
        retentionReleases,
        'retention_release',
        r.id,
        'vigente',
        'anulado',
        { cancelReason: motivo },
        r.version,
      );
      await this.audit.registrar(tx, [
        {
          entityType: 'retention_release',
          entityId: r.id,
          action: 'update',
          oldData: { status: 'vigente' },
          newData: { status: 'anulado', motivo },
        },
        ...lineas.map((l) => ({
          entityType: 'payment_milestone' as const,
          entityId: l.milestoneId,
          action: 'update' as const,
          oldData: { dueDate: r.releaseDate },
          newData: { dueDate: l.previousDueDate },
        })),
      ]);
    });
    const [r] = await this.dbs.db
      .select()
      .from(retentionReleases)
      .where(eq(retentionReleases.id, id));
    return this.liberacionDto(this.dbs.db, r);
  }

  /* ─────────────────── modificados de subcontrata ─────────────────── */

  private async contrato(ex: DbOrTx, id: string, bloquear = false) {
    const q = ex
      .select()
      .from(contratosSubcontrata)
      .where(
        and(
          eq(contratosSubcontrata.id, id),
          eq(contratosSubcontrata.companyId, this.dbs.getCompanyId()),
          isNull(contratosSubcontrata.deletedAt),
        ),
      );
    const [c] = bloquear ? await q.for('update') : await q;
    if (!c)
      throw new NotFoundException({
        code: 'SUBCONTRACT_NOT_FOUND',
        message: 'Contrato de subcontrata no encontrado',
      });
    await this.obra(ex, c.proyectoId);
    return c;
  }

  async modificados(contratoId: string): Promise<ModificadoSubcontrataDto[]> {
    await this.contrato(this.dbs.db, contratoId);
    const filas = await this.dbs.db
      .select()
      .from(subcontractChanges)
      .where(eq(subcontractChanges.contractId, contratoId))
      .orderBy(asc(subcontractChanges.number));
    return filas.map((m) => ({
      id: m.id,
      contratoId: m.contractId,
      numero: m.number,
      fecha: m.changeDate,
      importe: fromCents(toCents(m.amount)),
      importeAnterior: fromCents(toCents(m.previousAmount)),
      importeNuevo: fromCents(toCents(m.newAmount)),
      motivo: m.reason,
    }));
  }

  /**
   * Modificado (adenda) del contrato de subcontrata: actualiza el importe
   * contratado (nunca por debajo de lo certificado a origen) y recalcula el %
   * ejecutado. Bloquea el contrato, como las certificaciones.
   */
  async crearModificado(
    contratoId: string,
    input: ModificadoSubcontrataInput,
  ): Promise<ModificadoSubcontrataDto[]> {
    const d = modificadoSubcontrataSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    await this.dbs.db.transaction(async (tx) => {
      const c = await this.contrato(tx, contratoId, true);
      const certs = await tx
        .select({
          status: certificacionesSubcontrata.status,
          origen: certificacionesSubcontrata.importeOrigen,
          numero: certificacionesSubcontrata.numero,
        })
        .from(certificacionesSubcontrata)
        .where(
          and(
            eq(certificacionesSubcontrata.contratoId, c.id),
            isNull(certificacionesSubcontrata.deletedAt),
          ),
        );
      const vigentes = certs
        .filter((x) =>
          esCertSubcontrataVigente(x.status as CertSubcontrataStatus),
        )
        .sort((a, b) => b.numero - a.numero);
      const certificado = vigentes[0]?.origen ?? '0';
      const nuevo = regla(() =>
        aplicarModificado({
          importeVigente: c.importeTotal,
          importeModificado: d.importe,
          certificadoOrigen: certificado,
        }),
      );
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(subcontractChanges)
        .where(eq(subcontractChanges.contractId, c.id));
      const nuevoTxt = centsToNumeric(toCents(nuevo));
      const ejecutado = toCents(c.importeEjecutado);
      const pct = Number(mulDivRound(ejecutado, 10_000n, toCents(nuevo))) / 100;
      const [m] = await tx
        .insert(subcontractChanges)
        .values({
          companyId,
          contractId: c.id,
          number: Number(n) + 1,
          changeDate: d.fecha,
          amount: centsToNumeric(toCents(d.importe)),
          previousAmount: c.importeTotal,
          newAmount: nuevoTxt,
          reason: d.motivo,
          createdBy: usuarioPersistible(),
        })
        .returning();
      await tx
        .update(contratosSubcontrata)
        .set({
          importeTotal: nuevoTxt,
          pctEjecutado: pct.toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(contratosSubcontrata.id, c.id));
      await this.audit.registrar(tx, [
        {
          entityType: 'subcontract_change',
          entityId: m.id,
          action: 'create',
          newData: m,
        },
        {
          entityType: 'contrato_subcontrata',
          entityId: c.id,
          action: 'update',
          oldData: {
            importeTotal: c.importeTotal,
            pctEjecutado: c.pctEjecutado,
          },
          newData: {
            importeTotal: nuevoTxt,
            pctEjecutado: pct.toFixed(2),
            modificado: m.number,
          },
        },
      ]);
    });
    return this.modificados(contratoId);
  }
}
