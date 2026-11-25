import { createHash, randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  companies,
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
  cuentasAnualesACsv,
  cuentasAnualesAJson,
  memoriaAbreviada,
  movimientoMasa,
  type FormatoExportacionCuentas,
  diferenciasAuditoria,
  estadoCambiosPatrimonioNeto,
  estadoFlujosEfectivo,
  fechaLimiteAplicacion,
  situacionPatrimonial,
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
      // Masas de patrimonio neto del PGC (10x-13x), 129 incluida.
      ['10', '11', '12', '13'],
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
      patrimonioNeto: centsToNumeric(
        -[...s.values()].reduce((t, v) => t + v, 0n),
      ),
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
    const minima = reservaLegalMinima({
      beneficio: resultado ?? 0,
      capital: saldos.capital,
      reservaLegal: saldos.reservaLegal,
    });
    const pn = toCents(saldos.patrimonioNeto ?? 0);
    const capital = toCents(saldos.capital);
    // Dividendo máximo: lo que queda tras la reserva legal y las pérdidas
    // pendientes, sin dejar el PN por debajo del capital (art. 273.2 LSC).
    const libre =
      toCents(resultado ?? 0) -
      toCents(minima) -
      (toCents(saldos.negativosAnteriores) > 0n
        ? toCents(saldos.negativosAnteriores)
        : 0n);
    const holgura = pn - capital;
    const dividendoMaximo = [libre, holgura].reduce((a, b) => (a < b ? a : b));
    return {
      ejercicio,
      resultado,
      cerrado: !!cierre,
      capital: n(saldos.capital),
      reservaLegal: n(saldos.reservaLegal),
      reservasVoluntarias: n(saldos.reservasVoluntarias),
      remanente: n(saldos.remanente),
      negativosAnteriores: n(saldos.negativosAnteriores),
      reservaLegalMinima: minima,
      fechaLimite: fechaLimiteAplicacion(ejercicio),
      patrimonioNeto: fromCents(pn),
      situacionPatrimonial: situacionPatrimonial({
        patrimonioNeto: centsToNumeric(pn),
        capital: saldos.capital,
      }),
      dividendoMaximo: fromCents(dividendoMaximo > 0n ? dividendoMaximo : 0n),
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
        plazo: {
          ejercicio,
          fecha: d.fecha,
          aceptarFueraDePlazo: d.aceptarFueraDePlazo,
        },
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
          outOfTerm: d.fecha > fechaLimiteAplicacion(ejercicio),
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
    const [filas, cierre, aplicacion, movimientos] = await Promise.all([
      this.contabilidad.saldosEjercicio(this.dbs.db, companyId, ejercicio, {
        sinCierre: true,
      }),
      this.cierreVigente(this.dbs.db, companyId, ejercicio),
      this.vigente(this.dbs.db, companyId, ejercicio),
      this.contabilidad.movimientosPorOrigen(this.dbs.db, companyId, ejercicio),
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
    const anuales = cuentasAnuales(
      [...porCuenta.values()].map((a) => ({
        ...a,
        debe: centsToNumeric(a.debe),
        haber: centsToNumeric(a.haber),
      })),
    );
    // ECPN: cuentas de patrimonio neto, sin regularización ni cierre.
    const pnMovs = movimientos.filter(
      (m) => m.tipo === 'patrimonio' && m.origen !== 'cierre',
    );
    // Dividendos acordados en el ejercicio: abonos netos a 5260 por la
    // aplicación del resultado (los contra-asientos los compensan).
    const dividendos = movimientos
      .filter((m) => m.cuenta.startsWith('526') && m.origen === 'aplicacion')
      .reduce((t, m) => t + toCents(m.haber) - toCents(m.debe), 0n);
    const ecpn = estadoCambiosPatrimonioNeto({
      movimientos: pnMovs.map((m) => ({
        cuenta: m.cuenta,
        origen:
          m.origen === 'apertura' || m.origen === 'aplicacion'
            ? m.origen
            : 'otro',
        debe: m.debe,
        haber: m.haber,
      })),
      resultadoEjercicio: anuales.pyg.resultado,
      dividendos: centsToNumeric(dividendos),
    });
    // EFE: movimientos sin apertura ni cierre; efectivo inicial = 57x de la apertura.
    const efectivoInicial = movimientos
      .filter((m) => m.cuenta.startsWith('57') && m.origen === 'apertura')
      .reduce((t, m) => t + toCents(m.debe) - toCents(m.haber), 0n);
    const efe = estadoFlujosEfectivo({
      movimientos: movimientos.filter(
        (m) => m.origen !== 'apertura' && m.origen !== 'cierre',
      ),
      efectivoInicial: centsToNumeric(efectivoInicial),
    });
    // Memoria abreviada: movimientos de las masas que desglosa y garantías.
    const sinCierre = movimientos.map((m) => ({
      ...m,
      origen:
        m.origen === 'cierre'
          ? ('cierre' as const)
          : m.origen === 'apertura'
            ? ('apertura' as const)
            : ('otro' as const),
    }));
    const aplicacionDto = aplicacion ? dto(aplicacion) : null;
    const capital = anuales.balance.patrimonioNeto.cuentas
      .filter((c) => c.cuenta.startsWith('10'))
      .reduce((t, c) => t + toCents(c.importe), 0n);
    const memoria = memoriaAbreviada({
      empresa: await this.nombreEmpresa(companyId),
      ejercicio,
      cuentas: anuales,
      ecpn,
      efe,
      aplicacion: aplicacionDto,
      inmovilizado: movimientoMasa(
        sinCierre,
        (c) => c.startsWith('2') && !c.startsWith('28') && !c.startsWith('29'),
        'deudora',
      ),
      amortizacionAcumulada: movimientoMasa(
        sinCierre,
        (c) => c.startsWith('28'),
        'acreedora',
      ),
      provisiones: movimientoMasa(
        sinCierre,
        (c) => c.startsWith('14') || c.startsWith('499'),
        'acreedora',
      ),
      garantias: await this.garantiasAFecha(companyId, ejercicio),
      capital: centsToNumeric(capital),
    });
    return {
      ejercicio,
      fecha: `${ejercicio}-12-31`,
      cerrado: !!cierre,
      aplicacion: aplicacionDto,
      ...anuales,
      ecpn: {
        ...ecpn,
        cuadraConBalance:
          toCents(ecpn.saldoFinal.total) ===
          toCents(anuales.balance.patrimonioNeto.total),
      },
      efe,
      memoria,
    };
  }

  private async nombreEmpresa(companyId: string): Promise<string> {
    const [c] = await this.dbs.db
      .select({ nombre: companies.name })
      .from(companies)
      .where(eq(companies.id, companyId));
    return c?.nombre ?? 'La sociedad';
  }

  /**
   * Avales vivos al 31-12 del ejercicio (saldo del último movimiento hasta
   * esa fecha) y comisiones devengadas en el ejercicio, para la nota de
   * garantías comprometidas con terceros.
   */
  private async garantiasAFecha(companyId: string, ejercicio: number) {
    const fecha = `${ejercicio}-12-31`;
    const r = await this.dbs.db.execute(sql`
      with saldos as (
        select distinct on (g.id) g.direction, mv.outstanding_after as saldo
        from bank_guarantees g
        join bank_guarantee_movements mv on mv.guarantee_id = g.id
        where g.company_id = ${companyId} and g.status <> 'anulado'
          and mv.movement_date <= ${fecha}
        order by g.id, mv.movement_date desc, mv.created_at desc)
      select
        count(*) filter (where direction = 'emitido' and saldo > 0)::int as emitidos,
        coalesce(sum(saldo) filter (where direction = 'emitido'), 0)::text as saldo_emitidos,
        count(*) filter (where direction = 'recibido' and saldo > 0)::int as recibidos,
        coalesce(sum(saldo) filter (where direction = 'recibido'), 0)::text as saldo_recibidos,
        (select coalesce(sum(amount), 0)::text from bank_guarantee_accruals
          where company_id = ${companyId} and year = ${ejercicio}
            and status = 'contabilizado') as devengado
      from saldos`);
    const f = r.rows[0] as {
      emitidos: number;
      saldo_emitidos: string;
      recibidos: number;
      saldo_recibidos: string;
      devengado: string;
    };
    return {
      emitidosNumero: Number(f.emitidos),
      emitidosSaldoVivo: f.saldo_emitidos,
      recibidosNumero: Number(f.recibidos),
      recibidosSaldoVivo: f.saldo_recibidos,
      comisionesDevengadas: f.devengado,
    };
  }

  /**
   * Exportación de las cuentas anuales (balance, PyG, ECPN, EFE y memoria):
   * CSV (`;`, BOM UTF-8) o JSON canónico. Determinista: se devuelve también
   * la huella SHA-256 del contenido, que queda en la auditoría como evidencia.
   */
  async exportar(
    ejercicio: number,
    formato: FormatoExportacionCuentas,
  ): Promise<{
    body: string;
    contentType: string;
    fileName: string;
    sha256: string;
  }> {
    const ca = await this.cuentasAnuales(ejercicio);
    const texto =
      formato === 'csv' ? cuentasAnualesACsv(ca) : cuentasAnualesAJson(ca);
    const sha256 = createHash('sha256').update(texto, 'utf8').digest('hex');
    await this.dbs.db.transaction((tx) =>
      this.audit.registrar(tx, {
        entityType: 'annual_accounts',
        entityId: this.dbs.getCompanyId(),
        action: 'export',
        meta: { ejercicio, formato, sha256, coherente: ca.memoria.coherente },
      }),
    );
    return {
      body: formato === 'csv' ? `\uFEFF${texto}` : texto,
      contentType:
        formato === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/json; charset=utf-8',
      fileName: `cuentas-anuales-${ejercicio}.${formato}`,
      sha256,
    };
  }
}
