import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  SQL,
} from 'drizzle-orm';
import {
  bankAccounts,
  bankGuaranteeLines,
  bankGuaranteeRates,
  bankGuaranteeMovements,
  bankGuarantees,
  certifications,
  contacts,
  contratosObra,
  notifications,
  projects,
  type BankGuarantee,
  type BankGuaranteeLine,
  type BankGuaranteeMovement,
  type DbOrTx,
  type Tx,
} from '@erp/db';
import {
  ESTADOS_AVAL_VIVOS,
  aplicarMovimientoAval,
  asientoComisionAval,
  asientoEjecucionAval,
  motivoReduccionAvalSustituto,
  avalAnularSchema,
  avalComisionSchema,
  avalCreateSchema,
  avalEjecutarSchema,
  avalLiberarSchema,
  avalProrrogaSchema,
  avalUpdateSchema,
  avalVencerSchema,
  avalesAvisosSchema,
  centsToNumeric,
  comisionAval,
  diasHastaVencimiento,
  diferenciasAuditoria,
  liquidacionComisionContraDevengo,
  asientoLiquidacionComision,
  fromCents,
  lineaAvalCreateSchema,
  lineaAvalUpdateSchema,
  resumenAvales,
  validarLineaAval,
  type LineaAvalCreateInput,
  type LineaAvalDto,
  type LineaAvalUpdateInput,
  type LiquidacionEjecucionAval,
  saldoAval,
  toCents,
  TIPO_AVAL_LABELS,
  type AvalAnularInput,
  type AvalComisionInput,
  type AvalCreateInput,
  type AvalDetalleDto,
  type AvalDto,
  type AvalEjecutarInput,
  type AvalesAvisosInput,
  type AvalesQuery,
  type AvalesResumenQuery,
  type AvalLiberarInput,
  type AvalProrrogaInput,
  type AvalUpdateInput,
  type AvalVencerInput,
  type DireccionAval,
  type EstadoAval,
  type LineaAsientoWip,
  type MovimientoAvalDto,
  type ResultadoAvisosAvalesDto,
  type ResumenAvalesDto,
  type TipoAval,
  type TipoMovimientoAval,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { NotificacionesService } from '../alerts/notificaciones.service';
import { cambiarEstado } from '../common/cambiar-estado';
import {
  getRequestContext,
  usuarioPersistible,
} from '../common/request-context';
import { verificarVersion } from '../common/version';
import { ContabilidadService } from '../contabilidad/contabilidad.service';
import { DbService } from '../db/db.service';
import { sustituidoPorAval } from '../project-system/retenciones';

const hoyIso = () => new Date().toISOString().slice(0, 10);

const lineaDuplicada = () =>
  new ConflictException({
    code: 'BANK_GUARANTEE_LINE_DUPLICATE',
    message: 'Ya hay una línea de avales para esa entidad',
  });

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const avalNoEncontrado = () =>
  new NotFoundException({
    code: 'BANK_GUARANTEE_NOT_FOUND',
    message: 'Aval no encontrado',
  });

const vinculoInvalido = (message: string) =>
  new UnprocessableEntityException({
    code: 'BANK_GUARANTEE_LINK_INVALID',
    message,
  });

const fechaInvalida = (message: string) =>
  new UnprocessableEntityException({
    code: 'BANK_GUARANTEE_DATE_INVALID',
    message,
  });

const noVivo = (estado: string) =>
  new ConflictException({
    code: 'BANK_GUARANTEE_NOT_ACTIVE',
    message: `El aval no está vivo (estado «${estado}»): no admite movimientos`,
  });

const n = (v: number) => centsToNumeric(toCents(v));

interface Fila {
  g: BankGuarantee;
  projectCodigo: string | null;
  contactNombre: string | null;
}

function avalDto(f: Fila, hoy: string): AvalDto {
  const g = f.g;
  return {
    ...saldoAval({
      nominal: g.amount,
      liberado: g.releasedAmount,
      ejecutado: g.executedAmount,
    }),
    id: g.id,
    referencia: g.reference,
    tipo: g.type as TipoAval,
    direccion: g.direction as DireccionAval,
    entidad: g.issuer,
    projectId: g.projectId,
    projectCodigo: f.projectCodigo,
    contactId: g.contactId,
    contactNombre: f.contactNombre,
    contratoObraId: g.contratoObraId,
    certificationId: g.certificationId,
    bankAccountId: g.bankAccountId,
    fechaEmision: g.issueDate,
    fechaVencimiento: g.expiryDate,
    diasHastaVencimiento: diasHastaVencimiento(g.expiryDate, hoy),
    tasaComisionAnualPct:
      g.commissionRatePct === null ? null : Number(g.commissionRatePct),
    periodicidadComisionMeses: g.commissionPeriodMonths,
    comisiones: fromCents(toCents(g.commissionsAmount)),
    comisionDevengada: fromCents(toCents(g.accruedCommission)),
    devengoLiquidado: fromCents(toCents(g.accrualSettled)),
    estado: g.status as EstadoAval,
    motivo: g.reason,
    notas: g.notes,
    version: g.version,
  };
}

function movimientoDto(m: BankGuaranteeMovement): MovimientoAvalDto {
  return {
    id: m.id,
    tipo: m.type as TipoMovimientoAval,
    fecha: m.movementDate,
    importe: fromCents(toCents(m.amount)),
    saldoVivo: fromCents(toCents(m.outstandingAfter)),
    fechaVencimiento: m.expiryDate,
    motivo: m.reason,
    asientoId: m.journalEntryId,
    financiada: m.financed,
    createdAt: m.createdAt.toISOString(),
  };
}

/**
 * Avales bancarios y garantías (SAP Treasury Bank Guarantees / Oracle
 * Project Contracts Bonds). Un aval vivo es un riesgo contingente sin asiento
 * de balance; el módulo contabiliza solo sus comisiones (6260 a 5720) y su
 * ejecución (emitido: 6780 a 5720; recibido: 5720 a 7780), imputadas a la
 * obra, por `ContabilidadService.contabilizarEnTx` (que rechaza los periodos
 * cerrados con FISCAL_PERIOD_CLOSED). Cada mutación bloquea la fila, valida
 * la versión (If-Match), deja un movimiento inmutable y audita
 * `bank_guarantee` en la cadena hash.
 */
@Injectable()
export class AvalesService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly contabilidad: ContabilidadService,
    private readonly notificaciones: NotificacionesService,
  ) {}

  /* ─────────────────────────── acceso ─────────────────────────── */

  /**
   * Filtro de acceso por obra: los roles con obras asignadas solo ven los
   * avales de sus obras (no los de empresa, sin obra). `null`: sin filas.
   */
  private async filtroAcceso(): Promise<SQL | undefined | null> {
    const accesibles = await this.dbs.getObrasAccesibles();
    if (accesibles === null) return undefined;
    if (accesibles.length === 0) return null;
    return inArray(bankGuarantees.projectId, accesibles);
  }

  private async exigirAcceso(projectId: string | null): Promise<void> {
    const accesibles = await this.dbs.getObrasAccesibles();
    if (accesibles === null) return;
    if (!projectId || !accesibles.includes(projectId)) throw avalNoEncontrado();
  }

  /* ─────────────────────────── consultas ─────────────────────────── */

  private async filas(filtros: SQL[]): Promise<Fila[]> {
    return this.dbs.db
      .select({
        g: bankGuarantees,
        projectCodigo: projects.code,
        contactNombre: contacts.legalName,
      })
      .from(bankGuarantees)
      .leftJoin(projects, eq(projects.id, bankGuarantees.projectId))
      .leftJoin(contacts, eq(contacts.id, bankGuarantees.contactId))
      .where(and(...filtros))
      .orderBy(
        sql`${bankGuarantees.expiryDate} asc nulls last`,
        asc(bankGuarantees.reference),
      );
  }

  async listar(q: AvalesQuery): Promise<AvalDto[]> {
    const hoy = q.hoy ?? hoyIso();
    const acceso = await this.filtroAcceso();
    if (acceso === null) return [];
    const f: SQL[] = [eq(bankGuarantees.companyId, this.dbs.getCompanyId())];
    if (acceso) f.push(acceso);
    if (q.projectId) f.push(eq(bankGuarantees.projectId, q.projectId));
    if (q.contactId) f.push(eq(bankGuarantees.contactId, q.contactId));
    if (q.estado) f.push(eq(bankGuarantees.status, q.estado));
    if (q.tipo) f.push(eq(bankGuarantees.type, q.tipo));
    if (q.direccion) f.push(eq(bankGuarantees.direction, q.direccion));
    if (q.vivos || q.venceEnDias !== undefined) {
      f.push(inArray(bankGuarantees.status, [...ESTADOS_AVAL_VIVOS]));
    }
    if (q.venceEnDias !== undefined) {
      f.push(
        isNotNull(bankGuarantees.expiryDate),
        lte(bankGuarantees.expiryDate, sumarDias(hoy, q.venceEnDias)),
      );
    }
    if (q.q) {
      const patron = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      f.push(
        or(
          ilike(bankGuarantees.reference, patron),
          ilike(bankGuarantees.issuer, patron),
        )!,
      );
    }
    return (await this.filas(f)).map((x) => avalDto(x, hoy));
  }

  async resumen(q: AvalesResumenQuery): Promise<ResumenAvalesDto> {
    const hoy = q.hoy ?? hoyIso();
    const avales = await this.listar({ projectId: q.projectId, hoy });
    return {
      ...resumenAvales(
        avales.map((a) => ({
          direccion: a.direccion,
          estado: a.estado,
          nominal: a.nominal,
          saldoVivo: a.saldoVivo,
          fechaVencimiento: a.fechaVencimiento,
          comisiones: a.comisiones,
        })),
        hoy,
        q.dias,
      ),
      hoy,
      dias: q.dias,
    };
  }

  async detalle(id: string): Promise<AvalDetalleDto> {
    const companyId = this.dbs.getCompanyId();
    const [f] = await this.filas([
      eq(bankGuarantees.id, id),
      eq(bankGuarantees.companyId, companyId),
    ]);
    if (!f) throw avalNoEncontrado();
    await this.exigirAcceso(f.g.projectId);
    const movs = await this.dbs.db
      .select()
      .from(bankGuaranteeMovements)
      .where(
        and(
          eq(bankGuaranteeMovements.companyId, companyId),
          eq(bankGuaranteeMovements.guaranteeId, id),
        ),
      )
      .orderBy(
        asc(bankGuaranteeMovements.movementDate),
        asc(bankGuaranteeMovements.createdAt),
      );
    const tasas = await this.dbs.db
      .select({
        fecha: bankGuaranteeRates.effectiveDate,
        tasa: bankGuaranteeRates.ratePct,
      })
      .from(bankGuaranteeRates)
      .where(
        and(
          eq(bankGuaranteeRates.companyId, companyId),
          eq(bankGuaranteeRates.guaranteeId, id),
        ),
      )
      .orderBy(asc(bankGuaranteeRates.effectiveDate));
    return {
      ...avalDto(f, hoyIso()),
      movimientos: movs.map(movimientoDto),
      tasas: tasas.map((t) => ({
        fecha: t.fecha,
        tasaAnualPct: t.tasa === null ? null : Number(t.tasa),
      })),
    };
  }

  /* ─────────────────────────── vínculos ─────────────────────────── */

  /** Obra, contacto, contrato, certificación y cuenta: de la empresa y coherentes. */
  private async validarVinculos(
    tx: Tx,
    v: {
      projectId: string | null;
      contactId?: string | null;
      contratoObraId?: string | null;
      certificationId?: string | null;
      bankAccountId?: string | null;
    },
  ): Promise<void> {
    const companyId = this.dbs.getCompanyId();
    if (v.projectId) {
      const [p] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.id, v.projectId),
            eq(projects.companyId, companyId),
            isNull(projects.deletedAt),
          ),
        );
      if (!p) {
        throw new NotFoundException({
          code: 'PROJECT_NOT_FOUND',
          message: 'Obra no encontrada',
        });
      }
    }
    await this.exigirAcceso(v.projectId);
    if (v.contactId) {
      const [c] = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.id, v.contactId),
            eq(contacts.companyId, companyId),
            isNull(contacts.deletedAt),
          ),
        );
      if (!c) throw vinculoInvalido('El contacto no existe en la empresa');
    }
    if (v.contratoObraId) {
      const [c] = await tx
        .select({
          projectId: contratosObra.projectId,
          contactId: contratosObra.contactId,
        })
        .from(contratosObra)
        .where(
          and(
            eq(contratosObra.id, v.contratoObraId),
            eq(contratosObra.companyId, companyId),
            isNull(contratosObra.deletedAt),
          ),
        );
      if (!c) throw vinculoInvalido('El contrato no existe en la empresa');
      if (c.projectId !== v.projectId) {
        throw vinculoInvalido('El contrato es de otra obra');
      }
      if (v.contactId && c.contactId !== v.contactId) {
        throw vinculoInvalido('El contrato es con otro contacto');
      }
    }
    if (v.certificationId) {
      const [c] = await tx
        .select({ projectId: certifications.projectId })
        .from(certifications)
        .where(
          and(
            eq(certifications.id, v.certificationId),
            eq(certifications.companyId, companyId),
          ),
        );
      if (!c) throw vinculoInvalido('La certificación no existe en la empresa');
      if (c.projectId !== v.projectId) {
        throw vinculoInvalido('La certificación es de otra obra');
      }
    }
    if (v.bankAccountId) {
      const [b] = await tx
        .select({ isActive: bankAccounts.isActive })
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.id, v.bankAccountId),
            eq(bankAccounts.companyId, companyId),
            isNull(bankAccounts.deletedAt),
          ),
        );
      if (!b?.isActive) {
        throw vinculoInvalido('La cuenta bancaria no existe o está inactiva');
      }
    }
  }

  private referenciaDuplicada(e: unknown): never {
    const pg = (e as { cause?: { code?: string }; code?: string }) ?? {};
    if ((pg.cause?.code ?? pg.code) === '23505') {
      throw new ConflictException({
        code: 'BANK_GUARANTEE_REFERENCE_DUPLICATE',
        message: 'Ya hay un aval con esa referencia en la misma entidad',
      });
    }
    throw e;
  }

  /* ─────────────────────────── alta y edición ─────────────────────────── */

  /* ─────────────────────── líneas de avales por entidad ─────────────────────── */

  /** Saldo vivo de los avales emitidos de una entidad (dispuesto de su línea). */
  private async dispuesto(ex: DbOrTx, entidad: string): Promise<string> {
    const [f] = await ex
      .select({
        total: sql<string>`coalesce(sum(${bankGuarantees.outstandingAmount}), 0)`,
      })
      .from(bankGuarantees)
      .where(
        and(
          eq(bankGuarantees.companyId, this.dbs.getCompanyId()),
          eq(bankGuarantees.direction, 'emitido'),
          inArray(bankGuarantees.status, [...ESTADOS_AVAL_VIVOS]),
          sql`lower(${bankGuarantees.issuer}) = lower(${entidad})`,
        ),
      );
    return f.total;
  }

  /**
   * Un aval emitido consume la línea de su entidad: si la hay y el alta la
   * supera (o la línea está inactiva o vencida), BANK_GUARANTEE_LIMIT_EXCEEDED.
   * Sin línea no hay límite. Serializa las altas de la misma entidad.
   */
  private async validarLinea(
    tx: Tx,
    entidad: string,
    importe: string,
    fecha: string,
  ): Promise<void> {
    const companyId = this.dbs.getCompanyId();
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`aval-linea:${companyId}:${entidad.toLowerCase()}`}))`,
    );
    const [linea] = await tx
      .select()
      .from(bankGuaranteeLines)
      .where(
        and(
          eq(bankGuaranteeLines.companyId, companyId),
          sql`lower(${bankGuaranteeLines.issuer}) = lower(${entidad})`,
        ),
      );
    if (!linea) return;
    const operativa =
      linea.isActive && (!linea.expiryDate || linea.expiryDate >= fecha);
    const v = validarLineaAval({
      limite: operativa ? linea.limitAmount : '0',
      dispuesto: await this.dispuesto(tx, entidad),
      importe,
    });
    if (!v.ok) {
      throw new ConflictException({
        code: 'BANK_GUARANTEE_LIMIT_EXCEEDED',
        message: operativa
          ? `El aval (${importe} €) supera el disponible de la línea de ${linea.issuer}: límite ${v.limite.toFixed(2)} €, dispuesto ${v.dispuesto.toFixed(2)} €, disponible ${v.disponible.toFixed(2)} €`
          : `La línea de avales de ${linea.issuer} está inactiva o vencida`,
      });
    }
  }

  private async lineaDto(l: BankGuaranteeLine): Promise<LineaAvalDto> {
    const dispuesto = toCents(await this.dispuesto(this.dbs.db, l.issuer));
    const limite = toCents(l.limitAmount);
    return {
      id: l.id,
      entidad: l.issuer,
      limite: fromCents(limite),
      dispuesto: fromCents(dispuesto),
      disponible: fromCents(limite - dispuesto),
      usoPct:
        limite === 0n ? null : Number((dispuesto * 10_000n) / limite) / 100,
      activa: l.isActive,
      fechaVencimiento: l.expiryDate,
      notas: l.notes,
      version: l.version,
    };
  }

  async listarLineas(): Promise<LineaAvalDto[]> {
    const filas = await this.dbs.db
      .select()
      .from(bankGuaranteeLines)
      .where(eq(bankGuaranteeLines.companyId, this.dbs.getCompanyId()))
      .orderBy(asc(bankGuaranteeLines.issuer));
    return Promise.all(filas.map((l) => this.lineaDto(l)));
  }

  private async lineaPorId(ex: DbOrTx, id: string, bloquear = false) {
    const q = ex
      .select()
      .from(bankGuaranteeLines)
      .where(
        and(
          eq(bankGuaranteeLines.id, id),
          eq(bankGuaranteeLines.companyId, this.dbs.getCompanyId()),
        ),
      );
    const [l] = bloquear ? await q.for('update') : await q;
    if (!l) {
      throw new NotFoundException({
        code: 'BANK_GUARANTEE_LINE_NOT_FOUND',
        message: 'Línea de avales no encontrada',
      });
    }
    return l;
  }

  async crearLinea(input: LineaAvalCreateInput): Promise<LineaAvalDto> {
    const d = lineaAvalCreateSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    let id = '';
    try {
      await this.dbs.db.transaction(async (tx) => {
        const [dup] = await tx
          .select({ id: bankGuaranteeLines.id })
          .from(bankGuaranteeLines)
          .where(
            and(
              eq(bankGuaranteeLines.companyId, companyId),
              sql`lower(${bankGuaranteeLines.issuer}) = lower(${d.entidad})`,
            ),
          );
        if (dup) throw lineaDuplicada();
        const [row] = await tx
          .insert(bankGuaranteeLines)
          .values({
            companyId,
            issuer: d.entidad,
            limitAmount: n(d.limite),
            expiryDate: d.fechaVencimiento ?? null,
            notes: d.notas ?? null,
          })
          .returning();
        id = row.id;
        await this.audit.registrar(tx, {
          entityType: 'bank_guarantee_line',
          entityId: row.id,
          action: 'create',
          newData: row,
        });
      });
    } catch (e) {
      const pg = (e as { cause?: { code?: string }; code?: string }) ?? {};
      if ((pg.cause?.code ?? pg.code) === '23505') throw lineaDuplicada();
      throw e;
    }
    return this.lineaDto(await this.lineaPorId(this.dbs.db, id));
  }

  async actualizarLinea(
    id: string,
    input: LineaAvalUpdateInput,
    version: number | undefined,
  ): Promise<LineaAvalDto> {
    const d = lineaAvalUpdateSchema.parse(input);
    await this.dbs.db.transaction(async (tx) => {
      const l = await this.lineaPorId(tx, id, true);
      verificarVersion(l.version, version);
      const [nueva] = await tx
        .update(bankGuaranteeLines)
        .set({
          ...(d.limite !== undefined && { limitAmount: n(d.limite) }),
          ...(d.activa !== undefined && { isActive: d.activa }),
          ...(d.fechaVencimiento !== undefined && {
            expiryDate: d.fechaVencimiento ?? null,
          }),
          ...(d.notas !== undefined && { notes: d.notas ?? null }),
          version: l.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(bankGuaranteeLines.id, id))
        .returning();
      const campos = ['limitAmount', 'isActive', 'expiryDate', 'notes'];
      await this.audit.registrar(tx, {
        entityType: 'bank_guarantee_line',
        entityId: id,
        action: 'update',
        oldData: l,
        newData: {
          ...nueva,
          cambios: diferenciasAuditoria(l, nueva, campos),
        },
      });
    });
    return this.lineaDto(await this.lineaPorId(this.dbs.db, id));
  }

  async crear(input: AvalCreateInput): Promise<AvalDetalleDto> {
    const d = avalCreateSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    const userId = getRequestContext()?.userId ?? null;
    const id = randomUUID();
    try {
      await this.dbs.db.transaction(async (tx) => {
        await this.validarVinculos(tx, {
          projectId: d.projectId ?? null,
          contactId: d.contactId,
          contratoObraId: d.contratoObraId,
          certificationId: d.certificationId,
          bankAccountId: d.bankAccountId,
        });
        const importe = n(d.importe);
        if (d.direccion === 'emitido') {
          await this.validarLinea(tx, d.entidad, importe, d.fechaEmision);
        }
        const [row] = await tx
          .insert(bankGuarantees)
          .values({
            id,
            companyId,
            reference: d.referencia,
            type: d.tipo,
            direction: d.direccion,
            issuer: d.entidad,
            projectId: d.projectId ?? null,
            contactId: d.contactId ?? null,
            contratoObraId: d.contratoObraId ?? null,
            certificationId: d.certificationId ?? null,
            bankAccountId: d.bankAccountId ?? null,
            amount: importe,
            outstandingAmount: importe,
            issueDate: d.fechaEmision,
            expiryDate: d.fechaVencimiento ?? null,
            commissionRatePct:
              d.tasaComisionAnualPct === null ||
              d.tasaComisionAnualPct === undefined
                ? null
                : d.tasaComisionAnualPct.toFixed(4),
            commissionPeriodMonths: d.periodicidadComisionMeses ?? null,
            notes: d.notas ?? null,
            createdBy: userId,
          })
          .returning();
        await this.movimiento(tx, row, {
          tipo: 'alta',
          fecha: d.fechaEmision,
          importe,
          saldo: importe,
        });
        if (row.commissionRatePct !== null) {
          await tx.insert(bankGuaranteeRates).values({
            companyId,
            guaranteeId: id,
            effectiveDate: d.fechaEmision,
            ratePct: row.commissionRatePct,
            createdBy: usuarioPersistible(),
          });
        }
        await this.audit.registrar(tx, {
          entityType: 'bank_guarantee',
          entityId: id,
          action: 'create',
          newData: row,
        });
      });
    } catch (e) {
      this.referenciaDuplicada(e);
    }
    return this.detalle(id);
  }

  /**
   * Nueva tasa con fecha de efecto en el historial: no antes de la emisión
   * ni de la última tasa (BANK_GUARANTEE_RATE_DATE_INVALID); la misma fecha
   * sustituye la tasa de ese día. Si el aval no tenía historial (anterior a
   * la 0064), se siembra con la tasa vigente desde la emisión.
   */
  private async registrarTasa(
    tx: Tx,
    g: BankGuarantee,
    tasa: number | null,
    desde: string,
  ): Promise<void> {
    if (desde < g.issueDate) {
      throw new UnprocessableEntityException({
        code: 'BANK_GUARANTEE_RATE_DATE_INVALID',
        message: `La nueva tasa no puede regir antes de la emisión del aval (${g.issueDate})`,
      });
    }
    const historial = await tx
      .select()
      .from(bankGuaranteeRates)
      .where(eq(bankGuaranteeRates.guaranteeId, g.id))
      .orderBy(desc(bankGuaranteeRates.effectiveDate));
    if (historial.length === 0 && g.commissionRatePct !== null) {
      await tx.insert(bankGuaranteeRates).values({
        companyId: g.companyId,
        guaranteeId: g.id,
        effectiveDate: g.issueDate,
        ratePct: g.commissionRatePct,
        createdBy: usuarioPersistible(),
      });
      historial.push({
        effectiveDate: g.issueDate,
      } as (typeof historial)[number]);
    }
    const ultima = historial[0]?.effectiveDate;
    if (ultima && desde < ultima) {
      throw new UnprocessableEntityException({
        code: 'BANK_GUARANTEE_RATE_DATE_INVALID',
        message: `La nueva tasa no puede regir antes del último cambio de tasa (${ultima})`,
      });
    }
    await tx
      .insert(bankGuaranteeRates)
      .values({
        companyId: g.companyId,
        guaranteeId: g.id,
        effectiveDate: desde,
        ratePct: tasa === null ? null : tasa.toFixed(4),
        createdBy: usuarioPersistible(),
      })
      .onConflictDoUpdate({
        target: [
          bankGuaranteeRates.companyId,
          bankGuaranteeRates.guaranteeId,
          bankGuaranteeRates.effectiveDate,
        ],
        set: { ratePct: tasa === null ? null : tasa.toFixed(4) },
      });
  }

  async actualizar(
    id: string,
    input: AvalUpdateInput,
    version: number | undefined,
  ): Promise<AvalDetalleDto> {
    const d = avalUpdateSchema.parse(input);
    await this.dbs.db
      .transaction(async (tx) => {
        const g = await this.bloquear(tx, id, version);
        if (
          d.tasaComisionAnualPct !== undefined &&
          d.tasaComisionAnualPct !== null &&
          g.direction !== 'emitido'
        ) {
          throw new UnprocessableEntityException({
            code: 'BANK_GUARANTEE_COMMISSION_NOT_APPLICABLE',
            message:
              'Solo los avales emitidos devengan comisión a nuestro cargo',
          });
        }
        await this.validarVinculos(tx, {
          projectId: g.projectId,
          contactId: d.contactId === undefined ? g.contactId : d.contactId,
          contratoObraId:
            d.contratoObraId === undefined
              ? g.contratoObraId
              : d.contratoObraId,
          certificationId:
            d.certificationId === undefined
              ? g.certificationId
              : d.certificationId,
          bankAccountId: d.bankAccountId,
        });
        if (d.tasaComisionAnualPct !== undefined) {
          await this.registrarTasa(
            tx,
            g,
            d.tasaComisionAnualPct,
            d.tasaVigenteDesde ?? hoyIso(),
          );
        }
        const [nuevo] = await tx
          .update(bankGuarantees)
          .set({
            ...(d.entidad !== undefined && { issuer: d.entidad }),
            ...(d.contactId !== undefined && {
              contactId: d.contactId ?? null,
            }),
            ...(d.contratoObraId !== undefined && {
              contratoObraId: d.contratoObraId ?? null,
            }),
            ...(d.certificationId !== undefined && {
              certificationId: d.certificationId ?? null,
            }),
            ...(d.bankAccountId !== undefined && {
              bankAccountId: d.bankAccountId ?? null,
            }),
            ...(d.tasaComisionAnualPct !== undefined && {
              commissionRatePct:
                d.tasaComisionAnualPct === null
                  ? null
                  : d.tasaComisionAnualPct.toFixed(4),
            }),
            ...(d.periodicidadComisionMeses !== undefined && {
              commissionPeriodMonths: d.periodicidadComisionMeses ?? null,
            }),
            ...(d.notas !== undefined && { notes: d.notas ?? null }),
            version: g.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(bankGuarantees.id, id))
          .returning();
        await this.audit.registrar(tx, {
          entityType: 'bank_guarantee',
          entityId: id,
          action: 'update',
          oldData: g,
          newData: nuevo,
        });
      })
      .catch((e: unknown) => this.referenciaDuplicada(e));
    return this.detalle(id);
  }

  /* ─────────────────────────── movimientos ─────────────────────────── */

  /** Bloquea el aval (FOR UPDATE), comprueba empresa, acceso y versión. */
  private async bloquear(
    tx: Tx,
    id: string,
    version: number | undefined,
  ): Promise<BankGuarantee> {
    const [g] = await tx
      .select()
      .from(bankGuarantees)
      .where(
        and(
          eq(bankGuarantees.id, id),
          eq(bankGuarantees.companyId, this.dbs.getCompanyId()),
        ),
      )
      .for('update');
    if (!g) throw avalNoEncontrado();
    await this.exigirAcceso(g.projectId);
    verificarVersion(g.version, version);
    return g;
  }

  private async movimiento(
    tx: Tx,
    g: BankGuarantee,
    m: {
      tipo: TipoMovimientoAval;
      fecha: string;
      importe?: string;
      saldo: string;
      vencimiento?: string | null;
      motivo?: string | null;
      asientoId?: string | null;
      id?: string;
      financiada?: boolean;
      liquidadoContraDevengo?: string;
    },
  ): Promise<string> {
    const [row] = await tx
      .insert(bankGuaranteeMovements)
      .values({
        id: m.id ?? randomUUID(),
        companyId: g.companyId,
        guaranteeId: g.id,
        type: m.tipo,
        movementDate: m.fecha,
        amount: m.importe ?? '0',
        outstandingAfter: m.saldo,
        expiryDate:
          m.vencimiento === undefined ? g.expiryDate : (m.vencimiento ?? null),
        reason: m.motivo ?? null,
        journalEntryId: m.asientoId ?? null,
        financed: m.financiada ?? false,
        accrualSettledAmount: m.liquidadoContraDevengo ?? '0',
        createdBy: getRequestContext()?.userId ?? null,
      })
      .returning({ id: bankGuaranteeMovements.id });
    return row.id;
  }

  private exigirFecha(g: BankGuarantee, fecha: string): void {
    if (fecha < g.issueDate) {
      throw fechaInvalida(
        `La fecha (${fecha}) no puede ser anterior a la emisión del aval (${g.issueDate})`,
      );
    }
  }

  private async asiento(
    tx: Tx,
    g: BankGuarantee,
    fecha: string,
    concepto: string,
    origenId: string,
    lineas: LineaAsientoWip[],
  ): Promise<string | null> {
    if (lineas.length === 0) return null;
    const a = await this.contabilidad.contabilizarEnTx(tx, {
      companyId: g.companyId,
      fecha,
      concepto,
      origen: 'aval',
      origenId,
      lineas: lineas.map((l) => ({
        cuenta: l.cuenta,
        debe: l.debe,
        haber: l.haber,
        projectId: l.imputaObra ? g.projectId : null,
        concepto,
      })),
    });
    return a.id;
  }

  /**
   * Liberación, ejecución o vencimiento: aplica la regla pura, cambia el
   * estado por la máquina de estados (`cambiarEstado`, con `WHERE status`),
   * deja el movimiento y, en la ejecución, contabiliza y notifica.
   */
  private async reducir(
    id: string,
    tipo: 'liberacion' | 'ejecucion' | 'vencimiento',
    d: {
      fecha: string;
      importe?: number | null;
      motivo?: string;
      liquidacion?: LiquidacionEjecucionAval;
    },
    version: number | undefined,
    validar?: (g: BankGuarantee) => void,
  ): Promise<AvalDetalleDto> {
    const financiada = d.liquidacion === 'financiacion';
    await this.dbs.db.transaction(async (tx) => {
      const g = await this.bloquear(tx, id, version);
      const de = g.status as EstadoAval;
      if (de !== 'vigente' && de !== 'liberado_parcial') throw noVivo(de);
      this.exigirFecha(g, d.fecha);
      validar?.(g);
      if (financiada && g.direction !== 'emitido') {
        throw new UnprocessableEntityException({
          code: 'BANK_GUARANTEE_FINANCING_NOT_APPLICABLE',
          message:
            'Solo la ejecución de un aval emitido puede financiarla el banco (5200)',
        });
      }
      const r = aplicarMovimientoAval({
        estado: de,
        nominal: g.amount,
        liberado: g.releasedAmount,
        ejecutado: g.executedAmount,
        tipo,
        importe: d.importe,
      });
      if (!r.ok) {
        throw r.codigo === 'BANK_GUARANTEE_NOT_ACTIVE'
          ? noVivo(de)
          : new UnprocessableEntityException({
              code: r.codigo,
              message: r.mensaje,
            });
      }
      // Un aval que sustituye retenciones no se libera ni vence por debajo de
      // lo que sustituye (ejecutarlo sí: es cobrar la garantía).
      if (tipo !== 'ejecucion') {
        const motivoSust = motivoReduccionAvalSustituto({
          saldoVivoTras: r.saldoVivo,
          sustituido: await sustituidoPorAval(tx, g.id),
        });
        if (motivoSust) {
          throw new ConflictException({
            code: 'PS_GUARANTEE_SUBSTITUTING',
            message: motivoSust,
          });
        }
      }
      const movId = randomUUID();
      let asientoId: string | null = null;
      if (tipo === 'ejecucion') {
        const direccion = g.direction as DireccionAval;
        asientoId = await this.asiento(
          tx,
          g,
          d.fecha,
          `Ejecución de aval ${g.reference} (${g.issuer})${financiada ? ' financiada' : ''}`,
          movId,
          asientoEjecucionAval(r.importe, direccion, financiada),
        );
        await this.notificaciones.notificar(tx, {
          companyId: g.companyId,
          tipo: 'aval',
          titulo: `Aval ${g.reference} ejecutado por ${r.importe.toFixed(2)} €`,
          cuerpo:
            `${TIPO_AVAL_LABELS[g.type as TipoAval]} ${direccion} ` +
            `(${g.issuer}): ${d.motivo ?? ''}. Saldo vivo ${r.saldoVivo.toFixed(2)} €.`,
          enlace: '/avales',
          clave: `aval:ejecucion:${movId}`,
        });
      }
      const motivo = d.motivo ?? 'Vencimiento del aval';
      await cambiarEstado(
        tx,
        bankGuarantees,
        'bank_guarantee',
        id,
        de,
        r.estado,
        {
          releasedAmount: n(r.liberado),
          executedAmount: n(r.ejecutado),
          outstandingAmount: n(r.saldoVivo),
          reason: motivo,
        },
        version,
      );
      await this.movimiento(tx, g, {
        id: movId,
        tipo,
        fecha: d.fecha,
        importe: n(r.importe),
        saldo: n(r.saldoVivo),
        motivo,
        asientoId,
        financiada,
      });
      const antes = {
        status: de,
        releasedAmount: g.releasedAmount,
        executedAmount: g.executedAmount,
        outstandingAmount: g.outstandingAmount,
      };
      const despues = {
        status: r.estado,
        releasedAmount: n(r.liberado),
        executedAmount: n(r.ejecutado),
        outstandingAmount: n(r.saldoVivo),
      };
      await this.audit.registrar(tx, {
        entityType: 'bank_guarantee',
        entityId: id,
        action: 'update',
        oldData: antes,
        newData: {
          ...despues,
          movimiento: tipo,
          importe: r.importe,
          asientoId,
          financiada,
          cambios: diferenciasAuditoria(antes, despues),
        },
      });
    });
    return this.detalle(id);
  }

  liberar(id: string, input: AvalLiberarInput, version: number | undefined) {
    const d = avalLiberarSchema.parse(input);
    return this.reducir(id, 'liberacion', d, version);
  }

  ejecutar(id: string, input: AvalEjecutarInput, version: number | undefined) {
    const d = avalEjecutarSchema.parse(input);
    return this.reducir(id, 'ejecucion', d, version);
  }

  vencer(id: string, input: AvalVencerInput, version: number | undefined) {
    const d = avalVencerSchema.parse(input);
    return this.reducir(id, 'vencimiento', d, version, (g) => {
      if (!g.expiryDate || d.fecha < g.expiryDate) {
        throw new ConflictException({
          code: 'BANK_GUARANTEE_NOT_EXPIRED',
          message: g.expiryDate
            ? `El aval vence el ${g.expiryDate}: no se puede dar por vencido el ${d.fecha}`
            : 'El aval es indefinido: se cancela por liberación, no por vencimiento',
        });
      }
    });
  }

  async prorrogar(
    id: string,
    input: AvalProrrogaInput,
    version: number | undefined,
  ): Promise<AvalDetalleDto> {
    const d = avalProrrogaSchema.parse(input);
    await this.dbs.db.transaction(async (tx) => {
      const g = await this.bloquear(tx, id, version);
      const de = g.status as EstadoAval;
      if (de !== 'vigente' && de !== 'liberado_parcial') throw noVivo(de);
      this.exigirFecha(g, d.fecha);
      if (!g.expiryDate || d.nuevaFechaVencimiento <= g.expiryDate) {
        throw new UnprocessableEntityException({
          code: 'BANK_GUARANTEE_EXTENSION_INVALID',
          message: g.expiryDate
            ? `El nuevo vencimiento debe ser posterior al actual (${g.expiryDate})`
            : 'El aval es indefinido: no admite prórroga',
        });
      }
      const [nuevo] = await tx
        .update(bankGuarantees)
        .set({
          expiryDate: d.nuevaFechaVencimiento,
          version: g.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(bankGuarantees.id, id))
        .returning();
      await this.movimiento(tx, nuevo, {
        tipo: 'prorroga',
        fecha: d.fecha,
        saldo: g.outstandingAmount,
        vencimiento: d.nuevaFechaVencimiento,
        motivo: d.motivo ?? null,
      });
      await this.audit.registrar(tx, {
        entityType: 'bank_guarantee',
        entityId: id,
        action: 'update',
        oldData: { expiryDate: g.expiryDate },
        newData: {
          expiryDate: d.nuevaFechaVencimiento,
          movimiento: 'prorroga',
        },
      });
    });
    return this.detalle(id);
  }

  async comision(
    id: string,
    input: AvalComisionInput,
    version: number | undefined,
  ): Promise<AvalDetalleDto> {
    const d = avalComisionSchema.parse(input);
    await this.dbs.db.transaction(async (tx) => {
      const g = await this.bloquear(tx, id, version);
      const de = g.status as EstadoAval;
      if (g.direction !== 'emitido') {
        throw new UnprocessableEntityException({
          code: 'BANK_GUARANTEE_COMMISSION_NOT_APPLICABLE',
          message:
            'Los avales recibidos no devengan comisión a nuestro cargo (la paga el avalado)',
        });
      }
      if (de !== 'vigente' && de !== 'liberado_parcial') throw noVivo(de);
      this.exigirFecha(g, d.fecha);
      let importe: number;
      if (d.importe !== undefined && d.importe !== null) {
        importe = d.importe;
      } else if (g.commissionRatePct !== null) {
        importe = comisionAval({
          saldoVivo: g.outstandingAmount,
          tasaAnualPct: g.commissionRatePct,
          meses: d.meses ?? g.commissionPeriodMonths ?? 1,
        });
      } else {
        throw new UnprocessableEntityException({
          code: 'BANK_GUARANTEE_COMMISSION_NOT_APPLICABLE',
          message:
            'El aval no tiene tasa de comisión: indica el importe liquidado por el banco',
        });
      }
      if (toCents(importe) <= 0n) {
        throw new UnprocessableEntityException({
          code: 'BANK_GUARANTEE_AMOUNT_INVALID',
          message: 'La comisión calculada es cero',
        });
      }
      const movId = randomUUID();
      // La liquidación salda primero lo devengado pendiente (4100); solo el
      // exceso es gasto nuevo (6260): el coste de la obra no se duplica.
      const reparto = liquidacionComisionContraDevengo({
        importe,
        devengado: g.accruedCommission,
        liquidadoContraDevengo: g.accrualSettled,
      });
      const asientoId = await this.asiento(
        tx,
        g,
        d.fecha,
        `Comisión de aval ${g.reference} (${g.issuer})`,
        movId,
        reparto.contraDevengo > 0
          ? asientoLiquidacionComision(reparto)
          : asientoComisionAval(importe),
      );
      const total = toCents(g.commissionsAmount) + toCents(importe);
      const liquidado =
        toCents(g.accrualSettled) + toCents(reparto.contraDevengo);
      await tx
        .update(bankGuarantees)
        .set({
          commissionsAmount: centsToNumeric(total),
          accrualSettled: centsToNumeric(liquidado),
          version: g.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(bankGuarantees.id, id));
      await this.movimiento(tx, g, {
        id: movId,
        tipo: 'comision',
        fecha: d.fecha,
        importe: n(importe),
        saldo: g.outstandingAmount,
        asientoId,
        liquidadoContraDevengo: n(reparto.contraDevengo),
      });
      const antes = {
        commissionsAmount: g.commissionsAmount,
        accrualSettled: g.accrualSettled,
      };
      const despues = {
        commissionsAmount: centsToNumeric(total),
        accrualSettled: centsToNumeric(liquidado),
      };
      await this.audit.registrar(tx, {
        entityType: 'bank_guarantee',
        entityId: id,
        action: 'update',
        oldData: antes,
        newData: {
          ...despues,
          movimiento: 'comision',
          importe,
          contraDevengo: reparto.contraDevengo,
          asientoId,
          cambios: diferenciasAuditoria(antes, despues),
        },
      });
    });
    return this.detalle(id);
  }

  /** Solo un aval dado de alta por error y sin movimientos (salvo el alta). */
  async anular(
    id: string,
    input: AvalAnularInput,
    version: number | undefined,
  ): Promise<AvalDetalleDto> {
    const { motivo } = avalAnularSchema.parse(input);
    await this.dbs.db.transaction(async (tx) => {
      const g = await this.bloquear(tx, id, version);
      const [otros] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(bankGuaranteeMovements)
        .where(
          and(
            eq(bankGuaranteeMovements.guaranteeId, id),
            sql`${bankGuaranteeMovements.type} <> 'alta'`,
          ),
        );
      if (g.status !== 'vigente') throw noVivo(g.status);
      if (otros.n > 0) {
        throw new ConflictException({
          code: 'BANK_GUARANTEE_HAS_MOVEMENTS',
          message:
            'El aval tiene movimientos (comisiones, prórrogas…): libéralo en lugar de anularlo',
        });
      }
      await cambiarEstado(
        tx,
        bankGuarantees,
        'bank_guarantee',
        id,
        'vigente',
        'anulado',
        { reason: motivo },
        version,
      );
      await this.movimiento(tx, g, {
        tipo: 'anulacion',
        fecha: hoyIso() < g.issueDate ? g.issueDate : hoyIso(),
        saldo: g.outstandingAmount,
        motivo,
      });
      await this.audit.registrar(tx, {
        entityType: 'bank_guarantee',
        entityId: id,
        action: 'update',
        oldData: { status: 'vigente' },
        newData: { status: 'anulado', motivo },
      });
    });
    return this.detalle(id);
  }

  /* ─────────────────────────── avisos ─────────────────────────── */

  /**
   * Notifica en la bandeja los avales vivos que vencen en los próximos días
   * (o ya vencidos sin cerrar). Uno por aval y fecha de vencimiento: una
   * prórroga vuelve a avisar.
   */
  async avisosVencimiento(
    input: AvalesAvisosInput,
  ): Promise<ResultadoAvisosAvalesDto> {
    const d = avalesAvisosSchema.parse(input);
    const hoy = d.hoy ?? hoyIso();
    const companyId = this.dbs.getCompanyId();
    const avales = await this.listar({ venceEnDias: d.dias, hoy });
    const claves = avales.map(
      (a) => `aval:vence:${a.id}:${a.fechaVencimiento}`,
    );
    const ya =
      claves.length === 0
        ? []
        : await this.dbs.db
            .select({ clave: notifications.dedupeKey })
            .from(notifications)
            .where(
              and(
                eq(notifications.companyId, companyId),
                inArray(notifications.dedupeKey, claves),
              ),
            );
    const enviadas = new Set(ya.map((x) => x.clave));
    let avisados = 0;
    await this.dbs.db.transaction(async (tx) => {
      for (const a of avales) {
        const clave = `aval:vence:${a.id}:${a.fechaVencimiento}`;
        if (enviadas.has(clave)) continue;
        const dias = a.diasHastaVencimiento ?? 0;
        await this.notificaciones.notificar(tx, {
          companyId,
          tipo: 'aval',
          titulo:
            dias < 0
              ? `Aval ${a.referencia} vencido sin cerrar`
              : `Aval ${a.referencia} vence en ${dias} días`,
          cuerpo:
            `${a.entidad} · ${a.projectCodigo ?? 'sin obra'} · saldo vivo ` +
            `${a.saldoVivo.toFixed(2)} € · vence el ${a.fechaVencimiento}`,
          enlace: '/avales',
          clave,
        });
        avisados += 1;
      }
    });
    return { hoy, dias: d.dias, avisados, revisados: avales.length };
  }
}
