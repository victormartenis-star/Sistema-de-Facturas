import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import {
  bankAccounts,
  contacts,
  invoices,
  paymentMilestones,
  paymentSettlements,
  projects,
  thirdPartyAdvances,
  thirdPartyNettings,
  type DbOrTx,
  type ThirdPartyAdvance,
  type ThirdPartyNetting,
  type Tx,
} from '@erp/db';
import {
  CUENTAS_INTERFAZ,
  DIRECCION_CARTERA,
  ErrorCartera,
  anticipoAplicarSchema,
  anticipoCreateSchema,
  antiguedadSaldos,
  asientoAnticipo,
  centsToNumeric,
  compensacionCreateSchema,
  conciliarTerceros,
  diferenciasAuditoria,
  documentoCarteraAnularSchema,
  fromCents,
  imputarPartidas,
  partidasAbiertas,
  planCompensacion,
  sumCents,
  toCents,
  todayIso,
  type AnticipoAplicarInput,
  type AnticipoCreateInput,
  type AnticipoDto,
  type AnticiposQuery,
  type AntiguedadDto,
  type CarteraQuery,
  type CompensacionCreateInput,
  type CompensacionDto,
  type ConciliacionCarteraDto,
  type ConciliacionCarteraQuery,
  type DocumentoCarteraAnularInput,
  type Imputacion,
  type PartidaEntrada,
  type PartidasCarteraDto,
  type PartidaImputable,
  type TipoCartera,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { cambiarEstado } from '../common/cambiar-estado';
import { getRequestContext } from '../common/request-context';
import { verificarVersion } from '../common/version';
import {
  anticipoEnVigorA,
  liquidacionEnVigorA,
} from '../contabilidad/conciliacion-cierre.service';
import { ContabilidadService } from '../contabilidad/contabilidad.service';
import { DbService } from '../db/db.service';
import {
  anularLiquidacion,
  registrarLiquidacion,
  type Contexto,
} from '../treasury/liquidaciones';

/** Facturas que generan partidas (mismo criterio que la interfaz contable). */
const FACTURAS_CONTABLES = sql.raw(`('aprobada', 'pagada', 'rectificada')`);

const KIND_FACTURA: Record<TipoCartera, 'venta' | 'compra'> = {
  clientes: 'venta',
  proveedores: 'compra',
};

/** Traduce el rechazo de una regla pura de cartera a RFC 7807 (422). */
function regla<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ErrorCartera) {
      throw new UnprocessableEntityException({
        code: e.codigo,
        message: e.message,
      });
    }
    throw e;
  }
}

function anticipoNoEncontrado(): NotFoundException {
  return new NotFoundException({
    code: 'AR_AP_ADVANCE_NOT_FOUND',
    message: 'Anticipo no encontrado',
  });
}

function compensacionNoEncontrada(): NotFoundException {
  return new NotFoundException({
    code: 'AR_AP_NETTING_NOT_FOUND',
    message: 'Compensación no encontrada',
  });
}

/**
 * Cartera de clientes y proveedores (subledgers AR/AP, SAP FI-AR/FI-AP,
 * Oracle Receivables/Payables):
 *  - partidas abiertas por tercero y documento a una fecha de corte, y su
 *    antigüedad por tramos;
 *  - anticipos de clientes (438) y a proveedores (407), con su aplicación a
 *    vencimientos (liquidación no monetaria 4380 / 4070 a 430x / 400x);
 *  - compensación cobro ↔ pago de un mismo tercero (liquidaciones no
 *    monetarias contra 5550 en los dos lados, por el mismo importe);
 *  - conciliación auxiliar ↔ mayor por tercero (el tercero va en la línea).
 * Las liquidaciones no monetarias se contabilizan por la interfaz contable
 * como cualquier cobro o pago, y solo se anulan desde su documento.
 */
@Injectable()
export class CarteraService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly contabilidad: ContabilidadService,
  ) {}

  private fechaValida(fecha: string | undefined): string {
    const hoy = todayIso();
    const f = fecha ?? hoy;
    if (f > hoy) {
      throw new UnprocessableEntityException({
        code: 'AR_AP_DATE_INVALID',
        message: `La fecha (${f}) no puede ser futura`,
      });
    }
    return f;
  }

  private contexto(tx: Tx): Contexto {
    return {
      tx,
      audit: this.audit,
      companyId: this.dbs.getCompanyId(),
      userId: getRequestContext()?.userId ?? null,
    };
  }

  /* ───────────────────────── partidas y antigüedad ───────────────────────── */

  /** Vencimientos de la cartera con su liquidado vigente hasta la fecha. */
  private async vencimientos(
    ex: DbOrTx,
    tipo: TipoCartera,
    fecha: string,
    filtros: { contactId?: string; projectId?: string } = {},
  ): Promise<PartidaEntrada[]> {
    const companyId = this.dbs.getCompanyId();
    const accesibles = await this.dbs.getObrasAccesibles();
    const conObra = (ids: string[]) =>
      sql`exists (select 1 from invoice_lines il where il.invoice_id = i.id and il.project_id in (${sql.join(
        ids.map((x) => sql`${x}`),
        sql`, `,
      )}))`;
    const f: SQL[] = [];
    if (filtros.contactId) f.push(sql`and i.contact_id = ${filtros.contactId}`);
    if (filtros.projectId) f.push(sql`and ${conObra([filtros.projectId])}`);
    if (accesibles !== null) {
      if (accesibles.length === 0) return [];
      f.push(sql`and ${conObra(accesibles)}`);
    }
    const r = await ex.execute(sql`
      select pm.id, i.contact_id as "contactId", c.legal_name as "contactName",
        i.id as "invoiceId", i.invoice_number as "invoiceNumber", pm.kind,
        pm.due_date::text as vencimiento, pm.amount::text as importe,
        coalesce((select sum(ps.amount) from payment_settlements ps
          where ps.milestone_id = pm.id and ${liquidacionEnVigorA(fecha)}
            and ps.settled_on <= ${fecha}), 0)::text as liquidado
      from payment_milestones pm
      join invoices i on i.id = pm.invoice_id
      join contacts c on c.id = i.contact_id
      where pm.company_id = ${companyId}
        and pm.direction = ${DIRECCION_CARTERA[tipo]}
        and i.kind = ${KIND_FACTURA[tipo]}
        and i.status in ${FACTURAS_CONTABLES}
        and i.deleted_at is null and i.issue_date <= ${fecha}
        ${sql.join(f, sql` `)}`);
    return r.rows as unknown as PartidaEntrada[];
  }

  async partidas(q: CarteraQuery): Promise<PartidasCarteraDto> {
    const fecha = this.fechaValida(q.fecha);
    let partidas = partidasAbiertas(
      await this.vencimientos(this.dbs.db, q.tipo, fecha, q),
      fecha,
    );
    if (q.soloVencidas) partidas = partidas.filter((p) => p.diasVencido > 0);
    return {
      tipo: q.tipo,
      fecha,
      partidas,
      total: fromCents(sumCents(partidas.map((p) => toCents(p.pendiente)))),
    };
  }

  async antiguedad(q: CarteraQuery): Promise<AntiguedadDto> {
    const fecha = this.fechaValida(q.fecha);
    return antiguedadSaldos(
      q.tipo,
      fecha,
      partidasAbiertas(
        await this.vencimientos(this.dbs.db, q.tipo, fecha, q),
        fecha,
      ),
    );
  }

  /* ───────────────────────── conciliación por tercero ───────────────────────── */

  async conciliacion(
    q: ConciliacionCarteraQuery,
  ): Promise<ConciliacionCarteraDto> {
    const fecha = this.fechaValida(q.fecha);
    const companyId = this.dbs.getCompanyId();
    const clientes = q.tipo === 'clientes';
    const abiertas = partidasAbiertas(
      await this.vencimientos(this.dbs.db, q.tipo, fecha),
      fecha,
    );
    const aux = new Map<
      string,
      {
        contactId: string;
        contactName: string;
        ord: bigint;
        ret: bigint;
        ant: bigint;
      }
    >();
    const fila = (contactId: string, contactName: string) => {
      const f = aux.get(contactId) ?? {
        contactId,
        contactName,
        ord: 0n,
        ret: 0n,
        ant: 0n,
      };
      aux.set(contactId, f);
      return f;
    };
    for (const p of abiertas) {
      const f = fila(p.contactId, p.contactName);
      if (p.kind === 'retencion') f.ret += toCents(p.pendiente);
      else f.ord += toCents(p.pendiente);
    }
    const anticipos = await this.dbs.db.execute(sql`
      select a.contact_id as "contactId", c.legal_name as "contactName",
        (sum(a.amount) - coalesce(sum((select sum(ps.amount) from payment_settlements ps
          where ps.advance_id = a.id and ${liquidacionEnVigorA(fecha)}
            and ps.settled_on <= ${fecha})), 0))::text as pendiente
      from third_party_advances a
      join contacts c on c.id = a.contact_id
      where a.company_id = ${companyId} and ${anticipoEnVigorA(fecha)}
        and a.direction = ${DIRECCION_CARTERA[q.tipo]}
        and a.received_on <= ${fecha}
      group by a.contact_id, c.legal_name`);
    for (const a of anticipos.rows as {
      contactId: string;
      contactName: string;
      pendiente: string;
    }[]) {
      fila(a.contactId, a.contactName).ant += toCents(a.pendiente);
    }
    const [p1, p2] = clientes ? ['430', '438'] : ['400', '407'];
    const mayor = await this.dbs.db.execute(sql`
      select l.contact_id as "contactId", c.legal_name as "contactName",
        sum(${clientes ? sql`l.debit - l.credit` : sql`l.credit - l.debit`})::text as saldo
      from journal_entry_lines l
      join journal_entries je on je.id = l.entry_id
      join ledger_accounts la on la.id = l.account_id
      left join contacts c on c.id = l.contact_id
      where l.company_id = ${companyId} and je.entry_date <= ${fecha}
        and (la.code like ${`${p1}%`} or la.code like ${`${p2}%`})
      group by l.contact_id, c.legal_name`);
    const r = conciliarTerceros(
      [...aux.values()].map((f) => ({
        contactId: f.contactId,
        contactName: f.contactName,
        ordinario: centsToNumeric(f.ord),
        retencion: centsToNumeric(f.ret),
        anticipos: centsToNumeric(f.ant),
      })),
      (
        mayor.rows as {
          contactId: string | null;
          contactName: string | null;
          saldo: string;
        }[]
      ).map((m) => ({
        contactId: m.contactId,
        contactName: m.contactName ?? undefined,
        saldo: m.saldo,
      })),
    );
    return {
      tipo: q.tipo,
      fecha,
      cuentas: clientes ? '430x + 438x' : '400x + 407x',
      ...r,
    };
  }

  /* ───────────────────────────── anticipos ───────────────────────────── */

  private async contacto(ex: DbOrTx, id: string) {
    const [c] = await ex
      .select({ id: contacts.id, nombre: contacts.legalName })
      .from(contacts)
      .where(
        and(
          eq(contacts.id, id),
          eq(contacts.companyId, this.dbs.getCompanyId()),
        ),
      )
      .limit(1);
    if (!c) {
      throw new UnprocessableEntityException({
        code: 'CONTACT_NOT_FOUND',
        message: 'El tercero no existe',
      });
    }
    return c;
  }

  private async anticipoDto(
    ex: DbOrTx,
    a: ThirdPartyAdvance,
  ): Promise<AnticipoDto> {
    const [c] = await ex
      .select({ nombre: contacts.legalName })
      .from(contacts)
      .where(eq(contacts.id, a.contactId));
    const apl = await ex
      .select({
        s: paymentSettlements,
        invoiceNumber: invoices.invoiceNumber,
      })
      .from(paymentSettlements)
      .innerJoin(
        paymentMilestones,
        eq(paymentMilestones.id, paymentSettlements.milestoneId),
      )
      .innerJoin(invoices, eq(invoices.id, paymentMilestones.invoiceId))
      .where(eq(paymentSettlements.advanceId, a.id))
      .orderBy(
        asc(paymentSettlements.settledOn),
        asc(paymentSettlements.createdAt),
      );
    return {
      id: a.id,
      tipo: a.direction === 'cobro' ? 'clientes' : 'proveedores',
      contactId: a.contactId,
      contactName: c?.nombre ?? '',
      projectId: a.projectId,
      fecha: a.receivedOn,
      importe: fromCents(toCents(a.amount)),
      aplicado: fromCents(toCents(a.appliedAmount)),
      disponible: fromCents(toCents(a.amount) - toCents(a.appliedAmount)),
      estado: a.status as AnticipoDto['estado'],
      referencia: a.reference,
      asientoId: a.journalEntryId,
      contraAsientoId: a.reversalEntryId,
      motivoAnulacion: a.cancelReason,
      aplicaciones: apl.map(({ s, invoiceNumber }) => ({
        liquidacionId: s.id,
        vencimientoId: s.milestoneId,
        invoiceNumber,
        fecha: s.settledOn,
        importe: fromCents(toCents(s.amount)),
        estado: s.status as 'vigente' | 'anulada',
      })),
      version: a.version,
    };
  }

  async anticipos(q: AnticiposQuery): Promise<AnticipoDto[]> {
    const f: SQL[] = [
      eq(thirdPartyAdvances.companyId, this.dbs.getCompanyId()),
    ];
    if (q.tipo)
      f.push(eq(thirdPartyAdvances.direction, DIRECCION_CARTERA[q.tipo]));
    if (q.contactId) f.push(eq(thirdPartyAdvances.contactId, q.contactId));
    if (q.estado) f.push(eq(thirdPartyAdvances.status, q.estado));
    const filas = await this.dbs.db
      .select()
      .from(thirdPartyAdvances)
      .where(and(...f))
      .orderBy(
        desc(thirdPartyAdvances.receivedOn),
        desc(thirdPartyAdvances.createdAt),
      )
      .limit(200);
    const out: AnticipoDto[] = [];
    for (const a of filas) out.push(await this.anticipoDto(this.dbs.db, a));
    return out;
  }

  async anticipo(id: string): Promise<AnticipoDto> {
    const [a] = await this.dbs.db
      .select()
      .from(thirdPartyAdvances)
      .where(
        and(
          eq(thirdPartyAdvances.id, id),
          eq(thirdPartyAdvances.companyId, this.dbs.getCompanyId()),
        ),
      );
    if (!a) throw anticipoNoEncontrado();
    return this.anticipoDto(this.dbs.db, a);
  }

  /** Cobro de un anticipo de cliente (5720 a 4380) o pago a proveedor (4070 a 5720). */
  async crearAnticipo(input: AnticipoCreateInput): Promise<AnticipoDto> {
    const d = anticipoCreateSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    this.fechaValida(d.fecha);
    const direccion = DIRECCION_CARTERA[d.tipo];
    const a = await this.dbs.db.transaction(async (tx) => {
      const c = await this.contacto(tx, d.contactId);
      if (d.projectId) {
        const [p] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.id, d.projectId),
              eq(projects.companyId, companyId),
            ),
          );
        if (!p) {
          throw new UnprocessableEntityException({
            code: 'PROJECT_NOT_FOUND',
            message: 'La obra no existe',
          });
        }
      }
      if (d.bankAccountId) {
        const [b] = await tx
          .select({ id: bankAccounts.id })
          .from(bankAccounts)
          .where(
            and(
              eq(bankAccounts.id, d.bankAccountId),
              eq(bankAccounts.companyId, companyId),
              eq(bankAccounts.isActive, true),
            ),
          );
        if (!b) {
          throw new UnprocessableEntityException({
            code: 'ACCOUNT_NOT_FOUND',
            message: 'La cuenta bancaria no existe o está inactiva',
          });
        }
      }
      const importe = centsToNumeric(toCents(d.importe));
      const [fila] = await tx
        .insert(thirdPartyAdvances)
        .values({
          companyId,
          contactId: c.id,
          projectId: d.projectId ?? null,
          direction: direccion,
          amount: importe,
          receivedOn: d.fecha,
          bankAccountId: d.bankAccountId ?? null,
          reference: d.referencia ?? null,
          notes: d.notas ?? null,
          createdBy: getRequestContext()?.userId ?? null,
        })
        .returning();
      const asiento = await this.contabilidad.contabilizarEnTx(tx, {
        companyId,
        fecha: d.fecha,
        concepto: `Anticipo ${direccion === 'cobro' ? 'de cliente' : 'a proveedor'} · ${c.nombre}`,
        origen: 'anticipo',
        origenId: fila.id,
        contactId: c.id,
        lineas: asientoAnticipo({
          direccion,
          importe,
          contactName: c.nombre,
          referencia: d.referencia,
        }),
      });
      const [hecho] = await tx
        .update(thirdPartyAdvances)
        .set({ journalEntryId: asiento.id })
        .where(eq(thirdPartyAdvances.id, fila.id))
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'third_party_advance',
        entityId: hecho.id,
        action: 'create',
        newData: hecho,
      });
      return hecho;
    });
    return this.anticipo(a.id);
  }

  /** Bloquea el anticipo de la empresa y comprueba versión y estado. */
  private async bloquearAnticipo(
    tx: Tx,
    id: string,
    version: number | undefined,
  ) {
    const [a] = await tx
      .select()
      .from(thirdPartyAdvances)
      .where(
        and(
          eq(thirdPartyAdvances.id, id),
          eq(thirdPartyAdvances.companyId, this.dbs.getCompanyId()),
        ),
      )
      .for('update');
    if (!a) throw anticipoNoEncontrado();
    verificarVersion(a.version, version);
    if (a.status !== 'vigente') {
      throw new ConflictException({
        code: 'AR_AP_ALREADY_CANCELLED',
        message: 'El anticipo está anulado',
      });
    }
    return a;
  }

  /**
   * Partidas del tercero abiertas hoy (pendiente vivo > 0), para imputar.
   * El orden de bloqueo lo fija `registrarLiquidacion` (factura → vencimiento).
   */
  private async imputables(
    tx: Tx,
    tipo: TipoCartera,
    contactId: string,
  ): Promise<PartidaImputable[]> {
    const filas = await tx
      .select({
        id: paymentMilestones.id,
        vencimiento: paymentMilestones.dueDate,
        importe: paymentMilestones.amount,
        liquidado: paymentMilestones.settledAmount,
      })
      .from(paymentMilestones)
      .innerJoin(invoices, eq(invoices.id, paymentMilestones.invoiceId))
      .where(
        and(
          eq(paymentMilestones.companyId, this.dbs.getCompanyId()),
          eq(paymentMilestones.direction, DIRECCION_CARTERA[tipo]),
          eq(invoices.contactId, contactId),
          eq(invoices.kind, KIND_FACTURA[tipo]),
          sql`${invoices.status} in ${FACTURAS_CONTABLES}`,
          sql`${invoices.deletedAt} is null`,
        ),
      );
    return filas.map((f) => ({
      id: f.id,
      vencimiento: f.vencimiento,
      pendiente: centsToNumeric(toCents(f.importe) - toCents(f.liquidado)),
    }));
  }

  /** Registra las liquidaciones no monetarias en orden estable (sin interbloqueos). */
  private async liquidarNoMonetario(
    tx: Tx,
    imputaciones: Imputacion[],
    fecha: string,
    noMonetaria: NonNullable<
      Parameters<typeof registrarLiquidacion>[2]['noMonetaria']
    >,
  ): Promise<string[]> {
    const ctx = this.contexto(tx);
    const ids: string[] = [];
    for (const i of [...imputaciones].sort((a, b) =>
      a.vencimientoId.localeCompare(b.vencimientoId),
    )) {
      const s = await registrarLiquidacion(ctx, i.vencimientoId, {
        cantidad: i.importe,
        fecha,
        referencia:
          noMonetaria.origen === 'anticipo'
            ? 'Aplicación de anticipo'
            : 'Compensación',
        noMonetaria,
      });
      ids.push(s.id);
    }
    return ids;
  }

  /**
   * Aplica (todo o parte de) un anticipo a vencimientos del mismo tercero:
   * por antigüedad o con imputaciones explícitas, sin superar lo disponible
   * ni el pendiente de cada partida.
   */
  async aplicarAnticipo(
    id: string,
    input: AnticipoAplicarInput,
    version: number | undefined,
  ): Promise<AnticipoDto> {
    const d = anticipoAplicarSchema.parse(input);
    this.fechaValida(d.fecha);
    await this.dbs.db.transaction(async (tx) => {
      const a = await this.bloquearAnticipo(tx, id, version);
      if (d.fecha < a.receivedOn) {
        throw new UnprocessableEntityException({
          code: 'AR_AP_DATE_INVALID',
          message: `El anticipo se recibió el ${a.receivedOn}: no se aplica antes`,
        });
      }
      const tipo: TipoCartera =
        a.direction === 'cobro' ? 'clientes' : 'proveedores';
      const disponible = toCents(a.amount) - toCents(a.appliedAmount);
      if (disponible <= 0n) {
        throw new ConflictException({
          code: 'AR_AP_ADVANCE_APPLIED',
          message: 'El anticipo ya está aplicado por completo',
        });
      }
      if (d.importe !== undefined && toCents(d.importe) > disponible) {
        throw new UnprocessableEntityException({
          code: 'AR_AP_ALLOCATION_EXCEEDS_AVAILABLE',
          message: `Quedan ${centsToNumeric(disponible)} disponibles en el anticipo`,
        });
      }
      const partidas = await this.imputables(tx, tipo, a.contactId);
      const imputaciones = regla(() =>
        imputarPartidas({
          disponible: centsToNumeric(
            d.importe !== undefined ? toCents(d.importe) : disponible,
          ),
          partidas,
          explicitas: d.imputaciones,
        }),
      );
      await this.liquidarNoMonetario(tx, imputaciones, d.fecha, {
        origen: 'anticipo',
        contrapartida:
          tipo === 'clientes'
            ? CUENTAS_INTERFAZ.anticiposClientes
            : CUENTAS_INTERFAZ.anticiposProveedores,
        anticipoId: a.id,
      });
      const aplicado = sumCents(imputaciones.map((i) => toCents(i.importe)));
      const nuevo = centsToNumeric(toCents(a.appliedAmount) + aplicado);
      await tx
        .update(thirdPartyAdvances)
        .set({
          appliedAmount: nuevo,
          version: a.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(thirdPartyAdvances.id, a.id));
      await this.audit.registrar(tx, {
        entityType: 'third_party_advance',
        entityId: a.id,
        action: 'update',
        oldData: { appliedAmount: a.appliedAmount },
        newData: {
          ...diferenciasAuditoria(
            { appliedAmount: a.appliedAmount },
            { appliedAmount: nuevo },
          ),
          accion: 'aplicar',
          imputaciones,
        },
      });
    });
    return this.anticipo(id);
  }

  /** Anula las aplicaciones vigentes del anticipo (lo deja disponible). */
  async desaplicarAnticipo(
    id: string,
    input: DocumentoCarteraAnularInput,
    version: number | undefined,
  ): Promise<AnticipoDto> {
    const { motivo } = documentoCarteraAnularSchema.parse(input);
    await this.dbs.db.transaction(async (tx) => {
      const a = await this.bloquearAnticipo(tx, id, version);
      const n = await this.anularLiquidacionesDe(
        tx,
        { anticipoId: a.id },
        motivo,
      );
      if (n === 0) {
        throw new ConflictException({
          code: 'AR_AP_ITEM_NOT_OPEN',
          message: 'El anticipo no tiene aplicaciones vigentes',
        });
      }
      await tx
        .update(thirdPartyAdvances)
        .set({
          appliedAmount: '0',
          version: a.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(thirdPartyAdvances.id, a.id));
      await this.audit.registrar(tx, {
        entityType: 'third_party_advance',
        entityId: a.id,
        action: 'update',
        oldData: { appliedAmount: a.appliedAmount },
        newData: { appliedAmount: '0.00', accion: 'desaplicar', motivo },
      });
    });
    return this.anticipo(id);
  }

  /** Anula un anticipo sin aplicaciones vigentes, con su contra-asiento. */
  async anularAnticipo(
    id: string,
    input: DocumentoCarteraAnularInput,
    version: number | undefined,
  ): Promise<AnticipoDto> {
    const { motivo } = documentoCarteraAnularSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    await this.dbs.db.transaction(async (tx) => {
      const a = await this.bloquearAnticipo(tx, id, version);
      if (toCents(a.appliedAmount) !== 0n) {
        throw new ConflictException({
          code: 'AR_AP_ADVANCE_APPLIED',
          message: `El anticipo tiene ${centsToNumeric(toCents(a.appliedAmount))} aplicados: desaplícalo antes de anularlo`,
        });
      }
      let contraId: string | null = null;
      if (a.journalEntryId) {
        // A la fecha de la anulación (como las liquidaciones que lo aplicaron),
        // para que el mayor de 438x/407x cuadre a cualquier fecha de corte.
        const contra = await this.contabilidad.anularEnTx(
          tx,
          companyId,
          a.journalEntryId,
          `Anulación de anticipo: ${motivo}`,
          todayIso() < a.receivedOn ? a.receivedOn : todayIso(),
        );
        contraId = contra.id;
      }
      await cambiarEstado(
        tx,
        thirdPartyAdvances,
        'third_party_advance',
        a.id,
        'vigente',
        'anulado',
        { cancelReason: motivo, reversalEntryId: contraId },
        a.version,
      );
      await this.audit.registrar(tx, {
        entityType: 'third_party_advance',
        entityId: a.id,
        action: 'update',
        oldData: { status: 'vigente' },
        newData: { status: 'anulado', motivo, contraAsientoId: contraId },
      });
    });
    return this.anticipo(id);
  }

  private async anularLiquidacionesDe(
    tx: Tx,
    doc: { anticipoId?: string; compensacionId?: string },
    motivo: string,
  ): Promise<number> {
    const vigentes = await tx
      .select({ id: paymentSettlements.id })
      .from(paymentSettlements)
      .where(
        and(
          eq(paymentSettlements.companyId, this.dbs.getCompanyId()),
          eq(paymentSettlements.status, 'vigente'),
          doc.anticipoId
            ? eq(paymentSettlements.advanceId, doc.anticipoId)
            : eq(paymentSettlements.nettingId, doc.compensacionId!),
        ),
      )
      .orderBy(asc(paymentSettlements.milestoneId));
    const ctx = this.contexto(tx);
    for (const { id } of vigentes) {
      await anularLiquidacion(ctx, id, motivo, undefined, true);
    }
    return vigentes.length;
  }

  /* ─────────────────────────── compensaciones ─────────────────────────── */

  private async compensacionDto(
    ex: DbOrTx,
    n: ThirdPartyNetting,
  ): Promise<CompensacionDto> {
    const [c] = await ex
      .select({ nombre: contacts.legalName })
      .from(contacts)
      .where(eq(contacts.id, n.contactId));
    const lineas = await ex
      .select({
        s: paymentSettlements,
        direccion: paymentMilestones.direction,
        invoiceNumber: invoices.invoiceNumber,
      })
      .from(paymentSettlements)
      .innerJoin(
        paymentMilestones,
        eq(paymentMilestones.id, paymentSettlements.milestoneId),
      )
      .innerJoin(invoices, eq(invoices.id, paymentMilestones.invoiceId))
      .where(eq(paymentSettlements.nettingId, n.id))
      .orderBy(
        asc(paymentMilestones.direction),
        asc(paymentSettlements.createdAt),
      );
    return {
      id: n.id,
      contactId: n.contactId,
      contactName: c?.nombre ?? '',
      fecha: n.nettingDate,
      importe: fromCents(toCents(n.amount)),
      estado: n.status as CompensacionDto['estado'],
      notas: n.notes,
      motivoAnulacion: n.cancelReason,
      lineas: lineas.map(({ s, direccion, invoiceNumber }) => ({
        liquidacionId: s.id,
        vencimientoId: s.milestoneId,
        direccion,
        invoiceNumber,
        importe: fromCents(toCents(s.amount)),
        estado: s.status as 'vigente' | 'anulada',
      })),
      version: n.version,
    };
  }

  async compensaciones(contactId?: string): Promise<CompensacionDto[]> {
    const f: SQL[] = [
      eq(thirdPartyNettings.companyId, this.dbs.getCompanyId()),
    ];
    if (contactId) f.push(eq(thirdPartyNettings.contactId, contactId));
    const filas = await this.dbs.db
      .select()
      .from(thirdPartyNettings)
      .where(and(...f))
      .orderBy(
        desc(thirdPartyNettings.nettingDate),
        desc(thirdPartyNettings.createdAt),
      )
      .limit(200);
    const out: CompensacionDto[] = [];
    for (const n of filas) out.push(await this.compensacionDto(this.dbs.db, n));
    return out;
  }

  async compensacion(id: string): Promise<CompensacionDto> {
    const [n] = await this.dbs.db
      .select()
      .from(thirdPartyNettings)
      .where(
        and(
          eq(thirdPartyNettings.id, id),
          eq(thirdPartyNettings.companyId, this.dbs.getCompanyId()),
        ),
      );
    if (!n) throw compensacionNoEncontrada();
    return this.compensacionDto(this.dbs.db, n);
  }

  /**
   * Compensa lo que se debe a un tercero con lo que nos debe (cliente y
   * proveedor a la vez): 5550 a 430x por los cobros y 400x a 5550 por los
   * pagos, por el mismo importe (5550 queda a cero).
   */
  async crearCompensacion(
    input: CompensacionCreateInput,
  ): Promise<CompensacionDto> {
    const d = compensacionCreateSchema.parse(input);
    this.fechaValida(d.fecha);
    const companyId = this.dbs.getCompanyId();
    const nettingId = await this.dbs.db.transaction(async (tx) => {
      const c = await this.contacto(tx, d.contactId);
      // Serializa compensaciones del mismo tercero.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`compensacion:${companyId}:${c.id}`}))`,
      );
      const cobros = await this.imputables(tx, 'clientes', c.id);
      const pagos = await this.imputables(tx, 'proveedores', c.id);
      const plan = regla(() =>
        planCompensacion({
          importe: d.importe ?? null,
          cobros,
          pagos,
          explicitasCobros: d.cobros,
          explicitasPagos: d.pagos,
        }),
      );
      const [n] = await tx
        .insert(thirdPartyNettings)
        .values({
          companyId,
          contactId: c.id,
          nettingDate: d.fecha,
          amount: centsToNumeric(toCents(plan.importe)),
          notes: d.notas ?? null,
          createdBy: getRequestContext()?.userId ?? null,
        })
        .returning();
      const noMonetaria = {
        origen: 'compensacion' as const,
        contrapartida: CUENTAS_INTERFAZ.partidasPendientes,
        compensacionId: n.id,
      };
      await this.liquidarNoMonetario(
        tx,
        [...plan.cobros, ...plan.pagos],
        d.fecha,
        noMonetaria,
      );
      await this.audit.registrar(tx, {
        entityType: 'third_party_netting',
        entityId: n.id,
        action: 'create',
        newData: { ...n, cobros: plan.cobros, pagos: plan.pagos },
      });
      return n.id;
    });
    return this.compensacion(nettingId);
  }

  /** Anula una compensación: anula sus liquidaciones de los dos lados. */
  async anularCompensacion(
    id: string,
    input: DocumentoCarteraAnularInput,
    version: number | undefined,
  ): Promise<CompensacionDto> {
    const { motivo } = documentoCarteraAnularSchema.parse(input);
    await this.dbs.db.transaction(async (tx) => {
      const [n] = await tx
        .select()
        .from(thirdPartyNettings)
        .where(
          and(
            eq(thirdPartyNettings.id, id),
            eq(thirdPartyNettings.companyId, this.dbs.getCompanyId()),
          ),
        )
        .for('update');
      if (!n) throw compensacionNoEncontrada();
      verificarVersion(n.version, version);
      if (n.status !== 'vigente') {
        throw new ConflictException({
          code: 'AR_AP_ALREADY_CANCELLED',
          message: 'La compensación ya está anulada',
        });
      }
      await this.anularLiquidacionesDe(tx, { compensacionId: n.id }, motivo);
      await cambiarEstado(
        tx,
        thirdPartyNettings,
        'third_party_netting',
        n.id,
        'vigente',
        'anulado',
        { cancelReason: motivo },
        n.version,
      );
      await this.audit.registrar(tx, {
        entityType: 'third_party_netting',
        entityId: n.id,
        action: 'update',
        oldData: { status: 'vigente' },
        newData: { status: 'anulado', motivo },
      });
    });
    return this.compensacion(id);
  }
}
