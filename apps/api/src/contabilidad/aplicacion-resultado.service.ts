import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  fiscalYearClosings,
  resultApplications,
  type DbOrTx,
  type ResultApplication,
} from '@erp/db';
import {
  CUENTAS_APLICACION_BENEFICIO,
  CUENTAS_APLICACION_PERDIDA,
  CUENTA_RESULTADO_EJERCICIO,
  aplicacionResultado,
  aplicacionResultadoAnularSchema,
  aplicacionResultadoSchema,
  centsToNumeric,
  cuentasAnuales,
  diferenciasAuditoria,
  fromCents,
  reservaLegalMinima,
  toCents,
  type AplicacionResultadoAnularInput,
  type AplicacionResultadoDto,
  type AplicacionResultadoInput,
  type CuentasAnualesDto,
  type EstadoAplicacionResultado,
  type PropuestaAplicacionResultadoDto,
  type SaldosPatrimonioNeto,
  type TipoCuenta,
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

const NOMBRES: Record<string, string> = {
  ...CUENTAS_APLICACION_PERDIDA,
  ...CUENTAS_APLICACION_BENEFICIO,
};

function dto(a: ResultApplication): AplicacionResultadoDto {
  const reparto = a.allocation as { cuenta: string; importe: string }[];
  return {
    id: a.id,
    ejercicio: a.year,
    estado: a.status as EstadoAplicacionResultado,
    resultado: fromCents(toCents(a.result)),
    fecha: a.applicationDate,
    acuerdo: a.agreement,
    reparto: reparto.map((r) => ({
      cuenta: r.cuenta,
      nombre: NOMBRES[r.cuenta] ?? r.cuenta,
      importe: fromCents(toCents(r.importe)),
    })),
    asientoId: a.journalEntryId,
    contraAsientoId: a.reversalEntryId,
    motivoAnulacion: a.cancelReason,
    version: a.version,
  };
}

/**
 * Aplicación del resultado (129) de un ejercicio cerrado y cuentas anuales.
 * La aplicación se contabiliza en el ejercicio siguiente (donde la apertura
 * dejó el saldo de 1290) por `contabilizarEnTx`, que respeta período y
 * ejercicio cerrados; se anula por contra-asiento. Revertir el cierre de un
 * ejercicio con el resultado aplicado responde FISCAL_YEAR_RESULT_APPLIED.
 */
@Injectable()
export class AplicacionResultadoService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly contabilidad: ContabilidadService,
  ) {}

  private async cierreVigente(
    ex: DbOrTx,
    companyId: string,
    ejercicio: number,
  ) {
    const [c] = await ex
      .select()
      .from(fiscalYearClosings)
      .where(
        and(
          eq(fiscalYearClosings.companyId, companyId),
          eq(fiscalYearClosings.year, ejercicio),
          eq(fiscalYearClosings.status, 'cerrado'),
        ),
      );
    return c;
  }

  async vigente(
    ex: DbOrTx,
    companyId: string,
    ejercicio: number,
  ): Promise<ResultApplication | undefined> {
    const [a] = await ex
      .select()
      .from(resultApplications)
      .where(
        and(
          eq(resultApplications.companyId, companyId),
          eq(resultApplications.year, ejercicio),
          eq(resultApplications.status, 'aplicado'),
        ),
      );
    return a;
  }

  /** Saldos de patrimonio neto tras la apertura del ejercicio siguiente. */
  private async saldosPn(
    ex: DbOrTx,
    companyId: string,
    ejercicio: number,
  ): Promise<SaldosPatrimonioNeto> {
    const s = await this.contabilidad.saldosAFecha(
      ex,
      companyId,
      `${ejercicio + 1}-01-01`,
      ['100', '1120', '1130', '1200', '1210'],
    );
    const acreedor = (pref: string) =>
      centsToNumeric(
        -[...s]
          .filter(([c]) => c.startsWith(pref))
          .reduce((t, [, v]) => t + v, 0n),
      );
    return {
      capital: acreedor('100'),
      reservaLegal: acreedor('1120'),
      reservasVoluntarias: acreedor('1130'),
      remanente: acreedor('1200'),
      negativosAnteriores: centsToNumeric(s.get('1210') ?? 0n),
    };
  }

  async propuesta(ejercicio: number): Promise<PropuestaAplicacionResultadoDto> {
    const companyId = this.dbs.getCompanyId();
    const [cierre, saldos, vig] = await Promise.all([
      this.cierreVigente(this.dbs.db, companyId, ejercicio),
      this.saldosPn(this.dbs.db, companyId, ejercicio),
      this.vigente(this.dbs.db, companyId, ejercicio),
    ]);
    const resultado = cierre ? fromCents(toCents(cierre.result)) : null;
    const destinos =
      resultado === null || resultado === 0
        ? []
        : Object.entries(
            resultado > 0
              ? CUENTAS_APLICACION_BENEFICIO
              : CUENTAS_APLICACION_PERDIDA,
          ).map(([cuenta, nombre]) => ({ cuenta, nombre }));
    const n = (v: string | number) => fromCents(toCents(v));
    return {
      ejercicio,
      resultado,
      cerrado: !!cierre,
      capital: n(saldos.capital),
      reservaLegal: n(saldos.reservaLegal),
      reservasVoluntarias: n(saldos.reservasVoluntarias),
      remanente: n(saldos.remanente),
      negativosAnteriores: n(saldos.negativosAnteriores),
      reservaLegalMinima: reservaLegalMinima({
        beneficio: resultado ?? 0,
        capital: saldos.capital,
        reservaLegal: saldos.reservaLegal,
      }),
      destinos,
      aplicacionVigente: vig ? dto(vig) : null,
    };
  }

  async aplicar(
    ejercicio: number,
    input: AplicacionResultadoInput,
  ): Promise<AplicacionResultadoDto> {
    const d = aplicacionResultadoSchema.parse(input);
    if (!d.fecha.startsWith(`${ejercicio + 1}-`)) {
      throw new UnprocessableEntityException({
        code: 'RESULT_APPLICATION_DATE_INVALID',
        message: `La aplicación del resultado de ${ejercicio} se contabiliza en ${ejercicio + 1}`,
      });
    }
    const companyId = this.dbs.getCompanyId();
    const id = randomUUID();
    await this.dbs.db.transaction(async (tx) => {
      // Compartido con los asientos y exclusivo frente a revertir el cierre.
      await tx.execute(
        sql`select pg_advisory_xact_lock_shared(hashtext(${claveBloqueoEjercicio(companyId, ejercicio)}))`,
      );
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`resultado:${companyId}:${ejercicio}`}))`,
      );
      const cierre = await this.cierreVigente(tx, companyId, ejercicio);
      if (!cierre) {
        throw new ConflictException({
          code: 'FISCAL_YEAR_NOT_CLOSED',
          message: `Cierra antes el ejercicio ${ejercicio}: el resultado se aplica tras el cierre`,
        });
      }
      if (await this.vigente(tx, companyId, ejercicio)) {
        throw new ConflictException({
          code: 'RESULT_ALREADY_APPLIED',
          message: `El resultado de ${ejercicio} ya está aplicado: anula la aplicación antes de repetirla`,
        });
      }
      const r = aplicacionResultado({
        resultado: cierre.result,
        reparto: d.reparto,
        saldos: await this.saldosPn(tx, companyId, ejercicio),
        cuentaResultado: CUENTA_RESULTADO_EJERCICIO,
      });
      if (!r.ok) {
        throw new UnprocessableEntityException({
          code: r.codigo,
          message: r.mensaje,
        });
      }
      const concepto = `Aplicación del resultado ${ejercicio}: ${d.acuerdo}`;
      const asiento = await this.contabilidad.contabilizarEnTx(tx, {
        companyId,
        fecha: d.fecha,
        concepto,
        origen: 'aplicacion_resultado',
        origenId: id,
        lineas: r.lineas.map((l) => ({ ...l, projectId: null, concepto })),
      });
      const [row] = await tx
        .insert(resultApplications)
        .values({
          id,
          companyId,
          year: ejercicio,
          result: cierre.result,
          applicationDate: d.fecha,
          agreement: d.acuerdo,
          allocation: d.reparto.map((x) => ({
            cuenta: x.cuenta,
            importe: centsToNumeric(toCents(x.importe)),
          })),
          journalEntryId: asiento.id,
          createdBy: getRequestContext()?.userId ?? null,
        })
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'result_application',
        entityId: id,
        action: 'create',
        oldData: { estado: 'pendiente', saldo1290: cierre.result },
        newData: {
          ...row,
          cambios: diferenciasAuditoria(
            { estado: 'pendiente' },
            { estado: 'aplicado', reparto: row.allocation },
          ),
        },
      });
    });
    const [a] = await this.dbs.db
      .select()
      .from(resultApplications)
      .where(eq(resultApplications.id, id));
    return dto(a);
  }

  async anular(
    ejercicio: number,
    input: AplicacionResultadoAnularInput,
    version: number | undefined,
  ): Promise<AplicacionResultadoDto> {
    const { motivo } = aplicacionResultadoAnularSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    let id = '';
    await this.dbs.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`resultado:${companyId}:${ejercicio}`}))`,
      );
      const a = await this.vigente(tx, companyId, ejercicio);
      if (!a) {
        throw new NotFoundException({
          code: 'RESULT_APPLICATION_NOT_FOUND',
          message: `El resultado de ${ejercicio} no tiene aplicación vigente`,
        });
      }
      id = a.id;
      verificarVersion(a.version, version);
      let contraId: string | null = null;
      if (a.journalEntryId) {
        const contra = await this.contabilidad.anularEnTx(
          tx,
          companyId,
          a.journalEntryId,
          `Anulación de la aplicación del resultado ${ejercicio}: ${motivo}`,
          undefined,
        );
        contraId = contra.id;
      }
      await cambiarEstado(
        tx,
        resultApplications,
        'result_application',
        a.id,
        'aplicado',
        'anulado',
        { cancelReason: motivo, reversalEntryId: contraId },
        version,
      );
      await this.audit.registrar(tx, {
        entityType: 'result_application',
        entityId: a.id,
        action: 'update',
        oldData: { status: 'aplicado' },
        newData: {
          status: 'anulado',
          motivo,
          contraAsientoId: contraId,
          cambios: diferenciasAuditoria(
            { status: 'aplicado' },
            { status: 'anulado' },
          ),
        },
      });
    });
    const [a] = await this.dbs.db
      .select()
      .from(resultApplications)
      .where(eq(resultApplications.id, id));
    return dto(a);
  }

  /**
   * Cuentas anuales del ejercicio: balance por masas y PyG con los saldos
   * antes del cierre (sin regularización ni cierre) y, si existe, la
   * aplicación del resultado.
   */
  async cuentasAnuales(ejercicio: number): Promise<CuentasAnualesDto> {
    const companyId = this.dbs.getCompanyId();
    const [filas, cierre, aplicacion] = await Promise.all([
      this.contabilidad.saldosEjercicio(this.dbs.db, companyId, ejercicio, {
        sinCierre: true,
      }),
      this.cierreVigente(this.dbs.db, companyId, ejercicio),
      this.vigente(this.dbs.db, companyId, ejercicio),
    ]);
    // Por cuenta (la obra no es dimensión de las cuentas anuales).
    const porCuenta = new Map<
      string,
      {
        cuenta: string;
        nombre: string;
        tipo: TipoCuenta;
        debe: bigint;
        haber: bigint;
      }
    >();
    for (const f of filas) {
      const a = porCuenta.get(f.cuenta) ?? {
        cuenta: f.cuenta,
        nombre: f.nombre,
        tipo: f.tipo as TipoCuenta,
        debe: 0n,
        haber: 0n,
      };
      a.debe += toCents(f.debe);
      a.haber += toCents(f.haber);
      porCuenta.set(f.cuenta, a);
    }
    return {
      ejercicio,
      fecha: `${ejercicio}-12-31`,
      cerrado: !!cierre,
      aplicacion: aplicacion ? dto(aplicacion) : null,
      ...cuentasAnuales(
        [...porCuenta.values()].map((a) => ({
          ...a,
          debe: centsToNumeric(a.debe),
          haber: centsToNumeric(a.haber),
        })),
      ),
    };
  }
}
