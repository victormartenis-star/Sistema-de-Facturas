import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  like,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  bankAccounts,
  bankTransactions,
  companies,
  contacts,
  invoices,
  paymentMilestones,
  sepaRemittanceItems,
  sepaRemittances,
  type DbOrTx,
  type SepaRemittance,
  type Tx,
} from '@erp/db';
import {
  DIRECCION_REMESA,
  centsToNumeric,
  diferenciasAuditoria,
  fromCents,
  generarSepaXml,
  identificadorAcreedorSepa,
  normalizarIban,
  referenciaPartida,
  remesaCreateSchema,
  secuenciaAdeudo,
  todayIso,
  toCents,
  type EstadoPartidaRemesa,
  type EstadoRemesa,
  type PartidaRemesaDto,
  type RemesaCreateInput,
  type RemesaDto,
  type RemesasQuery,
  type SecuenciaAdeudo,
  type TipoRemesa,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { cambiarEstado, cambiarEstadoMasivo } from '../common/cambiar-estado';
import { getRequestContext } from '../common/request-context';
import { verificarVersion } from '../common/version';
import { ContabilidadService } from '../contabilidad/contabilidad.service';
import { DbService } from '../db/db.service';
import { GrcService } from '../grc/grc.service';
import {
  anularLiquidacion,
  registrarLiquidacion,
  type Contexto,
} from '../treasury/liquidaciones';
import { errorBanca, reglaBanca } from './comun';

/**
 * Remesas SEPA (SAP Payment Medium Workbench / Oracle Payments):
 * transferencias a proveedores y subcontratas (pain.001) y adeudos directos
 * CORE a clientes con mandato (pain.008), desde vencimientos vivos de una
 * cuenta bancaria.
 *  - borrador: partidas por el saldo vivo de cada vencimiento (un vencimiento
 *    no va en dos remesas vivas);
 *  - generada: XML determinista guardado con su SHA-256 (se descarga idéntico);
 *  - remitida: liquida cada vencimiento (medio transferencia o domiciliación,
 *    contabilizado al momento: respeta el período cerrado);
 *  - devolución de una partida (R-transaction): anula su liquidación y su
 *    asiento a la fecha de la devolución; con todas devueltas, la remesa pasa
 *    a devuelta. Una remitida no se anula: se devuelven sus partidas.
 */
@Injectable()
export class RemesasService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly contabilidad: ContabilidadService,
    private readonly grc: GrcService,
  ) {}

  private contexto(tx: Tx): Contexto {
    return {
      tx,
      audit: this.audit,
      companyId: this.dbs.getCompanyId(),
      userId: getRequestContext()?.userId ?? null,
    };
  }

  private async bloquear(tx: Tx, id: string): Promise<SepaRemittance> {
    const [r] = await tx
      .select()
      .from(sepaRemittances)
      .where(
        and(
          eq(sepaRemittances.id, id),
          eq(sepaRemittances.companyId, this.dbs.getCompanyId()),
        ),
      )
      .for('update');
    if (!r)
      throw errorBanca('SEPA_REMITTANCE_NOT_FOUND', 'Remesa no encontrada');
    return r;
  }

  private async dto(ex: DbOrTx, r: SepaRemittance): Promise<RemesaDto> {
    const [cuenta] = await ex
      .select({ name: bankAccounts.name })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, r.bankAccountId));
    const partidas = await ex
      .select({ p: sepaRemittanceItems, invoiceNumber: invoices.invoiceNumber })
      .from(sepaRemittanceItems)
      .innerJoin(
        paymentMilestones,
        eq(paymentMilestones.id, sepaRemittanceItems.milestoneId),
      )
      .innerJoin(invoices, eq(invoices.id, paymentMilestones.invoiceId))
      .where(eq(sepaRemittanceItems.remittanceId, r.id))
      .orderBy(asc(sepaRemittanceItems.position));
    const [conciliada] = await ex
      .select({ id: bankTransactions.id })
      .from(bankTransactions)
      .where(eq(bankTransactions.reconciledRemittanceId, r.id))
      .limit(1);
    return {
      id: r.id,
      numero: r.number,
      tipo: r.type,
      estado: r.status,
      bankAccountId: r.bankAccountId,
      bankAccountNombre: cuenta?.name ?? '',
      fechaEjecucion: r.executionDate,
      concepto: r.memo,
      total: Number(r.totalAmount),
      numPartidas: r.itemCount,
      xmlHash: r.xmlHash,
      generadaEl: r.generatedAt?.toISOString() ?? null,
      remitidaEl: r.sentOn,
      motivo: r.reason,
      conciliadaCon: conciliada?.id ?? null,
      version: r.version,
      partidas: partidas.map(({ p, invoiceNumber }): PartidaRemesaDto => ({
        id: p.id,
        orden: p.position,
        vencimientoId: p.milestoneId,
        invoiceNumber,
        contactId: p.contactId,
        nombre: p.name,
        iban: p.iban,
        importe: Number(p.amount),
        endToEndId: p.endToEndId,
        mandato: p.mandateRef,
        secuencia: (p.sequenceType as SecuenciaAdeudo | null) ?? null,
        estado: p.status as EstadoPartidaRemesa,
        liquidacionId: p.settlementId,
        devueltaEl: p.returnedOn,
        motivoDevolucion: p.returnReason,
      })),
    };
  }

  async listar(q: RemesasQuery): Promise<RemesaDto[]> {
    const filtros: SQL[] = [
      eq(sepaRemittances.companyId, this.dbs.getCompanyId()),
    ];
    if (q.estado) filtros.push(eq(sepaRemittances.status, q.estado));
    if (q.tipo) filtros.push(eq(sepaRemittances.type, q.tipo));
    if (q.bankAccountId)
      filtros.push(eq(sepaRemittances.bankAccountId, q.bankAccountId));
    const filas = await this.dbs.db
      .select()
      .from(sepaRemittances)
      .where(and(...filtros))
      .orderBy(desc(sepaRemittances.createdAt))
      .limit(200);
    return Promise.all(filas.map((r) => this.dto(this.dbs.db, r)));
  }

  async detalle(id: string): Promise<RemesaDto> {
    const [r] = await this.dbs.db
      .select()
      .from(sepaRemittances)
      .where(
        and(
          eq(sepaRemittances.id, id),
          eq(sepaRemittances.companyId, this.dbs.getCompanyId()),
        ),
      );
    if (!r)
      throw errorBanca('SEPA_REMITTANCE_NOT_FOUND', 'Remesa no encontrada');
    return this.dto(this.dbs.db, r);
  }

  /** XML guardado al generar (idéntico en cada descarga). */
  async xml(id: string): Promise<{ xml: string; nombre: string }> {
    const [r] = await this.dbs.db
      .select({ xml: sepaRemittances.xml, number: sepaRemittances.number })
      .from(sepaRemittances)
      .where(
        and(
          eq(sepaRemittances.id, id),
          eq(sepaRemittances.companyId, this.dbs.getCompanyId()),
        ),
      );
    if (!r)
      throw errorBanca('SEPA_REMITTANCE_NOT_FOUND', 'Remesa no encontrada');
    if (!r.xml) {
      throw errorBanca(
        'SEPA_INVALID_TRANSITION',
        'La remesa aún no tiene fichero: genérala',
      );
    }
    return { xml: r.xml, nombre: `${r.number}.xml` };
  }

  /** Secuencia de adeudo del mandato: FRST si no hubo adeudos remitidos antes. */
  private async secuencia(
    ex: DbOrTx,
    contactId: string,
    mandato: string | null,
  ) {
    if (!mandato) return null;
    const [n] = await ex
      .select({ n: sql<number>`count(*)::int` })
      .from(sepaRemittanceItems)
      .innerJoin(
        sepaRemittances,
        eq(sepaRemittances.id, sepaRemittanceItems.remittanceId),
      )
      .where(
        and(
          eq(sepaRemittanceItems.contactId, contactId),
          eq(sepaRemittanceItems.mandateRef, mandato),
          eq(sepaRemittances.type, 'adeudo'),
          inArray(sepaRemittances.status, ['remitida', 'devuelta']),
          ne(sepaRemittanceItems.status, 'excluida'),
        ),
      );
    return secuenciaAdeudo(n?.n ?? 0);
  }

  async crear(input: RemesaCreateInput): Promise<RemesaDto> {
    const d = remesaCreateSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    const hoy = todayIso();
    if (d.fechaEjecucion < hoy) {
      throw errorBanca(
        'SEPA_DATE_INVALID',
        'La fecha de ejecución no puede ser pasada',
      );
    }
    const ids = [...new Set(d.vencimientoIds)];
    const id = await this.dbs.db.transaction(async (tx) => {
      const [cuenta] = await tx
        .select()
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.id, d.bankAccountId),
            eq(bankAccounts.companyId, companyId),
          ),
        );
      if (
        !cuenta ||
        !cuenta.isActive ||
        cuenta.deletedAt ||
        cuenta.kind !== 'banco'
      ) {
        throw errorBanca(
          'BANK_ACCOUNT_NOT_FOUND',
          'Cuenta bancaria no encontrada o inactiva',
        );
      }
      const filas = await tx
        .select({ m: paymentMilestones, inv: invoices, c: contacts })
        .from(paymentMilestones)
        .innerJoin(invoices, eq(invoices.id, paymentMilestones.invoiceId))
        .innerJoin(contacts, eq(contacts.id, invoices.contactId))
        .where(
          and(
            inArray(paymentMilestones.id, ids),
            eq(paymentMilestones.companyId, companyId),
          ),
        )
        .orderBy(asc(paymentMilestones.dueDate), asc(paymentMilestones.id))
        .for('update', { of: paymentMilestones });
      if (filas.length !== ids.length) {
        throw errorBanca('DUE_NOT_FOUND', 'Algún vencimiento no existe');
      }
      const direccion = DIRECCION_REMESA[d.tipo];
      const vivas = await tx
        .select({ milestoneId: sepaRemittanceItems.milestoneId })
        .from(sepaRemittanceItems)
        .where(
          and(
            inArray(sepaRemittanceItems.milestoneId, ids),
            eq(sepaRemittanceItems.status, 'incluida'),
          ),
        );
      if (vivas.length > 0) {
        throw errorBanca(
          'SEPA_DUE_IN_REMITTANCE',
          'Algún vencimiento ya está en otra remesa viva',
          {
            vencimientoIds: vivas.map((v) => v.milestoneId),
          },
        );
      }
      const partidas: {
        m: typeof paymentMilestones.$inferSelect;
        inv: typeof invoices.$inferSelect;
        c: typeof contacts.$inferSelect;
        pendiente: bigint;
      }[] = [];
      for (const f of filas) {
        const pendiente = toCents(f.m.amount) - toCents(f.m.settledAmount);
        const magnitud = pendiente < 0n ? -pendiente : pendiente;
        if (
          f.m.direction !== direccion ||
          f.m.status !== 'previsto' ||
          magnitud <= 0n ||
          f.inv.status !== 'aprobada'
        ) {
          throw errorBanca(
            'SEPA_DUE_INVALID',
            `El vencimiento de ${f.inv.invoiceNumber} no se puede remesar en ${d.tipo === 'adeudo' ? 'adeudos (cobros)' : 'transferencias (pagos)'}: debe ser de ${direccion}, estar pendiente y su factura aprobada`,
          );
        }
        partidas.push({ ...f, pendiente: magnitud });
      }
      // Numeración REM-AAAA-0001 sin huecos por empresa y año.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`remesa:${companyId}`}))`,
      );
      const anio = hoy.slice(0, 4);
      const [n] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(sepaRemittances)
        .where(
          and(
            eq(sepaRemittances.companyId, companyId),
            like(sepaRemittances.number, `REM-${anio}-%`),
          ),
        );
      const numero = `REM-${anio}-${String((n?.n ?? 0) + 1).padStart(4, '0')}`;
      const total = partidas.reduce((s, p) => s + p.pendiente, 0n);
      const [r] = await tx
        .insert(sepaRemittances)
        .values({
          companyId,
          number: numero,
          type: d.tipo,
          bankAccountId: d.bankAccountId,
          executionDate: d.fechaEjecucion,
          memo: d.concepto ?? null,
          totalAmount: centsToNumeric(total),
          itemCount: partidas.length,
          createdBy: getRequestContext()?.userId ?? null,
        })
        .returning();
      let orden = 0;
      for (const p of partidas) {
        orden++;
        await tx.insert(sepaRemittanceItems).values({
          companyId,
          remittanceId: r.id,
          position: orden,
          milestoneId: p.m.id,
          contactId: p.c.id,
          amount: centsToNumeric(p.pendiente),
          endToEndId: referenciaPartida(numero, orden),
          name: p.c.legalName.slice(0, 200),
          iban: normalizarIban(p.c.iban) || null,
          mandateRef: d.tipo === 'adeudo' ? p.c.sepaMandateRef : null,
          mandateDate: d.tipo === 'adeudo' ? p.c.sepaMandateDate : null,
          sequenceType:
            d.tipo === 'adeudo'
              ? await this.secuencia(tx, p.c.id, p.c.sepaMandateRef)
              : null,
          remittanceInfo:
            `Factura ${p.inv.invoiceNumber}${d.concepto ? ` ${d.concepto}` : ''}`.slice(
              0,
              140,
            ),
        });
      }
      await this.audit.registrar(tx, {
        entityType: 'sepa_remittance',
        entityId: r.id,
        action: 'create',
        newData: { ...r, vencimientoIds: partidas.map((p) => p.m.id) },
      });
      return r.id;
    });
    return this.detalle(id);
  }

  /**
   * Genera el XML: refresca los datos SEPA de los terceros (IBAN, nombre y
   * mandato pueden haberse corregido), valida y guarda el fichero y su hash.
   */
  async generar(id: string, version: number | undefined): Promise<RemesaDto> {
    const companyId = this.dbs.getCompanyId();
    await this.dbs.db.transaction(async (tx) => {
      const r = await this.bloquear(tx, id);
      verificarVersion(r.version, version);
      if (r.status !== 'borrador') {
        throw errorBanca(
          'SEPA_INVALID_TRANSITION',
          `La remesa está ${r.status}: solo se genera un borrador`,
        );
      }
      const [empresa] = await tx
        .select()
        .from(companies)
        .where(eq(companies.id, companyId));
      const [cuenta] = await tx
        .select()
        .from(bankAccounts)
        .where(eq(bankAccounts.id, r.bankAccountId));
      const items = await tx
        .select({ p: sepaRemittanceItems, c: contacts })
        .from(sepaRemittanceItems)
        .innerJoin(contacts, eq(contacts.id, sepaRemittanceItems.contactId))
        .where(eq(sepaRemittanceItems.remittanceId, r.id))
        .orderBy(asc(sepaRemittanceItems.position));
      const adeudo = r.type === 'adeudo';
      for (const { p, c } of items) {
        const datos = {
          name: c.legalName.slice(0, 200),
          iban: normalizarIban(c.iban) || null,
          mandateRef: adeudo ? c.sepaMandateRef : null,
          mandateDate: adeudo ? c.sepaMandateDate : null,
          sequenceType: adeudo
            ? await this.secuencia(tx, c.id, c.sepaMandateRef)
            : null,
        };
        await tx
          .update(sepaRemittanceItems)
          .set({ ...datos, updatedAt: new Date() })
          .where(eq(sepaRemittanceItems.id, p.id));
        Object.assign(p, datos);
      }
      const ajustes = (empresa.settings ?? {}) as {
        sepaCreditorId?: string;
        sepaCreditorSuffix?: string;
      };
      const acreedorId = adeudo
        ? (ajustes.sepaCreditorId ??
          reglaBanca(() =>
            identificadorAcreedorSepa(
              empresa.taxId,
              ajustes.sepaCreditorSuffix,
            ),
          ))
        : null;
      const creadoEl = new Date().toISOString();
      const xml = reglaBanca(() =>
        generarSepaXml(
          {
            tipo: r.type as TipoRemesa,
            mensajeId: r.number,
            creadoEl,
            fechaEjecucion: r.executionDate,
            ordenante: {
              nombre: empresa.name,
              nif: empresa.taxId,
              iban: cuenta.iban,
              bic: cuenta.bic,
            },
            acreedorId,
            partidas: items.map(({ p }) => ({
              endToEndId: p.endToEndId,
              importe: p.amount,
              nombre: p.name,
              iban: p.iban,
              concepto: p.remittanceInfo,
              mandato: p.mandateRef,
              fechaMandato: p.mandateDate,
              secuencia:
                (p.sequenceType as SecuenciaAdeudo | null) ?? undefined,
            })),
          },
          todayIso(),
        ),
      );
      const xmlHash = createHash('sha256').update(xml, 'utf8').digest('hex');
      await cambiarEstado(
        tx,
        sepaRemittances,
        'sepa_remittance',
        r.id,
        'borrador',
        'generada',
        {
          xml,
          xmlHash,
          generatedAt: new Date(creadoEl),
        },
        r.version,
      );
      await this.audit.registrar(tx, {
        entityType: 'sepa_remittance',
        entityId: r.id,
        action: 'update',
        oldData: { status: r.status },
        newData: { status: 'generada', xmlHash },
      });
    });
    return this.detalle(id);
  }

  /**
   * Remitida al banco: liquida cada partida por su importe, con la cuenta de
   * la remesa y la referencia de la operación, y la contabiliza a la fecha
   * (período cerrado → FISCAL_PERIOD_CLOSED, sin dejar nada a medias).
   */
  async remitir(
    id: string,
    fecha: string,
    version: number | undefined,
    justificacionSod?: string | null,
  ): Promise<RemesaDto> {
    const companyId = this.dbs.getCompanyId();
    await this.dbs.db.transaction(async (tx) => {
      const r = await this.bloquear(tx, id);
      verificarVersion(r.version, version);
      if (r.status !== 'generada') {
        throw errorBanca(
          'SEPA_INVALID_TRANSITION',
          `La remesa está ${r.status}: solo se remite una remesa generada`,
        );
      }
      if (
        fecha > todayIso() ||
        (r.generatedAt && fecha < r.generatedAt.toISOString().slice(0, 10))
      ) {
        throw errorBanca(
          'SEPA_DATE_INVALID',
          'La fecha de envío no puede ser futura ni anterior a la generación',
        );
      }
      const items = await tx
        .select()
        .from(sepaRemittanceItems)
        .where(
          and(
            eq(sepaRemittanceItems.remittanceId, r.id),
            eq(sepaRemittanceItems.status, 'incluida'),
          ),
        )
        .orderBy(asc(sepaRemittanceItems.position));
      if (r.type === 'transferencia' && items.length > 0) {
        // Segregación: quien aprobó alguna de las facturas no la remite sin política.
        const facturas = await tx
          .selectDistinct({ id: paymentMilestones.invoiceId })
          .from(paymentMilestones)
          .where(
            inArray(
              paymentMilestones.id,
              items.map((p) => p.milestoneId),
            ),
          );
        await this.grc.verificarAprobadorPaga(
          tx,
          facturas.map((f) => f.id),
          { operacion: 'remesa_sepa', entidadId: r.id, referencia: r.number },
          justificacionSod,
        );
      }
      const ctx = this.contexto(tx);
      for (const p of items) {
        const liq = await registrarLiquidacion(ctx, p.milestoneId, {
          cantidad: fromCents(toCents(p.amount)),
          fecha,
          bankAccountId: r.bankAccountId,
          paymentInstrument:
            r.type === 'adeudo' ? 'domiciliacion' : 'transferencia',
          referencia: p.endToEndId,
          remesaPartidaId: p.id,
        });
        await this.contabilidad.contabilizarLiquidacionEnTx(
          tx,
          companyId,
          liq.id,
        );
        await tx
          .update(sepaRemittanceItems)
          .set({ settlementId: liq.id, updatedAt: new Date() })
          .where(eq(sepaRemittanceItems.id, p.id));
      }
      await cambiarEstado(
        tx,
        sepaRemittances,
        'sepa_remittance',
        r.id,
        'generada',
        'remitida',
        { sentOn: fecha },
        r.version,
      );
      await this.audit.registrar(tx, {
        entityType: 'sepa_remittance',
        entityId: r.id,
        action: 'update',
        oldData: { status: r.status, sentOn: r.sentOn },
        newData: { status: 'remitida', sentOn: fecha, partidas: items.length },
      });
    });
    return this.detalle(id);
  }

  /** Anula un borrador o una remesa generada (aún no remitida); libera los vencimientos. */
  async anular(
    id: string,
    motivo: string,
    version: number | undefined,
  ): Promise<RemesaDto> {
    await this.dbs.db.transaction(async (tx) => {
      const r = await this.bloquear(tx, id);
      verificarVersion(r.version, version);
      if (r.status !== 'borrador' && r.status !== 'generada') {
        throw errorBanca(
          'SEPA_INVALID_TRANSITION',
          r.status === 'remitida'
            ? 'Una remesa remitida no se anula: registra la devolución de sus partidas'
            : `La remesa ya está ${r.status}`,
        );
      }
      await cambiarEstadoMasivo(
        tx,
        sepaRemittanceItems,
        'sepa_remittance_item',
        and(
          eq(sepaRemittanceItems.remittanceId, r.id),
          eq(sepaRemittanceItems.status, 'incluida'),
        )!,
        'incluida',
        'excluida',
      );
      await cambiarEstado(
        tx,
        sepaRemittances,
        'sepa_remittance',
        r.id,
        r.status as EstadoRemesa,
        'anulada',
        { reason: motivo },
        r.version,
      );
      await this.audit.registrar(tx, {
        entityType: 'sepa_remittance',
        entityId: r.id,
        action: 'update',
        oldData: { status: r.status },
        newData: { status: 'anulada', reason: motivo },
      });
    });
    return this.detalle(id);
  }

  /**
   * Devolución de una partida remitida (R-transaction: AM04, MD06…): anula su
   * liquidación (el vencimiento vuelve a estar vivo) y su asiento a la fecha
   * de la devolución. Con todas las partidas devueltas, la remesa queda devuelta.
   */
  async devolverPartida(
    id: string,
    partidaId: string,
    fecha: string,
    motivo: string,
    version: number | undefined,
  ): Promise<RemesaDto> {
    const companyId = this.dbs.getCompanyId();
    await this.dbs.db.transaction(async (tx) => {
      const r = await this.bloquear(tx, id);
      verificarVersion(r.version, version);
      const [p] = await tx
        .select()
        .from(sepaRemittanceItems)
        .where(
          and(
            eq(sepaRemittanceItems.id, partidaId),
            eq(sepaRemittanceItems.remittanceId, r.id),
          ),
        )
        .for('update');
      if (!p)
        throw errorBanca(
          'SEPA_ITEM_NOT_FOUND',
          'Partida no encontrada en la remesa',
        );
      if (
        r.status !== 'remitida' ||
        p.status !== 'incluida' ||
        !p.settlementId
      ) {
        throw errorBanca(
          'SEPA_ITEM_NOT_RETURNABLE',
          'Solo se devuelve una partida incluida de una remesa remitida',
        );
      }
      if (fecha > todayIso() || (r.sentOn && fecha < r.sentOn)) {
        throw errorBanca(
          'SEPA_DATE_INVALID',
          'La devolución no puede ser futura ni anterior al envío',
        );
      }
      const texto = `Devolución ${p.endToEndId}: ${motivo}`.slice(0, 240);
      await anularLiquidacion(
        this.contexto(tx),
        p.settlementId,
        texto,
        undefined,
        true,
      );
      await this.contabilidad.anularDeOrigenEnTx(
        tx,
        companyId,
        ['cobro', 'pago'],
        p.settlementId,
        texto,
        fecha,
      );
      await cambiarEstado(
        tx,
        sepaRemittanceItems,
        'sepa_remittance_item',
        p.id,
        'incluida',
        'devuelta',
        {
          returnedOn: fecha,
          returnReason: motivo,
        },
      );
      const [quedan] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(sepaRemittanceItems)
        .where(
          and(
            eq(sepaRemittanceItems.remittanceId, r.id),
            eq(sepaRemittanceItems.status, 'incluida'),
          ),
        );
      const devuelta = (quedan?.n ?? 0) === 0;
      if (devuelta) {
        await cambiarEstado(
          tx,
          sepaRemittances,
          'sepa_remittance',
          r.id,
          'remitida',
          'devuelta',
          {},
          r.version,
        );
      } else {
        // La remesa cambia (partida devuelta): su versión también.
        await tx
          .update(sepaRemittances)
          .set({
            version: sql`${sepaRemittances.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(sepaRemittances.id, r.id));
      }
      await this.audit.registrar(tx, [
        {
          entityType: 'sepa_remittance_item',
          entityId: p.id,
          action: 'update',
          oldData: { status: p.status },
          newData: diferenciasAuditoria(
            {
              status: p.status,
              returnedOn: p.returnedOn,
              returnReason: p.returnReason,
            },
            { status: 'devuelta', returnedOn: fecha, returnReason: motivo },
          ),
        },
        ...(devuelta
          ? [
              {
                entityType: 'sepa_remittance' as const,
                entityId: r.id,
                action: 'update' as const,
                oldData: { status: r.status },
                newData: { status: 'devuelta' },
              },
            ]
          : []),
      ]);
    });
    return this.detalle(id);
  }
}
