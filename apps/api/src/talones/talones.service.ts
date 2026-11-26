import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, desc, eq, ne, type SQL } from 'drizzle-orm';
import {
  bankAccounts,
  checkbooks,
  checks,
  contacts,
  invoices,
  paymentMilestones,
  paymentSettlements,
  type Check,
  type Checkbook,
  type DbOrTx,
  type Tx,
} from '@erp/db';
import {
  CUENTA_TALONES_TRANSITO,
  CUENTAS_INTERFAZ,
  ErrorTalon,
  centsToNumeric,
  diferenciasAuditoria,
  efectosTransicionTalon,
  fromCents,
  importeTalon,
  numeroTalon,
  siguienteTalon,
  talonAccionSchema,
  talonCreateSchema,
  talonarioCreateSchema,
  todayIso,
  toCents,
  validarFechaTalon,
  validarTalonario,
  type EstadoTalon,
  type EstadoTalonario,
  type TalonAccionInput,
  type TalonCreateInput,
  type TalonDto,
  type TalonarioCreateInput,
  type TalonarioDto,
  type TalonesQuery,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { cambiarEstado } from '../common/cambiar-estado';
import {
  getRequestContext,
  usuarioPersistible,
} from '../common/request-context';
import { verificarVersion } from '../common/version';
import { ContabilidadService } from '../contabilidad/contabilidad.service';
import { DbService } from '../db/db.service';
import {
  anularLiquidacion,
  registrarLiquidacion,
  type Contexto,
} from '../treasury/liquidaciones';

/** Rechazo de una regla pura de talones → RFC 7807. */
function regla<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ErrorTalon) {
      const cuerpo = { code: e.codigo, message: e.message };
      if (
        e.codigo === 'CHECK_INVALID_TRANSITION' ||
        e.codigo === 'CHECK_BOOK_EXHAUSTED' ||
        e.codigo === 'CHECK_BOOK_INACTIVE'
      ) {
        throw new ConflictException(cuerpo);
      }
      throw new UnprocessableEntityException(cuerpo);
    }
    throw e;
  }
}

const DESTINO: Record<TalonAccionInput['accion'], EstadoTalon> = {
  entregar: 'entregado',
  cobrar: 'cobrado',
  anular: 'anulado',
  detener: 'detenido',
  devolver: 'devuelto',
};

/**
 * Talones y cheques bancarios (SAP Check Management / Oracle Payments):
 * talonarios por cuenta, emisión de talones a proveedores y subcontratas y
 * registro de cheques recibidos de clientes, contra vencimientos de
 * tesorería. Contabilidad sin duplicidades:
 *  - al emitir o recibir: la liquidación del vencimiento con contrapartida
 *    5729 (talones en tránsito), contabilizada al momento (período cerrado →
 *    FISCAL_PERIOD_CLOSED);
 *  - al compensarse: 5729 ↔ 5720;
 *  - al anular, detener o devolver: se anula la liquidación (la deuda vuelve
 *    a quedar viva) y, si estaba compensado, también la compensación, todo a
 *    la fecha de la operación.
 * Solo admin, gerente y administración.
 */
@Injectable()
export class TalonesService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly contabilidad: ContabilidadService,
  ) {}

  private contexto(tx: Tx): Contexto {
    return {
      tx,
      audit: this.audit,
      companyId: this.dbs.getCompanyId(),
      userId: getRequestContext()?.userId ?? null,
    };
  }

  private async cuenta(ex: DbOrTx, id: string) {
    const [c] = await ex
      .select()
      .from(bankAccounts)
      .where(
        and(
          eq(bankAccounts.id, id),
          eq(bankAccounts.companyId, this.dbs.getCompanyId()),
          eq(bankAccounts.isActive, true),
        ),
      );
    if (!c) {
      throw new UnprocessableEntityException({
        code: 'ACCOUNT_NOT_FOUND',
        message: 'La cuenta bancaria no existe o está inactiva',
      });
    }
    return c;
  }

  /* ─────────────────────────── talonarios ─────────────────────────── */

  private talonarioDto(t: Checkbook, cuenta: string): TalonarioDto {
    return {
      id: t.id,
      bankAccountId: t.bankAccountId,
      bankAccountName: cuenta,
      prefijo: t.prefix,
      primero: t.firstNumber,
      ultimo: t.lastNumber,
      siguiente: t.nextNumber,
      disponibles: t.status === 'activo' ? t.lastNumber - t.nextNumber + 1 : 0,
      estado: t.status as EstadoTalonario,
      version: t.version,
    };
  }

  async talonarios(): Promise<TalonarioDto[]> {
    const filas = await this.dbs.db
      .select({ t: checkbooks, cuenta: bankAccounts.name })
      .from(checkbooks)
      .innerJoin(bankAccounts, eq(bankAccounts.id, checkbooks.bankAccountId))
      .where(eq(checkbooks.companyId, this.dbs.getCompanyId()))
      .orderBy(asc(bankAccounts.name), asc(checkbooks.firstNumber));
    return filas.map(({ t, cuenta }) => this.talonarioDto(t, cuenta));
  }

  async crearTalonario(input: TalonarioCreateInput): Promise<TalonarioDto> {
    const d = talonarioCreateSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    const t = await this.dbs.db.transaction(async (tx) => {
      const cuenta = await this.cuenta(tx, d.bankAccountId);
      // Rangos de la cuenta bajo bloqueo de la propia cuenta (sin altas cruzadas).
      await tx
        .select({ id: bankAccounts.id })
        .from(bankAccounts)
        .where(eq(bankAccounts.id, cuenta.id))
        .for('update');
      const existentes = await tx
        .select({
          primero: checkbooks.firstNumber,
          ultimo: checkbooks.lastNumber,
        })
        .from(checkbooks)
        .where(
          and(
            eq(checkbooks.bankAccountId, cuenta.id),
            ne(checkbooks.status, 'anulado'),
          ),
        );
      regla(() =>
        validarTalonario({ primero: d.primero, ultimo: d.ultimo }, existentes),
      );
      const [fila] = await tx
        .insert(checkbooks)
        .values({
          companyId,
          bankAccountId: cuenta.id,
          prefix: d.prefijo.toUpperCase(),
          firstNumber: d.primero,
          lastNumber: d.ultimo,
          nextNumber: d.primero,
          createdBy: usuarioPersistible(),
        })
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'checkbook',
        entityId: fila.id,
        action: 'create',
        newData: fila,
      });
      return { fila, cuenta: cuenta.name };
    });
    return this.talonarioDto(t.fila, t.cuenta);
  }

  async anularTalonario(
    id: string,
    version: number | undefined,
  ): Promise<TalonarioDto> {
    const r = await this.dbs.db.transaction(async (tx) => {
      const [t] = await tx
        .select()
        .from(checkbooks)
        .where(
          and(
            eq(checkbooks.id, id),
            eq(checkbooks.companyId, this.dbs.getCompanyId()),
          ),
        )
        .for('update');
      if (!t)
        throw new NotFoundException({
          code: 'CHECK_BOOK_NOT_FOUND',
          message: 'Talonario no encontrado',
        });
      verificarVersion(t.version, version);
      const nuevo = await cambiarEstado(
        tx,
        checkbooks,
        'checkbook',
        id,
        t.status as EstadoTalonario,
        'anulado',
        {},
        t.version,
      );
      await this.audit.registrar(tx, {
        entityType: 'checkbook',
        entityId: id,
        action: 'update',
        oldData: { status: t.status },
        newData: { status: 'anulado' },
      });
      const cuenta = await this.cuenta(tx, t.bankAccountId);
      return { fila: nuevo, cuenta: cuenta.name };
    });
    return this.talonarioDto(r.fila, r.cuenta);
  }

  /* ───────────────────────────── talones ───────────────────────────── */

  private async talonDto(ex: DbOrTx, c: Check): Promise<TalonDto> {
    const [extra] = await ex
      .select({ nombre: contacts.legalName, factura: invoices.invoiceNumber })
      .from(paymentMilestones)
      .innerJoin(invoices, eq(invoices.id, paymentMilestones.invoiceId))
      .innerJoin(contacts, eq(contacts.id, invoices.contactId))
      .where(eq(paymentMilestones.id, c.milestoneId));
    const [liq] = await ex
      .select({ id: paymentSettlements.id })
      .from(paymentSettlements)
      .where(eq(paymentSettlements.checkId, c.id))
      .orderBy(desc(paymentSettlements.createdAt))
      .limit(1);
    return {
      id: c.id,
      direccion: c.direction as TalonDto['direccion'],
      numero: c.number,
      talonarioId: c.checkbookId,
      bankAccountId: c.bankAccountId,
      contactId: c.contactId,
      contactName: extra?.nombre ?? '',
      vencimientoId: c.milestoneId,
      invoiceNumber: extra?.factura ?? '',
      importe: fromCents(toCents(c.amount)),
      fechaEmision: c.issueDate,
      fechaVencimiento: c.dueDate,
      fechaEntrega: c.deliveredOn,
      fechaCobro: c.clearedOn,
      fechaBaja: c.voidedOn,
      estado: c.status as EstadoTalon,
      motivo: c.reason,
      concepto: c.memo,
      liquidacionId: liq?.id ?? null,
      asientoCompensacionId: c.clearingEntryId,
      version: c.version,
    };
  }

  async talones(q: TalonesQuery): Promise<TalonDto[]> {
    const f: SQL[] = [eq(checks.companyId, this.dbs.getCompanyId())];
    if (q.direccion) f.push(eq(checks.direction, q.direccion));
    if (q.estado) f.push(eq(checks.status, q.estado));
    if (q.bankAccountId) f.push(eq(checks.bankAccountId, q.bankAccountId));
    if (q.contactId) f.push(eq(checks.contactId, q.contactId));
    const filas = await this.dbs.db
      .select()
      .from(checks)
      .where(and(...f))
      .orderBy(desc(checks.issueDate), desc(checks.createdAt))
      .limit(300);
    const out: TalonDto[] = [];
    for (const c of filas) out.push(await this.talonDto(this.dbs.db, c));
    return out;
  }

  async talon(id: string): Promise<TalonDto> {
    const [c] = await this.dbs.db
      .select()
      .from(checks)
      .where(
        and(eq(checks.id, id), eq(checks.companyId, this.dbs.getCompanyId())),
      );
    if (!c)
      throw new NotFoundException({
        code: 'CHECK_NOT_FOUND',
        message: 'Talón no encontrado',
      });
    return this.talonDto(this.dbs.db, c);
  }

  /**
   * Emite un talón (pago a proveedor o subcontrata, del talonario) o registra
   * un cheque recibido de un cliente, contra un vencimiento del mismo
   * tercero: liquida el vencimiento y lo contabiliza contra 5729.
   */
  async emitir(input: TalonCreateInput): Promise<TalonDto> {
    const d = talonCreateSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    regla(() =>
      validarFechaTalon({
        hoy: todayIso(),
        emision: d.fechaEmision,
        fecha: d.fechaEmision,
        operacion: 'emitir',
      }),
    );
    const importe = regla(() => importeTalon(d.importe));
    const id = await this.dbs.db.transaction(async (tx) => {
      const [v] = await tx
        .select({ m: paymentMilestones, contactId: invoices.contactId })
        .from(paymentMilestones)
        .innerJoin(invoices, eq(invoices.id, paymentMilestones.invoiceId))
        .where(
          and(
            eq(paymentMilestones.id, d.vencimientoId),
            eq(paymentMilestones.companyId, companyId),
          ),
        );
      if (!v)
        throw new NotFoundException({
          code: 'DUE_NOT_FOUND',
          message: 'Vencimiento no encontrado',
        });
      const esperado = d.direccion === 'emitido' ? 'pago' : 'cobro';
      if (v.m.direction !== esperado) {
        throw new UnprocessableEntityException({
          code: 'CHECK_DIRECTION_MISMATCH',
          message:
            d.direccion === 'emitido'
              ? 'Un talón emitido paga un vencimiento de pago'
              : 'Un cheque recibido cobra un vencimiento de cobro',
        });
      }
      let numero: string;
      let bankAccountId: string;
      let checkbookId: string | null = null;
      let secuencia: number | null = null;
      if (d.direccion === 'emitido') {
        const [t] = await tx
          .select()
          .from(checkbooks)
          .where(
            and(
              eq(checkbooks.id, d.talonarioId!),
              eq(checkbooks.companyId, companyId),
            ),
          )
          .for('update');
        if (!t)
          throw new NotFoundException({
            code: 'CHECK_BOOK_NOT_FOUND',
            message: 'Talonario no encontrado',
          });
        const s = regla(() =>
          siguienteTalon({
            estado: t.status as EstadoTalonario,
            siguiente: t.nextNumber,
            ultimo: t.lastNumber,
          }),
        );
        secuencia = s.secuencia;
        numero = numeroTalon(t.prefix, s.secuencia);
        bankAccountId = t.bankAccountId;
        checkbookId = t.id;
        if (s.agotadoTras) {
          await cambiarEstado(
            tx,
            checkbooks,
            'checkbook',
            t.id,
            'activo',
            'agotado',
            { nextNumber: t.nextNumber + 1 },
            t.version,
          );
        } else {
          await tx
            .update(checkbooks)
            .set({
              nextNumber: t.nextNumber + 1,
              version: t.version + 1,
              updatedAt: new Date(),
            })
            .where(eq(checkbooks.id, t.id));
        }
      } else {
        bankAccountId = (await this.cuenta(tx, d.bankAccountId!)).id;
        numero = d.numero!;
      }
      let talon: Check;
      try {
        [talon] = await tx
          .insert(checks)
          .values({
            companyId,
            direction: d.direccion,
            checkbookId,
            sequence: secuencia,
            number: numero,
            bankAccountId,
            contactId: v.contactId,
            milestoneId: v.m.id,
            amount: centsToNumeric(importe),
            issueDate: d.fechaEmision,
            dueDate: d.fechaVencimiento ?? null,
            memo: d.concepto ?? null,
            createdBy: usuarioPersistible(),
          })
          .returning();
      } catch (e) {
        if ((e as { code?: string }).code === '23505') {
          throw new ConflictException({
            code: 'CHECK_NUMBER_DUPLICATE',
            message: `El talón ${numero} ya está registrado en esta cuenta`,
          });
        }
        throw e;
      }
      const liq = await registrarLiquidacion(this.contexto(tx), v.m.id, {
        cantidad: d.importe,
        fecha: d.fechaEmision,
        bankAccountId,
        paymentInstrument: 'talon',
        referencia: `Talón ${numero}`,
        talonId: talon.id,
      });
      // Contabilizado al momento: respeta el período cerrado de la emisión.
      await this.contabilidad.contabilizarLiquidacionEnTx(
        tx,
        companyId,
        liq.id,
      );
      await this.audit.registrar(tx, {
        entityType: 'check',
        entityId: talon.id,
        action: 'create',
        newData: { ...talon, liquidacionId: liq.id },
      });
      return talon.id;
    });
    return this.talon(id);
  }

  /**
   * Entregar, cobrar (compensar), anular, detener o devolver un talón. No se
   * anula dos veces ni se compensa lo anulado (máquina de estados); cada
   * efecto contable va a la fecha de la operación.
   */
  async accion(
    id: string,
    input: TalonAccionInput,
    version: number | undefined,
  ): Promise<TalonDto> {
    const d = talonAccionSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    await this.dbs.db.transaction(async (tx) => {
      const [c] = await tx
        .select()
        .from(checks)
        .where(and(eq(checks.id, id), eq(checks.companyId, companyId)))
        .for('update');
      if (!c)
        throw new NotFoundException({
          code: 'CHECK_NOT_FOUND',
          message: 'Talón no encontrado',
        });
      verificarVersion(c.version, version);
      const de = c.status as EstadoTalon;
      const a = DESTINO[d.accion];
      const efectos = regla(() => efectosTransicionTalon(de, a));
      regla(() =>
        validarFechaTalon({
          hoy: todayIso(),
          emision: c.issueDate,
          vencimiento: c.dueDate,
          fecha: d.fecha,
          operacion:
            d.accion === 'entregar'
              ? 'entregar'
              : d.accion === 'cobrar'
                ? 'cobrar'
                : 'anular',
        }),
      );
      if (efectos.anularLiquidacion && !d.motivo) {
        throw new UnprocessableEntityException({
          code: 'CHECK_REASON_REQUIRED',
          message: 'Indica el motivo',
        });
      }
      const extra: Record<string, unknown> = {};
      const concepto = `Talón ${c.number}`;
      if (efectos.compensar) {
        const imp = centsToNumeric(toCents(c.amount));
        const emitido = c.direction === 'emitido';
        const lineas = [
          {
            cuenta: emitido ? CUENTA_TALONES_TRANSITO : CUENTAS_INTERFAZ.bancos,
            debe: imp,
            haber: '0.00',
            projectId: null,
            concepto,
          },
          {
            cuenta: emitido ? CUENTAS_INTERFAZ.bancos : CUENTA_TALONES_TRANSITO,
            debe: '0.00',
            haber: imp,
            projectId: null,
            concepto,
          },
        ];
        const asiento = await this.contabilidad.contabilizarEnTx(tx, {
          companyId,
          fecha: d.fecha,
          concepto: `Compensación del talón ${c.number}`,
          origen: 'talon',
          origenId: c.id,
          lineas,
        });
        extra.clearingEntryId = asiento.id;
        extra.clearedOn = d.fecha;
      }
      if (efectos.revertirCompensacion && c.clearingEntryId) {
        await this.contabilidad.anularEnTx(
          tx,
          companyId,
          c.clearingEntryId,
          `Talón ${c.number} devuelto: ${d.motivo}`,
          d.fecha,
        );
      }
      if (efectos.anularLiquidacion) {
        const vigentes = await tx
          .select({ id: paymentSettlements.id })
          .from(paymentSettlements)
          .where(
            and(
              eq(paymentSettlements.checkId, c.id),
              eq(paymentSettlements.status, 'vigente'),
            ),
          );
        for (const l of vigentes) {
          await anularLiquidacion(
            this.contexto(tx),
            l.id,
            `Talón ${c.number} ${a}: ${d.motivo}`,
            undefined,
            true,
          );
          await this.contabilidad.anularDeOrigenEnTx(
            tx,
            companyId,
            ['cobro', 'pago'],
            l.id,
            `Talón ${c.number} ${a}: ${d.motivo}`,
            d.fecha,
          );
        }
        extra.voidedOn = d.fecha;
        extra.reason = d.motivo;
      }
      if (a === 'entregado') extra.deliveredOn = d.fecha;
      await cambiarEstado(tx, checks, 'check', c.id, de, a, extra, c.version);
      await this.audit.registrar(tx, {
        entityType: 'check',
        entityId: c.id,
        action: 'update',
        oldData: { status: de },
        newData: diferenciasAuditoria(
          { status: de, clearedOn: c.clearedOn, voidedOn: c.voidedOn },
          {
            status: a,
            clearedOn: (extra.clearedOn as string) ?? c.clearedOn,
            voidedOn: (extra.voidedOn as string) ?? c.voidedOn,
          },
        ),
        meta: { accion: d.accion, fecha: d.fecha, motivo: d.motivo ?? null },
      });
    });
    return this.talon(id);
  }
}
