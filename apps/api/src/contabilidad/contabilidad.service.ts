import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  sql,
  SQL,
} from 'drizzle-orm';
import {
  contacts,
  fiscalPeriods,
  fiscalYearClosings,
  invoiceLines,
  invoices,
  journalEntries,
  journalEntryLines,
  ledgerAccounts,
  paymentMilestones,
  paymentSettlements,
  projects,
  type JournalEntry,
  type LedgerAccount,
  type DbOrTx,
  type Tx,
} from '@erp/db';
import {
  AsientoAnularInput,
  AsientoCreateInput,
  AsientoDto,
  CuentaContableDto,
  CuentaCreateInput,
  CuentaUpdateInput,
  LibroMayorDto,
  LineaPropuesta,
  OrigenAsiento,
  PeriodoContableDto,
  ResultadoInterfazDto,
  SumasSaldosDto,
  TipoCuenta,
  asientoAnularSchema,
  asientoCreateSchema,
  asientoDesdeFactura,
  asientoDesdeVencimiento,
  centsToNumeric,
  cuentaCreateSchema,
  cuentaUpdateSchema,
  errorCuadre,
  filasSumasSaldos,
  fromCents,
  lineasContraAsiento,
  periodoDeFecha,
  planContableBase,
  saldoNatural,
  sumCents,
  tipoCuentaPorCodigo,
  toCents,
  todayIso,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { getRequestContext } from '../common/request-context';
import { cambiarEstado } from '../common/cambiar-estado';
import { verificarVersion } from '../common/version';
import { DbService } from '../db/db.service';

/** Máximo de documentos que procesa una pasada de la interfaz contable. */
const LOTE_INTERFAZ = 500;
/** Máximo de movimientos que devuelve el libro mayor en una consulta. */
const LIMITE_MAYOR = 2000;

export interface NuevoAsiento {
  companyId: string;
  fecha: string;
  concepto: string;
  origen: OrigenAsiento;
  origenId: string | null;
  reversesId?: string | null;
  lineas: LineaPropuesta[];
  /**
   * Solo el cierre del ejercicio (y su reversión): no comprueba el bloqueo
   * del ejercicio ni el del mes, porque los toma el propio cierre.
   */
  cierreEjercicio?: boolean;
}

/** Clave del bloqueo consultivo de un ejercicio (compartido al contabilizar). */
export function claveBloqueoEjercicio(companyId: string, ejercicio: number) {
  return `ejercicio:${companyId}:${ejercicio}`;
}

export function ejercicioCerrado(ejercicio: number): HttpException {
  return new ConflictException({
    code: 'FISCAL_YEAR_CLOSED',
    message: `El ejercicio ${ejercicio} está cerrado: no admite más asientos (revierte el cierre si es imprescindible)`,
  });
}

function cuentaToDto(c: LedgerAccount): CuentaContableDto {
  return {
    id: c.id,
    codigo: c.code,
    nombre: c.name,
    tipo: c.type as TipoCuenta,
    imputable: c.postable,
    activa: c.isActive,
    version: c.version,
  };
}

function periodoCerrado(ejercicio: number, mes: number): HttpException {
  return new ConflictException({
    code: 'FISCAL_PERIOD_CLOSED',
    message: `El período ${String(mes).padStart(2, '0')}/${ejercicio} está cerrado: reábrelo o usa una fecha de un período abierto`,
  });
}

@Injectable()
export class ContabilidadService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  /* ─────────────────────────── plan de cuentas ─────────────────────────── */

  /** Crea las cuentas del PGC base que falten (idempotente). Devuelve cuántas creó. */
  async inicializarPlan(): Promise<{ creadas: number }> {
    const companyId = this.dbs.getCompanyId();
    const creadas = await this.dbs.db.transaction((tx) =>
      this.asegurarPlan(tx, companyId),
    );
    return { creadas };
  }

  private async asegurarPlan(tx: Tx, companyId: string): Promise<number> {
    const filas = await tx
      .insert(ledgerAccounts)
      .values(
        planContableBase().map((c) => ({
          companyId,
          code: c.codigo,
          name: c.nombre,
          type: c.tipo,
          postable: c.imputable,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: ledgerAccounts.id });
    return filas.length;
  }

  async listarCuentas(opciones: {
    q?: string;
    soloImputables?: boolean;
  }): Promise<CuentaContableDto[]> {
    const companyId = this.dbs.getCompanyId();
    const filtros: SQL[] = [eq(ledgerAccounts.companyId, companyId)];
    if (opciones.soloImputables)
      filtros.push(eq(ledgerAccounts.postable, true));
    if (opciones.q) {
      const patron = `%${opciones.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      filtros.push(
        sql`(${ledgerAccounts.code} LIKE ${patron} OR ${ledgerAccounts.name} ILIKE ${patron})`,
      );
    }
    const filas = await this.dbs.db
      .select()
      .from(ledgerAccounts)
      .where(and(...filtros))
      .orderBy(asc(ledgerAccounts.code));
    return filas.map(cuentaToDto);
  }

  async crearCuenta(input: CuentaCreateInput): Promise<CuentaContableDto> {
    const companyId = this.dbs.getCompanyId();
    const data = cuentaCreateSchema.parse(input);
    return this.dbs.db.transaction(async (tx) => {
      const [creada] = await tx
        .insert(ledgerAccounts)
        .values({
          companyId,
          code: data.codigo,
          name: data.nombre,
          type: data.tipo ?? tipoCuentaPorCodigo(data.codigo),
          postable: data.imputable,
        })
        .onConflictDoNothing()
        .returning();
      if (!creada) {
        throw new ConflictException({
          code: 'LEDGER_ACCOUNT_DUPLICATE',
          message: `Ya existe la cuenta ${data.codigo}`,
        });
      }
      await this.audit.registrar(tx, {
        entityType: 'ledger_account',
        entityId: creada.id,
        action: 'create',
        newData: creada,
      });
      return cuentaToDto(creada);
    });
  }

  async actualizarCuenta(
    id: string,
    input: CuentaUpdateInput,
    versionEsperada: number | undefined,
  ): Promise<CuentaContableDto> {
    const companyId = this.dbs.getCompanyId();
    const data = cuentaUpdateSchema.parse(input);
    return this.dbs.db.transaction(async (tx) => {
      const [actual] = await tx
        .select()
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.id, id),
            eq(ledgerAccounts.companyId, companyId),
          ),
        )
        .for('update')
        .limit(1);
      if (!actual) throw this.cuentaNoEncontrada(id);
      verificarVersion(actual.version, versionEsperada);
      const [nueva] = await tx
        .update(ledgerAccounts)
        .set({
          ...(data.nombre !== undefined && { name: data.nombre }),
          ...(data.activa !== undefined && { isActive: data.activa }),
          version: actual.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(ledgerAccounts.id, id))
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'ledger_account',
        entityId: id,
        action: 'update',
        oldData: actual,
        newData: nueva,
      });
      return cuentaToDto(nueva);
    });
  }

  private cuentaNoEncontrada(ref: string): HttpException {
    return new NotFoundException({
      code: 'LEDGER_ACCOUNT_NOT_FOUND',
      message: `Cuenta contable no encontrada: ${ref}`,
    });
  }

  /* ─────────────────────────────── asientos ─────────────────────────────── */

  /**
   * Núcleo de contabilización. Serializa por período (cierre concurrente) y
   * por ejercicio (numeración correlativa) con bloqueos consultivos de
   * transacción; el cuadre se comprueba aquí y, de respaldo, en el trigger
   * diferido de la base.
   */
  private async contabilizar(tx: Tx, a: NuevoAsiento): Promise<JournalEntry> {
    const descuadre = errorCuadre(a.lineas);
    if (descuadre) {
      throw new UnprocessableEntityException({
        code: 'JOURNAL_ENTRY_UNBALANCED',
        message: descuadre,
      });
    }
    const { ejercicio, mes } = periodoDeFecha(a.fecha);
    // Orden de bloqueos (sin interbloqueos con el cierre del ejercicio):
    // primero el ejercicio (compartido; el cierre lo toma exclusivo y ya lo
    // tiene), después el período.
    if (!a.cierreEjercicio) {
      await tx.execute(
        sql`select pg_advisory_xact_lock_shared(hashtext(${claveBloqueoEjercicio(a.companyId, ejercicio)}))`,
      );
      const [cerrado] = await tx
        .select({ id: fiscalYearClosings.id })
        .from(fiscalYearClosings)
        .where(
          and(
            eq(fiscalYearClosings.companyId, a.companyId),
            eq(fiscalYearClosings.year, ejercicio),
            eq(fiscalYearClosings.status, 'cerrado'),
          ),
        )
        .limit(1);
      if (cerrado) throw ejercicioCerrado(ejercicio);
    }
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`periodo:${a.companyId}:${ejercicio}:${mes}`}))`,
    );
    const [periodo] = await tx
      .select({ status: fiscalPeriods.status })
      .from(fiscalPeriods)
      .where(
        and(
          eq(fiscalPeriods.companyId, a.companyId),
          eq(fiscalPeriods.year, ejercicio),
          eq(fiscalPeriods.month, mes),
        ),
      )
      .limit(1);
    // Los asientos del propio cierre van al 31-12 / 01-01 aunque el mes esté
    // cerrado (el equivalente a los períodos especiales 13-16 de SAP).
    if (periodo?.status === 'cerrado' && !a.cierreEjercicio) {
      throw periodoCerrado(ejercicio, mes);
    }

    // Cuentas: deben existir, estar activas y ser imputables.
    const codigos = [...new Set(a.lineas.map((l) => l.cuenta))];
    const cuentas = await tx
      .select()
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.companyId, a.companyId),
          inArray(ledgerAccounts.code, codigos),
        ),
      );
    const porCodigo = new Map(cuentas.map((c) => [c.code, c]));
    for (const codigo of codigos) {
      const c = porCodigo.get(codigo);
      if (!c) {
        throw new UnprocessableEntityException({
          code: 'LEDGER_ACCOUNT_NOT_FOUND',
          message: `La cuenta ${codigo} no existe en el plan contable`,
        });
      }
      if (!c.postable || !c.isActive) {
        throw new UnprocessableEntityException({
          code: 'LEDGER_ACCOUNT_NOT_POSTABLE',
          message: `La cuenta ${codigo} ${c.isActive ? 'es de agrupación y no admite apuntes' : 'está dada de baja'}`,
        });
      }
    }

    // Obras de la imputación analítica: deben ser de la empresa.
    const obras = [
      ...new Set(
        a.lineas.map((l) => l.projectId).filter((p): p is string => !!p),
      ),
    ];
    if (obras.length > 0) {
      const encontradas = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(eq(projects.companyId, a.companyId), inArray(projects.id, obras)),
        );
      if (encontradas.length !== obras.length) {
        throw new UnprocessableEntityException({
          code: 'PROJECT_NOT_FOUND',
          message: 'Alguna obra de la imputación analítica no existe',
        });
      }
    }

    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`asiento:${a.companyId}:${ejercicio}`}))`,
    );
    const [{ siguiente }] = await tx
      .select({
        siguiente: sql<number>`coalesce(max(${journalEntries.number}), 0) + 1`,
      })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.companyId, a.companyId),
          eq(journalEntries.fiscalYear, ejercicio),
        ),
      );

    const total = sumCents(a.lineas.map((l) => toCents(l.debe)));
    const [asiento] = await tx
      .insert(journalEntries)
      .values({
        companyId: a.companyId,
        number: Number(siguiente),
        fiscalYear: ejercicio,
        entryDate: a.fecha,
        description: a.concepto.slice(0, 240),
        source: a.origen,
        sourceId: a.origenId,
        reversesId: a.reversesId ?? null,
        totalAmount: centsToNumeric(total),
        createdBy: getRequestContext()?.userId ?? null,
      })
      .returning();
    await tx.insert(journalEntryLines).values(
      a.lineas.map((l, i) => ({
        companyId: a.companyId,
        entryId: asiento.id,
        lineNo: i + 1,
        accountId: porCodigo.get(l.cuenta)!.id,
        debit: centsToNumeric(toCents(l.debe)),
        credit: centsToNumeric(toCents(l.haber)),
        projectId: l.projectId ?? null,
        description: l.concepto ? l.concepto.slice(0, 240) : null,
      })),
    );
    await this.audit.registrar(tx, {
      entityType: 'journal_entry',
      entityId: asiento.id,
      action: 'create',
      newData: { ...asiento, lineas: a.lineas },
    });
    return asiento;
  }

  /**
   * Asiento generado por otro módulo (amortización, baja de inmovilizado)
   * dentro de SU transacción: mismas reglas de cuadre, cuentas, período
   * cerrado y numeración que cualquier asiento. Asegura antes el plan base.
   */
  async contabilizarEnTx(tx: Tx, a: NuevoAsiento): Promise<JournalEntry> {
    await this.asegurarPlan(tx, a.companyId);
    return this.contabilizar(tx, a);
  }

  async crearAsientoManual(input: AsientoCreateInput): Promise<AsientoDto> {
    const companyId = this.dbs.getCompanyId();
    const data = asientoCreateSchema.parse(input);
    const asiento = await this.dbs.db.transaction(async (tx) => {
      await this.asegurarPlan(tx, companyId);
      return this.contabilizar(tx, {
        companyId,
        fecha: data.fecha,
        concepto: data.concepto,
        origen: 'manual',
        origenId: null,
        lineas: data.lineas.map((l) => ({
          cuenta: l.cuenta,
          debe: l.debe.toFixed(2),
          haber: l.haber.toFixed(2),
          projectId: l.projectId ?? null,
          concepto: l.concepto ?? data.concepto,
        })),
      });
    });
    return this.obtenerAsiento(asiento.id);
  }

  /** Anula un asiento generando su contra-asiento (las líneas no se tocan). */
  async anularAsiento(
    id: string,
    input: AsientoAnularInput,
    versionEsperada: number | undefined,
  ): Promise<AsientoDto> {
    const companyId = this.dbs.getCompanyId();
    const data = asientoAnularSchema.parse(input);
    const contraId = await this.dbs.db.transaction(async (tx) => {
      const contra = await this.anularEnTx(
        tx,
        companyId,
        id,
        data.motivo,
        data.fecha,
        versionEsperada,
      );
      return contra.id;
    });
    return this.obtenerAsiento(contraId);
  }

  /**
   * Anula un asiento por contra-asiento dentro de la transacción del
   * llamador (p. ej. la anulación de un cierre de obra en curso).
   */
  async anularEnTx(
    tx: Tx,
    companyId: string,
    id: string,
    motivo: string,
    fecha: string | undefined,
    versionEsperada?: number,
    /** Solo la reversión del cierre del ejercicio. */
    cierreEjercicio = false,
  ): Promise<JournalEntry> {
    const [original] = await tx
      .select()
      .from(journalEntries)
      .where(
        and(eq(journalEntries.id, id), eq(journalEntries.companyId, companyId)),
      )
      .for('update')
      .limit(1);
    if (!original) {
      throw new NotFoundException({
        code: 'JOURNAL_ENTRY_NOT_FOUND',
        message: 'Asiento no encontrado',
      });
    }
    verificarVersion(original.version, versionEsperada);
    if (original.status === 'anulado') {
      throw new ConflictException({
        code: 'JOURNAL_ENTRY_ALREADY_REVERSED',
        message: `El asiento ${original.number}/${original.fiscalYear} ya está anulado`,
      });
    }
    if (original.reversesId) {
      throw new ConflictException({
        code: 'JOURNAL_ENTRY_IS_REVERSAL',
        message:
          'Un contra-asiento no se anula: contabiliza el asiento correcto de nuevo',
      });
    }
    const lineas = await tx
      .select({
        cuenta: ledgerAccounts.code,
        debe: journalEntryLines.debit,
        haber: journalEntryLines.credit,
        projectId: journalEntryLines.projectId,
        concepto: journalEntryLines.description,
      })
      .from(journalEntryLines)
      .innerJoin(
        ledgerAccounts,
        eq(ledgerAccounts.id, journalEntryLines.accountId),
      )
      .where(eq(journalEntryLines.entryId, id))
      .orderBy(asc(journalEntryLines.lineNo));
    // El contra-asiento exige que las cuentas sigan activas: si alguna se dio
    // de baja, hay que reactivarla antes de anular (queda en la auditoría).
    const contra = await this.contabilizar(tx, {
      companyId,
      fecha: fecha ?? original.entryDate,
      concepto: `Anulación asiento ${original.number}/${original.fiscalYear}: ${motivo}`,
      origen: 'anulacion',
      origenId: null,
      reversesId: original.id,
      cierreEjercicio,
      lineas: lineasContraAsiento(
        lineas.map((l) => ({
          cuenta: l.cuenta,
          debe: l.debe,
          haber: l.haber,
          projectId: l.projectId,
          concepto: l.concepto ?? '',
        })),
      ),
    });
    // Punto único de escritura de estado: WHERE status = 'contabilizado' y
    // versión leída (FOR UPDATE), +1 de versión.
    await cambiarEstado(
      tx,
      journalEntries,
      'journal_entry',
      original.id,
      'contabilizado',
      'anulado',
      { reversedById: contra.id, reversalReason: motivo.slice(0, 240) },
      original.version,
    );
    await this.audit.registrar(tx, {
      entityType: 'journal_entry',
      entityId: original.id,
      action: 'update',
      oldData: { status: original.status },
      newData: { status: 'anulado', reversedById: contra.id, motivo },
    });
    return contra;
  }

  async obtenerAsiento(id: string): Promise<AsientoDto> {
    const companyId = this.dbs.getCompanyId();
    const [dto] = await this.cargarAsientos([
      eq(journalEntries.companyId, companyId),
      eq(journalEntries.id, id),
    ]);
    if (!dto) {
      throw new NotFoundException({
        code: 'JOURNAL_ENTRY_NOT_FOUND',
        message: 'Asiento no encontrado',
      });
    }
    return dto;
  }

  /** Libro diario: asientos con sus líneas, del más reciente al más antiguo. */
  async listarAsientos(f: {
    desde?: string;
    hasta?: string;
    origen?: OrigenAsiento;
    projectId?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: AsientoDto[]; total: number }> {
    const companyId = this.dbs.getCompanyId();
    const filtros: SQL[] = [eq(journalEntries.companyId, companyId)];
    if (f.desde) filtros.push(gte(journalEntries.entryDate, f.desde));
    if (f.hasta) filtros.push(lte(journalEntries.entryDate, f.hasta));
    if (f.origen) filtros.push(eq(journalEntries.source, f.origen));
    if (f.projectId) {
      filtros.push(
        sql`exists (select 1 from ${journalEntryLines} l where l.entry_id = ${journalEntries.id} and l.project_id = ${f.projectId})`,
      );
    }
    const [{ total }] = await this.dbs.db
      .select({ total: sql<number>`count(*)::int` })
      .from(journalEntries)
      .where(and(...filtros));
    const items = await this.cargarAsientos(filtros, f.limit, f.offset);
    return { items, total: Number(total) };
  }

  private async cargarAsientos(
    filtros: SQL[],
    limit = 1,
    offset = 0,
  ): Promise<AsientoDto[]> {
    const cabeceras = await this.dbs.db
      .select()
      .from(journalEntries)
      .where(and(...filtros))
      .orderBy(
        desc(journalEntries.entryDate),
        desc(journalEntries.fiscalYear),
        desc(journalEntries.number),
      )
      .limit(limit)
      .offset(offset);
    if (cabeceras.length === 0) return [];
    const lineas = await this.dbs.db
      .select({
        id: journalEntryLines.id,
        entryId: journalEntryLines.entryId,
        lineNo: journalEntryLines.lineNo,
        cuenta: ledgerAccounts.code,
        nombreCuenta: ledgerAccounts.name,
        debe: journalEntryLines.debit,
        haber: journalEntryLines.credit,
        projectId: journalEntryLines.projectId,
        concepto: journalEntryLines.description,
      })
      .from(journalEntryLines)
      .innerJoin(
        ledgerAccounts,
        eq(ledgerAccounts.id, journalEntryLines.accountId),
      )
      .where(
        inArray(
          journalEntryLines.entryId,
          cabeceras.map((c) => c.id),
        ),
      )
      .orderBy(asc(journalEntryLines.lineNo));
    return cabeceras.map((c) => {
      const propias = lineas.filter((l) => l.entryId === c.id);
      return {
        id: c.id,
        numero: c.number,
        ejercicio: c.fiscalYear,
        fecha: c.entryDate,
        concepto: c.description,
        origen: c.source as OrigenAsiento,
        origenId: c.sourceId,
        estado: c.status,
        anuladoPorId: c.reversedById,
        anulaAId: c.reversesId,
        totalDebe: fromCents(sumCents(propias.map((l) => toCents(l.debe)))),
        totalHaber: fromCents(sumCents(propias.map((l) => toCents(l.haber)))),
        version: c.version,
        createdAt: c.createdAt.toISOString(),
        lineas: propias.map((l) => ({
          id: l.id,
          cuenta: l.cuenta,
          nombreCuenta: l.nombreCuenta,
          debe: Number(l.debe),
          haber: Number(l.haber),
          projectId: l.projectId,
          concepto: l.concepto,
        })),
      };
    });
  }

  /* ─────────────────────────────── informes ─────────────────────────────── */

  async libroMayor(f: {
    cuenta: string;
    desde?: string;
    hasta?: string;
    projectId?: string;
  }): Promise<LibroMayorDto> {
    const companyId = this.dbs.getCompanyId();
    const [cuenta] = await this.dbs.db
      .select()
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.companyId, companyId),
          eq(ledgerAccounts.code, f.cuenta),
        ),
      )
      .limit(1);
    if (!cuenta) throw this.cuentaNoEncontrada(f.cuenta);
    const tipo = cuenta.type as TipoCuenta;

    const base: SQL[] = [
      eq(journalEntryLines.companyId, companyId),
      eq(journalEntryLines.accountId, cuenta.id),
    ];
    if (f.projectId) base.push(eq(journalEntryLines.projectId, f.projectId));

    let saldoInicial = 0;
    if (f.desde) {
      const [previo] = await this.dbs.db
        .select({
          debe: sql<string>`coalesce(sum(${journalEntryLines.debit}), 0)`,
          haber: sql<string>`coalesce(sum(${journalEntryLines.credit}), 0)`,
        })
        .from(journalEntryLines)
        .innerJoin(
          journalEntries,
          eq(journalEntries.id, journalEntryLines.entryId),
        )
        .where(and(...base, sql`${journalEntries.entryDate} < ${f.desde}`));
      saldoInicial = saldoNatural(tipo, previo.debe, previo.haber);
    }

    const rango: SQL[] = [...base];
    if (f.desde) rango.push(gte(journalEntries.entryDate, f.desde));
    if (f.hasta) rango.push(lte(journalEntries.entryDate, f.hasta));
    const [tot] = await this.dbs.db
      .select({
        debe: sql<string>`coalesce(sum(${journalEntryLines.debit}), 0)`,
        haber: sql<string>`coalesce(sum(${journalEntryLines.credit}), 0)`,
      })
      .from(journalEntryLines)
      .innerJoin(
        journalEntries,
        eq(journalEntries.id, journalEntryLines.entryId),
      )
      .where(and(...rango));
    const filas = await this.dbs.db
      .select({
        asientoId: journalEntries.id,
        numero: journalEntries.number,
        fecha: journalEntries.entryDate,
        conceptoAsiento: journalEntries.description,
        concepto: journalEntryLines.description,
        debe: journalEntryLines.debit,
        haber: journalEntryLines.credit,
        projectId: journalEntryLines.projectId,
      })
      .from(journalEntryLines)
      .innerJoin(
        journalEntries,
        eq(journalEntries.id, journalEntryLines.entryId),
      )
      .where(and(...rango))
      .orderBy(
        asc(journalEntries.entryDate),
        asc(journalEntries.fiscalYear),
        asc(journalEntries.number),
        asc(journalEntryLines.lineNo),
      )
      .limit(LIMITE_MAYOR + 1);

    const truncado = filas.length > LIMITE_MAYOR;
    let saldo = toCents(saldoInicial);
    const movimientos = filas.slice(0, LIMITE_MAYOR).map((m) => {
      saldo += toCents(saldoNatural(tipo, m.debe, m.haber));
      return {
        asientoId: m.asientoId,
        numero: m.numero,
        fecha: m.fecha,
        concepto: m.concepto ?? m.conceptoAsiento,
        debe: Number(m.debe),
        haber: Number(m.haber),
        saldo: fromCents(saldo),
        projectId: m.projectId,
      };
    });
    const movimientoPeriodo = saldoNatural(tipo, tot.debe, tot.haber);
    return {
      cuenta: cuentaToDto(cuenta),
      desde: f.desde ?? null,
      hasta: f.hasta ?? null,
      saldoInicial,
      totalDebe: Number(tot.debe),
      totalHaber: Number(tot.haber),
      saldoFinal: fromCents(toCents(saldoInicial) + toCents(movimientoPeriodo)),
      movimientos,
      truncado,
    };
  }

  /** Balance de sumas y saldos por cuenta imputable con movimiento. */
  async sumasSaldos(f: {
    desde?: string;
    hasta?: string;
    projectId?: string;
  }): Promise<SumasSaldosDto> {
    const companyId = this.dbs.getCompanyId();
    const filtros: SQL[] = [eq(journalEntryLines.companyId, companyId)];
    if (f.desde) filtros.push(gte(journalEntries.entryDate, f.desde));
    if (f.hasta) filtros.push(lte(journalEntries.entryDate, f.hasta));
    if (f.projectId) filtros.push(eq(journalEntryLines.projectId, f.projectId));
    const filas = await this.dbs.db
      .select({
        codigo: ledgerAccounts.code,
        nombre: ledgerAccounts.name,
        tipo: ledgerAccounts.type,
        debe: sql<string>`sum(${journalEntryLines.debit})`,
        haber: sql<string>`sum(${journalEntryLines.credit})`,
      })
      .from(journalEntryLines)
      .innerJoin(
        journalEntries,
        eq(journalEntries.id, journalEntryLines.entryId),
      )
      .innerJoin(
        ledgerAccounts,
        eq(ledgerAccounts.id, journalEntryLines.accountId),
      )
      .where(and(...filtros))
      .groupBy(ledgerAccounts.code, ledgerAccounts.name, ledgerAccounts.type)
      .orderBy(asc(ledgerAccounts.code));
    return {
      desde: f.desde ?? null,
      hasta: f.hasta ?? null,
      projectId: f.projectId ?? null,
      ...filasSumasSaldos(
        filas.map((r) => ({ ...r, tipo: r.tipo as TipoCuenta })),
      ),
    };
  }

  /* ─────────────────────────────── períodos ─────────────────────────────── */

  async periodos(ejercicio: number): Promise<PeriodoContableDto[]> {
    const companyId = this.dbs.getCompanyId();
    const estados = await this.dbs.db
      .select()
      .from(fiscalPeriods)
      .where(
        and(
          eq(fiscalPeriods.companyId, companyId),
          eq(fiscalPeriods.year, ejercicio),
        ),
      );
    const conteos = await this.dbs.db
      .select({
        mes: sql<number>`extract(month from ${journalEntries.entryDate})::int`,
        n: sql<number>`count(*)::int`,
      })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.companyId, companyId),
          eq(journalEntries.fiscalYear, ejercicio),
        ),
      )
      .groupBy(sql`1`);
    return Array.from({ length: 12 }, (_, i) => {
      const mes = i + 1;
      const p = estados.find((e) => e.month === mes);
      return {
        ejercicio,
        mes,
        estado: p?.status ?? 'abierto',
        asientos: Number(conteos.find((c) => Number(c.mes) === mes)?.n ?? 0),
        cerradoEn:
          p?.status === 'cerrado' ? (p.closedAt?.toISOString() ?? null) : null,
      };
    });
  }

  async cambiarEstadoPeriodo(
    ejercicio: number,
    mes: number,
    estado: 'abierto' | 'cerrado',
  ): Promise<PeriodoContableDto> {
    if (
      !Number.isInteger(mes) ||
      mes < 1 ||
      mes > 12 ||
      ejercicio < 2000 ||
      ejercicio > 2100
    ) {
      throw new UnprocessableEntityException({
        code: 'FISCAL_PERIOD_INVALID',
        message: 'Período no válido: ejercicio 2000-2100 y mes 1-12',
      });
    }
    const companyId = this.dbs.getCompanyId();
    const userId = getRequestContext()?.userId ?? null;
    await this.dbs.db.transaction(async (tx) => {
      if (estado === 'abierto') {
        // Un mes de un ejercicio cerrado no se reabre: se revierte el cierre.
        await tx.execute(
          sql`select pg_advisory_xact_lock_shared(hashtext(${claveBloqueoEjercicio(companyId, ejercicio)}))`,
        );
        const [cerrado] = await tx
          .select({ id: fiscalYearClosings.id })
          .from(fiscalYearClosings)
          .where(
            and(
              eq(fiscalYearClosings.companyId, companyId),
              eq(fiscalYearClosings.year, ejercicio),
              eq(fiscalYearClosings.status, 'cerrado'),
            ),
          )
          .limit(1);
        if (cerrado) throw ejercicioCerrado(ejercicio);
      }
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`periodo:${companyId}:${ejercicio}:${mes}`}))`,
      );
      const [fila] = await tx
        .insert(fiscalPeriods)
        .values({
          companyId,
          year: ejercicio,
          month: mes,
          status: estado,
          closedAt: estado === 'cerrado' ? new Date() : null,
          closedBy: estado === 'cerrado' ? userId : null,
        })
        .onConflictDoUpdate({
          target: [
            fiscalPeriods.companyId,
            fiscalPeriods.year,
            fiscalPeriods.month,
          ],
          set: {
            status: estado,
            closedAt: estado === 'cerrado' ? new Date() : null,
            closedBy: estado === 'cerrado' ? userId : null,
            updatedAt: new Date(),
          },
        })
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'fiscal_period',
        entityId: fila.id,
        action: 'update',
        newData: { ejercicio, mes, estado },
      });
    });
    const lista = await this.periodos(ejercicio);
    return lista[mes - 1];
  }

  /**
   * Fija el estado de varios meses de un ejercicio dentro de la transacción
   * del cierre del ejercicio. Devuelve los meses que cambiaron de estado.
   */
  async fijarPeriodosEnTx(
    tx: Tx,
    companyId: string,
    ejercicio: number,
    meses: readonly number[],
    estado: 'abierto' | 'cerrado',
  ): Promise<number[]> {
    if (meses.length === 0) return [];
    const actuales = await tx
      .select({ month: fiscalPeriods.month, status: fiscalPeriods.status })
      .from(fiscalPeriods)
      .where(
        and(
          eq(fiscalPeriods.companyId, companyId),
          eq(fiscalPeriods.year, ejercicio),
        ),
      );
    const estadoDe = (m: number) =>
      actuales.find((a) => a.month === m)?.status ?? 'abierto';
    const cambian = meses.filter((m) => estadoDe(m) !== estado);
    if (cambian.length === 0) return [];
    const userId = getRequestContext()?.userId ?? null;
    const cerrado = estado === 'cerrado';
    await tx
      .insert(fiscalPeriods)
      .values(
        cambian.map((month) => ({
          companyId,
          year: ejercicio,
          month,
          status: estado,
          closedAt: cerrado ? new Date() : null,
          closedBy: cerrado ? userId : null,
        })),
      )
      .onConflictDoUpdate({
        target: [
          fiscalPeriods.companyId,
          fiscalPeriods.year,
          fiscalPeriods.month,
        ],
        set: {
          status: estado,
          closedAt: cerrado ? new Date() : null,
          closedBy: cerrado ? userId : null,
          updatedAt: new Date(),
        },
      });
    return cambian;
  }

  /**
   * Saldos (debe y haber) por cuenta y obra de los asientos de un ejercicio,
   * anulados y contra-asientos incluidos (se compensan entre sí).
   */
  async saldosEjercicio(
    ex: DbOrTx,
    companyId: string,
    ejercicio: number,
  ): Promise<
    {
      cuenta: string;
      nombre: string;
      projectId: string | null;
      debe: string;
      haber: string;
    }[]
  > {
    return ex
      .select({
        cuenta: ledgerAccounts.code,
        nombre: ledgerAccounts.name,
        projectId: journalEntryLines.projectId,
        debe: sql<string>`sum(${journalEntryLines.debit})`,
        haber: sql<string>`sum(${journalEntryLines.credit})`,
      })
      .from(journalEntryLines)
      .innerJoin(
        journalEntries,
        eq(journalEntries.id, journalEntryLines.entryId),
      )
      .innerJoin(
        ledgerAccounts,
        eq(ledgerAccounts.id, journalEntryLines.accountId),
      )
      .where(
        and(
          eq(journalEntryLines.companyId, companyId),
          eq(journalEntries.fiscalYear, ejercicio),
        ),
      )
      .groupBy(
        ledgerAccounts.code,
        ledgerAccounts.name,
        journalEntryLines.projectId,
      );
  }

  /* ─────────────────────────── interfaz contable ─────────────────────────── */

  /**
   * Sincroniza el libro con facturación y tesorería (idempotente):
   *  1. Contabiliza facturas aprobadas/pagadas/rectificadas sin asiento vivo.
   *  2. Anula los asientos de facturas que se anularon o borraron después.
   *  3. Contabiliza cada liquidación vigente (cobro o pago, total o parcial).
   *  4. Anula los asientos de liquidaciones anuladas.
   * Cada documento va en su propia transacción: un período cerrado omite
   * ese documento (se informa) sin bloquear el resto.
   */
  async contabilizarPendientes(): Promise<ResultadoInterfazDto> {
    const companyId = this.dbs.getCompanyId();
    const res: ResultadoInterfazDto = {
      contabilizados: 0,
      anulados: 0,
      omitidos: [],
    };
    await this.dbs.db.transaction((tx) => this.asegurarPlan(tx, companyId));

    const vivo = (origenes: OrigenAsiento[], ref: SQL) =>
      sql`exists (select 1 from ${journalEntries} je where je.company_id = ${companyId} and je.source in (${sql.join(
        origenes.map((o) => sql`${o}`),
        sql`, `,
      )}) and je.source_id = ${ref} and je.status = 'contabilizado' and je.reverses_id is null)`;

    // 1. Facturas pendientes de contabilizar.
    const facturas = await this.dbs.db
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          isNull(invoices.deletedAt),
          inArray(invoices.status, ['aprobada', 'pagada', 'rectificada']),
          sql`not ${vivo(['factura_venta', 'factura_compra'], sql`${invoices.id}`)}`,
        ),
      )
      .orderBy(asc(invoices.issueDate), asc(invoices.createdAt))
      .limit(LOTE_INTERFAZ);
    for (const { id } of facturas) {
      await this.procesar(res, 'factura_venta', id, async (tx) => {
        await this.contabilizarFactura(tx, companyId, id);
        res.contabilizados++;
      });
    }

    // 2. Asientos vivos de facturas anuladas o borradas.
    const facturasCaidas = await this.dbs.db
      .select({
        id: journalEntries.id,
        origenId: journalEntries.sourceId,
        origen: journalEntries.source,
      })
      .from(journalEntries)
      .innerJoin(invoices, eq(invoices.id, journalEntries.sourceId))
      .where(
        and(
          eq(journalEntries.companyId, companyId),
          inArray(journalEntries.source, ['factura_venta', 'factura_compra']),
          eq(journalEntries.status, 'contabilizado'),
          isNull(journalEntries.reversesId),
          sql`(${invoices.status} = 'anulada' or ${invoices.deletedAt} is not null)`,
        ),
      )
      .limit(LOTE_INTERFAZ);
    for (const e of facturasCaidas) {
      await this.procesar(
        res,
        e.origen as OrigenAsiento,
        e.origenId!,
        async (tx) => {
          await this.anularEnTx(
            tx,
            companyId,
            e.id,
            'factura anulada',
            todayIso(),
          );
          res.anulados++;
        },
      );
    }

    // 3. Liquidaciones vigentes (cobros y pagos, totales o parciales) sin asiento.
    const liquidaciones = await this.dbs.db
      .select({
        id: paymentSettlements.id,
        direction: paymentMilestones.direction,
      })
      .from(paymentSettlements)
      .innerJoin(
        paymentMilestones,
        eq(paymentMilestones.id, paymentSettlements.milestoneId),
      )
      .innerJoin(invoices, eq(invoices.id, paymentMilestones.invoiceId))
      .where(
        and(
          eq(paymentSettlements.companyId, companyId),
          eq(paymentSettlements.status, 'vigente'),
          isNull(invoices.deletedAt),
          sql`not ${vivo(['cobro', 'pago'], sql`${paymentSettlements.id}`)}`,
        ),
      )
      .orderBy(
        asc(paymentSettlements.settledOn),
        asc(paymentSettlements.createdAt),
      )
      .limit(LOTE_INTERFAZ);
    for (const l of liquidaciones) {
      await this.procesar(
        res,
        l.direction as OrigenAsiento,
        l.id,
        async (tx) => {
          await this.contabilizarLiquidacion(tx, companyId, l.id);
          res.contabilizados++;
        },
      );
    }

    // 4. Asientos vivos de liquidaciones anuladas (o de vencimientos borrados).
    const anuladas = await this.dbs.db
      .select({
        id: journalEntries.id,
        origenId: journalEntries.sourceId,
        origen: journalEntries.source,
      })
      .from(journalEntries)
      .leftJoin(
        paymentSettlements,
        eq(paymentSettlements.id, journalEntries.sourceId),
      )
      .where(
        and(
          eq(journalEntries.companyId, companyId),
          inArray(journalEntries.source, ['cobro', 'pago']),
          eq(journalEntries.status, 'contabilizado'),
          isNull(journalEntries.reversesId),
          sql`(${paymentSettlements.id} is null or ${paymentSettlements.status} = 'anulada')`,
        ),
      )
      .limit(LOTE_INTERFAZ);
    for (const e of anuladas) {
      await this.procesar(
        res,
        e.origen as OrigenAsiento,
        e.origenId!,
        async (tx) => {
          await this.anularEnTx(
            tx,
            companyId,
            e.id,
            'cobro o pago anulado',
            todayIso(),
          );
          res.anulados++;
        },
      );
    }
    return res;
  }

  /** Ejecuta un paso de la interfaz en su transacción; los rechazos de negocio se omiten. */
  private async procesar(
    res: ResultadoInterfazDto,
    origen: OrigenAsiento,
    origenId: string,
    paso: (tx: Tx) => Promise<void>,
  ): Promise<void> {
    try {
      await this.dbs.db.transaction(paso);
    } catch (e) {
      if (!(e instanceof HttpException) || e.getStatus() >= 500) throw e;
      const cuerpo = e.getResponse() as { message?: string } | string;
      res.omitidos.push({
        origen,
        origenId,
        motivo:
          typeof cuerpo === 'string' ? cuerpo : (cuerpo.message ?? e.message),
      });
    }
  }

  private async contabilizarFactura(tx: Tx, companyId: string, id: string) {
    const [f] = await tx
      .select({
        id: invoices.id,
        kind: invoices.kind,
        invoiceNumber: invoices.invoiceNumber,
        issueDate: invoices.issueDate,
        baseAmount: invoices.baseAmount,
        vatAmount: invoices.vatAmount,
        totalAmount: invoices.totalAmount,
        retentionAmount: invoices.retentionAmount,
        certSubcontrataId: invoices.certSubcontrataId,
        contactName: contacts.legalName,
      })
      .from(invoices)
      .innerJoin(contacts, eq(contacts.id, invoices.contactId))
      .where(and(eq(invoices.id, id), eq(invoices.companyId, companyId)))
      .limit(1);
    if (!f) return;
    const lineas = await tx
      .select({
        baseAmount: invoiceLines.baseAmount,
        projectId: invoiceLines.projectId,
      })
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, id))
      .orderBy(asc(invoiceLines.sortOrder));
    await this.contabilizar(tx, {
      companyId,
      fecha: f.issueDate,
      concepto: `${f.kind === 'venta' ? 'Factura emitida' : 'Factura recibida'} ${f.invoiceNumber} · ${f.contactName}`,
      origen: f.kind === 'venta' ? 'factura_venta' : 'factura_compra',
      origenId: f.id,
      lineas: asientoDesdeFactura({
        kind: f.kind,
        invoiceNumber: f.invoiceNumber,
        contactName: f.contactName,
        baseAmount: f.baseAmount,
        vatAmount: f.vatAmount,
        totalAmount: f.totalAmount,
        retentionAmount: f.retentionAmount,
        esSubcontrata: f.certSubcontrataId !== null,
        lineas,
      }),
    });
  }

  /** Asiento de una liquidación (cobro o pago, total o parcial) en su fecha. */
  private async contabilizarLiquidacion(tx: Tx, companyId: string, id: string) {
    const [l] = await tx
      .select({
        id: paymentSettlements.id,
        amount: paymentSettlements.amount,
        settledOn: paymentSettlements.settledOn,
        direction: paymentMilestones.direction,
        kind: paymentMilestones.kind,
        invoiceNumber: invoices.invoiceNumber,
        contactName: contacts.legalName,
      })
      .from(paymentSettlements)
      .innerJoin(
        paymentMilestones,
        eq(paymentMilestones.id, paymentSettlements.milestoneId),
      )
      .innerJoin(invoices, eq(invoices.id, paymentMilestones.invoiceId))
      .innerJoin(contacts, eq(contacts.id, invoices.contactId))
      .where(
        and(
          eq(paymentSettlements.id, id),
          eq(paymentSettlements.companyId, companyId),
        ),
      )
      .limit(1);
    if (!l) return;
    const lineas = asientoDesdeVencimiento({
      direction: l.direction,
      kind: l.kind,
      amount: l.amount,
      invoiceNumber: l.invoiceNumber,
      contactName: l.contactName,
    });
    if (lineas.length < 2) return;
    await this.contabilizar(tx, {
      companyId,
      fecha: l.settledOn,
      concepto: lineas[0].concepto,
      origen: l.direction,
      origenId: l.id,
      lineas,
    });
  }
}
