import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  fiscalYearClosings,
  journalEntries,
  type DbOrTx,
  type FiscalYearClosing,
  type Tx,
} from '@erp/db';
import {
  CUENTA_RESULTADO_EJERCICIO,
  asientosCierreEjercicio,
  cierreEjercicioRevertirSchema,
  diferenciasAuditoria,
  fromCents,
  toCents,
  centsToNumeric,
  todayIso,
  type AsientoCierrePropuestoDto,
  type AsientosCierreEjercicio,
  type CierreEjercicioDto,
  type CierreEjercicioRevertirInput,
  type EstadoCierreEjercicio,
  type LineaCierre,
  type OrigenAsiento,
  type PropuestaCierreEjercicioDto,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { cambiarEstado } from '../common/cambiar-estado';
import { getRequestContext } from '../common/request-context';
import { verificarVersion } from '../common/version';
import { DbService } from '../db/db.service';
import {
  ContabilidadService,
  claveBloqueoEjercicio,
} from './contabilidad.service';

const MESES = Array.from({ length: 12 }, (_, i) => i + 1);

function dto(c: FiscalYearClosing): CierreEjercicioDto {
  return {
    id: c.id,
    ejercicio: c.year,
    estado: c.status as EstadoCierreEjercicio,
    resultado: fromCents(toCents(c.result)),
    ingresos: fromCents(toCents(c.income)),
    gastos: fromCents(toCents(c.expenses)),
    asientoRegularizacionId: c.regularizationEntryId,
    asientoCierreId: c.closingEntryId,
    asientoAperturaId: c.openingEntryId,
    mesesCerrados: (c.closedMonths as number[]) ?? [],
    cerradoEn: c.closedAt.toISOString(),
    motivoReversion: c.reversalReason,
    revertidoEn: c.reversedAt?.toISOString() ?? null,
    version: c.version,
  };
}

interface Calculo {
  asientos: AsientosCierreEjercicio | null;
  nombres: Map<string, string>;
  descuadre: string | null;
}

/**
 * Cierre y apertura del ejercicio (PGC), al estilo de SAP FI-GL y Oracle GL.
 * En una transacción con el ejercicio bloqueado en exclusiva (los asientos
 * normales lo toman compartido, así que ninguno se cuela durante el cálculo):
 *  1. regularización de los grupos 6 y 7 contra 1290 (31-12);
 *  2. cierre de las cuentas de balance, 1290 incluida (31-12);
 *  3. apertura del ejercicio siguiente con los saldos invertidos (01-01);
 *  4. cierre de los meses aún abiertos y bloqueo del ejercicio
 *     (FISCAL_YEAR_CLOSED en cualquier asiento posterior).
 * Se revierte solo el último ejercicio cerrado, por contra-asientos de los
 * tres, reabriendo los meses que cerró.
 */
@Injectable()
export class CierreEjercicioService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly contabilidad: ContabilidadService,
  ) {}

  private async vigente(
    ex: DbOrTx,
    companyId: string,
    ejercicio: number,
  ): Promise<FiscalYearClosing | undefined> {
    const [c] = await ex
      .select()
      .from(fiscalYearClosings)
      .where(
        and(
          eq(fiscalYearClosings.companyId, companyId),
          eq(fiscalYearClosings.year, ejercicio),
          eq(fiscalYearClosings.status, 'cerrado'),
        ),
      )
      .limit(1);
    return c;
  }

  private async calcular(
    ex: DbOrTx,
    companyId: string,
    ejercicio: number,
  ): Promise<Calculo> {
    const saldos = await this.contabilidad.saldosEjercicio(
      ex,
      companyId,
      ejercicio,
    );
    const nombres = new Map(saldos.map((s) => [s.cuenta, s.nombre]));
    nombres.set(
      CUENTA_RESULTADO_EJERCICIO,
      nombres.get(CUENTA_RESULTADO_EJERCICIO) ?? 'Resultado del ejercicio',
    );
    try {
      return {
        asientos: asientosCierreEjercicio(saldos, CUENTA_RESULTADO_EJERCICIO),
        nombres,
        descuadre: null,
      };
    } catch (e) {
      if (e instanceof RangeError) {
        return { asientos: null, nombres, descuadre: e.message };
      }
      throw e;
    }
  }

  /** Impedimentos para cerrar ahora (vacío: se puede). */
  private async impedimentos(
    ex: DbOrTx,
    companyId: string,
    ejercicio: number,
    calculo: Calculo,
  ): Promise<{ code: string; message: string }[]> {
    const out: { code: string; message: string }[] = [];
    if (todayIso() <= `${ejercicio}-12-31`) {
      out.push({
        code: 'FISCAL_YEAR_NOT_ENDED',
        message: `El ejercicio ${ejercicio} aún no ha terminado (31-12-${ejercicio})`,
      });
    }
    if (await this.vigente(ex, companyId, ejercicio)) {
      out.push({
        code: 'FISCAL_YEAR_ALREADY_CLOSED',
        message: `El ejercicio ${ejercicio} ya está cerrado`,
      });
    }
    const [anterior] = await ex
      .select({ n: sql<number>`count(*)::int` })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.companyId, companyId),
          eq(journalEntries.fiscalYear, ejercicio - 1),
        ),
      );
    if (anterior.n > 0 && !(await this.vigente(ex, companyId, ejercicio - 1))) {
      out.push({
        code: 'FISCAL_YEAR_PREVIOUS_OPEN',
        message: `Cierra antes el ejercicio ${ejercicio - 1}, que tiene asientos`,
      });
    }
    if (calculo.descuadre) {
      out.push({ code: 'FISCAL_YEAR_UNBALANCED', message: calculo.descuadre });
    }
    return out;
  }

  private propuestoDto(
    fecha: string,
    lineas: LineaCierre[],
    nombres: Map<string, string>,
  ): AsientoCierrePropuestoDto {
    return {
      fecha,
      lineas: lineas.map((l) => ({
        ...l,
        nombreCuenta: nombres.get(l.cuenta) ?? null,
      })),
      total: fromCents(lineas.reduce((t, l) => t + toCents(l.debe), 0n)),
    };
  }

  /* ─────────────────────────── consultas ─────────────────────────── */

  async listar(): Promise<CierreEjercicioDto[]> {
    const filas = await this.dbs.db
      .select()
      .from(fiscalYearClosings)
      .where(eq(fiscalYearClosings.companyId, this.dbs.getCompanyId()))
      .orderBy(asc(fiscalYearClosings.year), asc(fiscalYearClosings.closedAt));
    return filas.map(dto);
  }

  /** Vista previa: los tres asientos, el resultado y los impedimentos. */
  async propuesta(ejercicio: number): Promise<PropuestaCierreEjercicioDto> {
    const companyId = this.dbs.getCompanyId();
    const calculo = await this.calcular(this.dbs.db, companyId, ejercicio);
    const imp = await this.impedimentos(
      this.dbs.db,
      companyId,
      ejercicio,
      calculo,
    );
    const a = calculo.asientos;
    const fechaCierre = `${ejercicio}-12-31`;
    const fechaApertura = `${ejercicio + 1}-01-01`;
    const vig = await this.vigente(this.dbs.db, companyId, ejercicio);
    return {
      ejercicio,
      fechaCierre,
      fechaApertura,
      ingresos: a?.ingresos ?? 0,
      gastos: a?.gastos ?? 0,
      resultado: a?.resultado ?? 0,
      regularizacion: this.propuestoDto(
        fechaCierre,
        a?.regularizacion ?? [],
        calculo.nombres,
      ),
      cierre: this.propuestoDto(fechaCierre, a?.cierre ?? [], calculo.nombres),
      apertura: this.propuestoDto(
        fechaApertura,
        a?.apertura ?? [],
        calculo.nombres,
      ),
      impedimentos: imp,
      cierreVigente: vig ? dto(vig) : null,
    };
  }

  /* ─────────────────────────── cerrar ─────────────────────────── */

  private async asiento(
    tx: Tx,
    companyId: string,
    fecha: string,
    concepto: string,
    origen: OrigenAsiento,
    origenId: string,
    lineas: LineaCierre[],
  ): Promise<string | null> {
    if (lineas.length === 0) return null;
    const a = await this.contabilidad.contabilizarEnTx(tx, {
      companyId,
      fecha,
      concepto,
      origen,
      origenId,
      cierreEjercicio: true,
      lineas: lineas.map((l) => ({
        cuenta: l.cuenta,
        debe: l.debe,
        haber: l.haber,
        projectId: l.projectId,
        concepto,
      })),
    });
    return a.id;
  }

  async cerrar(ejercicio: number): Promise<CierreEjercicioDto> {
    const companyId = this.dbs.getCompanyId();
    const id = randomUUID();
    await this.dbs.db.transaction(async (tx) => {
      // Exclusivo: espera a los asientos en curso y frena los nuevos.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${claveBloqueoEjercicio(companyId, ejercicio)}))`,
      );
      const calculo = await this.calcular(tx, companyId, ejercicio);
      const [primero] = await this.impedimentos(
        tx,
        companyId,
        ejercicio,
        calculo,
      );
      if (primero) {
        throw primero.code === 'FISCAL_YEAR_UNBALANCED'
          ? new UnprocessableEntityException(primero)
          : new ConflictException(primero);
      }
      const a = calculo.asientos!;
      const fechaCierre = `${ejercicio}-12-31`;
      const regularizacionId = await this.asiento(
        tx,
        companyId,
        fechaCierre,
        `Regularización del ejercicio ${ejercicio}`,
        'regularizacion_ejercicio',
        id,
        a.regularizacion,
      );
      const cierreId = await this.asiento(
        tx,
        companyId,
        fechaCierre,
        `Cierre del ejercicio ${ejercicio}`,
        'cierre_ejercicio',
        id,
        a.cierre,
      );
      const aperturaId = await this.asiento(
        tx,
        companyId,
        `${ejercicio + 1}-01-01`,
        `Apertura del ejercicio ${ejercicio + 1}`,
        'apertura_ejercicio',
        id,
        a.apertura,
      );
      const meses = await this.contabilidad.fijarPeriodosEnTx(
        tx,
        companyId,
        ejercicio,
        MESES,
        'cerrado',
      );
      const ingresos = toCents(a.ingresos);
      const gastos = toCents(a.gastos);
      const [row] = await tx
        .insert(fiscalYearClosings)
        .values({
          id,
          companyId,
          year: ejercicio,
          income: centsToNumeric(ingresos),
          expenses: centsToNumeric(gastos),
          result: centsToNumeric(ingresos - gastos),
          regularizationEntryId: regularizacionId,
          closingEntryId: cierreId,
          openingEntryId: aperturaId,
          closedMonths: meses,
          closedBy: getRequestContext()?.userId ?? null,
        })
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'fiscal_year_closing',
        entityId: id,
        action: 'create',
        newData: {
          ...row,
          cambios: diferenciasAuditoria(
            { estado: 'abierto' },
            { estado: 'cerrado', resultado: row.result, meses },
          ),
        },
      });
    });
    const [c] = await this.dbs.db
      .select()
      .from(fiscalYearClosings)
      .where(eq(fiscalYearClosings.id, id));
    return dto(c);
  }

  /* ─────────────────────────── revertir ─────────────────────────── */

  async revertir(
    ejercicio: number,
    input: CierreEjercicioRevertirInput,
    version: number | undefined,
  ): Promise<CierreEjercicioDto> {
    const { motivo } = cierreEjercicioRevertirSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    let id = '';
    await this.dbs.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${claveBloqueoEjercicio(companyId, ejercicio)}))`,
      );
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${claveBloqueoEjercicio(companyId, ejercicio + 1)}))`,
      );
      const c = await this.vigente(tx, companyId, ejercicio);
      if (!c) {
        throw new ConflictException({
          code: 'FISCAL_YEAR_NOT_CLOSED',
          message: `El ejercicio ${ejercicio} no está cerrado`,
        });
      }
      id = c.id;
      if (await this.vigente(tx, companyId, ejercicio + 1)) {
        throw new ConflictException({
          code: 'FISCAL_YEAR_NOT_LATEST',
          message: `Revierte antes el cierre de ${ejercicio + 1}: solo se revierte el último ejercicio cerrado`,
        });
      }
      verificarVersion(c.version, version);
      // Contra-asientos en orden inverso: apertura, cierre, regularización.
      const texto = `Reversión del cierre ${ejercicio}: ${motivo}`;
      for (const asiento of [
        c.openingEntryId,
        c.closingEntryId,
        c.regularizationEntryId,
      ]) {
        if (!asiento) continue;
        await this.contabilidad.anularEnTx(
          tx,
          companyId,
          asiento,
          texto,
          undefined,
          undefined,
          true,
        );
      }
      const reabiertos = await this.contabilidad.fijarPeriodosEnTx(
        tx,
        companyId,
        ejercicio,
        (c.closedMonths as number[]) ?? [],
        'abierto',
      );
      const userId = getRequestContext()?.userId ?? null;
      await cambiarEstado(
        tx,
        fiscalYearClosings,
        'fiscal_year_closing',
        c.id,
        'cerrado',
        'revertido',
        {
          reversalReason: motivo,
          reversedAt: new Date(),
          reversedBy: userId,
        },
        version,
      );
      await this.audit.registrar(tx, {
        entityType: 'fiscal_year_closing',
        entityId: c.id,
        action: 'update',
        oldData: { status: 'cerrado', version: c.version },
        newData: {
          status: 'revertido',
          motivo,
          mesesReabiertos: reabiertos,
          cambios: diferenciasAuditoria(
            { estado: 'cerrado' },
            { estado: 'revertido' },
          ),
        },
      });
    });
    const [c] = await this.dbs.db
      .select()
      .from(fiscalYearClosings)
      .where(eq(fiscalYearClosings.id, id));
    return dto(c);
  }
}
