import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
} from 'drizzle-orm';
import {
  equipoAsignaciones,
  equipos,
  fixedAssetDepreciations,
  fixedAssets,
  mantenimientosEquipo,
  ordenesTrabajo,
  partesMaquinaria,
  projects,
} from '@erp/db';
import {
  centsToNumeric,
  costeExplotacion,
  daysBetween,
  diasEnRango,
  explotacionQuerySchema,
  fromCents,
  indicadoresDisponibilidad,
  mulDivRound,
  scaledToNumeric,
  sumCents,
  toCents,
  toScaled,
  type ExplotacionDto,
  type ExplotacionEquipoDto,
  type ExplotacionObraDto,
  type ExplotacionQuery,
} from '@erp/shared';
import { DbService } from '../db/db.service';
import { errorEam, reglaEam } from './comun';

/**
 * Disponibilidad y coste de explotación (TCO) por equipo y por obra en un
 * periodo, sin crear cargos ni asientos:
 *  - horas trabajadas y coste imputado: partes de maquinaria del equipo (es
 *    lo que ya está en el coste real de cada obra);
 *  - paradas y mantenimiento: órdenes cerradas en el periodo, más los
 *    mantenimientos sueltos sin orden (los generados por una orden no se
 *    vuelven a sumar);
 *  - amortización: la ya contabilizada del activo fijo del equipo (no se
 *    reasienta). Por obra, prorrateada por los días asignados a esa obra.
 */
@Injectable()
export class ExplotacionService {
  constructor(private readonly dbs: DbService) {}

  async explotacion(input: ExplotacionQuery): Promise<ExplotacionDto> {
    const q = explotacionQuerySchema.parse(input);
    if (q.hasta < q.desde || daysBetween(q.desde, q.hasta) > 366) {
      throw errorEam(
        'EAM_RANGE_INVALID',
        'El periodo debe ir de desde a hasta y no superar un año',
      );
    }
    const companyId = this.dbs.getCompanyId();
    const db = this.dbs.db;
    const obras = await this.dbs.getObrasAccesibles();
    if (obras !== null && (!q.projectId || !obras.includes(q.projectId))) {
      throw new ForbiddenException({
        code: 'PROJECT_ACCESS_DENIED',
        message: 'Elige una de tus obras',
      });
    }
    const obra = q.projectId ?? null;
    const diasPeriodo = daysBetween(q.desde, q.hasta) + 1;

    // Partes de maquinaria del periodo (por equipo y obra).
    const partes = await db
      .select({
        equipoId: partesMaquinaria.equipoId,
        projectId: partesMaquinaria.projectId,
        horas: sql<string>`coalesce(sum(${partesMaquinaria.hoursUsed}), 0)`,
        coste: sql<string>`coalesce(sum(${partesMaquinaria.totalCost}), 0)`,
      })
      .from(partesMaquinaria)
      .where(
        and(
          eq(partesMaquinaria.companyId, companyId),
          isNull(partesMaquinaria.deletedAt),
          gte(partesMaquinaria.workDate, q.desde),
          lte(partesMaquinaria.workDate, q.hasta),
          ...(obra ? [eq(partesMaquinaria.projectId, obra)] : []),
          ...(q.equipoId ? [eq(partesMaquinaria.equipoId, q.equipoId)] : []),
        ),
      )
      .groupBy(partesMaquinaria.equipoId, partesMaquinaria.projectId);

    // Órdenes cerradas en el periodo.
    const ordenes = await db
      .select({
        equipoId: ordenesTrabajo.equipoId,
        projectId: ordenesTrabajo.projectId,
        tipo: ordenesTrabajo.tipo,
        horasParada: ordenesTrabajo.horasParada,
        coste: ordenesTrabajo.costeTotal,
      })
      .from(ordenesTrabajo)
      .where(
        and(
          eq(ordenesTrabajo.companyId, companyId),
          eq(ordenesTrabajo.status, 'cerrada'),
          gte(ordenesTrabajo.fin, q.desde),
          lte(ordenesTrabajo.fin, q.hasta),
          ...(q.equipoId ? [eq(ordenesTrabajo.equipoId, q.equipoId)] : []),
        ),
      );

    const asignaciones = await db
      .select({
        equipoId: equipoAsignaciones.equipoId,
        projectId: equipoAsignaciones.projectId,
        desde: equipoAsignaciones.desde,
        hasta: equipoAsignaciones.hasta,
      })
      .from(equipoAsignaciones)
      .where(
        and(
          eq(equipoAsignaciones.companyId, companyId),
          lte(equipoAsignaciones.desde, q.hasta),
          sql`(${equipoAsignaciones.hasta} IS NULL OR ${equipoAsignaciones.hasta} >= ${q.desde})`,
          ...(q.equipoId ? [eq(equipoAsignaciones.equipoId, q.equipoId)] : []),
        ),
      );

    // Equipos del informe: con actividad o asignación (por obra: en esa obra).
    const ids = new Set<string>();
    for (const p of partes) if (p.equipoId) ids.add(p.equipoId);
    for (const a of asignaciones)
      if (!obra || a.projectId === obra) ids.add(a.equipoId);
    for (const o of ordenes)
      if (!obra || o.projectId === obra) ids.add(o.equipoId);
    if (q.equipoId) ids.add(q.equipoId);
    const lista = ids.size
      ? await db
          .select({
            id: equipos.id,
            nombre: equipos.nombre,
            codigo: equipos.codigo,
          })
          .from(equipos)
          .where(
            and(
              eq(equipos.companyId, companyId),
              inArray(equipos.id, [...ids]),
              isNull(equipos.deletedAt),
            ),
          )
      : [];
    const idsValidos = lista.map((e) => e.id);

    // Amortización contabilizada del activo de cada equipo, por meses del periodo.
    const amortizaciones = idsValidos.length
      ? await db
          .select({
            equipoId: fixedAssets.equipoId,
            total: sql<string>`coalesce(sum(${fixedAssetDepreciations.amount}), 0)`,
          })
          .from(fixedAssetDepreciations)
          .innerJoin(
            fixedAssets,
            eq(fixedAssets.id, fixedAssetDepreciations.assetId),
          )
          .where(
            and(
              inArray(fixedAssets.equipoId, idsValidos),
              isNotNull(fixedAssetDepreciations.journalEntryId),
              sql`make_date(${fixedAssetDepreciations.year}, ${fixedAssetDepreciations.month}, 1) BETWEEN date_trunc('month', ${q.desde}::date) AND ${q.hasta}::date`,
            ),
          )
          .groupBy(fixedAssets.equipoId)
      : [];
    const sueltos =
      idsValidos.length && !obra
        ? await db
            .select({
              equipoId: mantenimientosEquipo.equipoId,
              total: sql<string>`coalesce(sum(${mantenimientosEquipo.coste}), 0)`,
            })
            .from(mantenimientosEquipo)
            .where(
              and(
                inArray(mantenimientosEquipo.equipoId, idsValidos),
                isNull(mantenimientosEquipo.ordenTrabajoId),
                isNull(mantenimientosEquipo.deletedAt),
                gte(mantenimientosEquipo.fecha, q.desde),
                lte(mantenimientosEquipo.fecha, q.hasta),
              ),
            )
            .groupBy(mantenimientosEquipo.equipoId)
        : [];

    const equiposDto: ExplotacionEquipoDto[] = lista
      .map((e) => {
        const misPartes = partes.filter((p) => p.equipoId === e.id);
        const misOrdenes = ordenes.filter(
          (o) => o.equipoId === e.id && (!obra || o.projectId === obra),
        );
        const misAsig = asignaciones.filter(
          (a) => a.equipoId === e.id && (!obra || a.projectId === obra),
        );
        const diasAsignados = misAsig.reduce(
          (s, a) => s + diasEnRango(a, q.desde, q.hasta),
          0,
        );
        const horas = sumCents(misPartes.map((p) => toScaled(p.horas, 2)));
        const disp = reglaEam(() =>
          indicadoresDisponibilidad({
            // Por obra, el calendario son los días que estuvo en ella.
            dias: obra ? Math.min(diasAsignados, diasPeriodo) : diasPeriodo,
            jornadaHoras: q.jornadaHoras,
            horasTrabajadas: scaledToNumeric(horas, 2),
            paradas: misOrdenes.map((o) => ({
              horas: o.horasParada,
              correctiva: o.tipo === 'correctiva',
            })),
          }),
        );
        let amort = toCents(
          amortizaciones.find((a) => a.equipoId === e.id)?.total ?? '0',
        );
        // Por obra, la amortización del equipo se reparte por días asignados.
        if (obra)
          amort = mulDivRound(
            amort,
            BigInt(Math.min(diasAsignados, diasPeriodo)),
            BigInt(diasPeriodo),
          );
        const coste = costeExplotacion({
          amortizacion: centsToNumeric(amort),
          mantenimientoOrdenes: centsToNumeric(
            sumCents(misOrdenes.map((o) => toCents(o.coste))),
          ),
          mantenimientoSuelto:
            sueltos.find((s) => s.equipoId === e.id)?.total ?? '0',
          imputadoObras: centsToNumeric(
            sumCents(misPartes.map((p) => toCents(p.coste))),
          ),
          horasTrabajadas: scaledToNumeric(horas, 2),
        });
        return {
          ...disp,
          equipoId: e.id,
          nombre: e.nombre,
          codigo: e.codigo,
          diasAsignados,
          coste,
          ordenesCerradas: misOrdenes.length,
        };
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre));

    // Por obra: partes (ya en su coste real) y mantenimiento atribuido (analítico).
    const porObra = new Map<
      string,
      { horas: bigint; imputado: bigint; mant: bigint; equipos: Set<string> }
    >();
    const acc = (id: string) => {
      const v = porObra.get(id) ?? {
        horas: 0n,
        imputado: 0n,
        mant: 0n,
        equipos: new Set<string>(),
      };
      porObra.set(id, v);
      return v;
    };
    for (const p of partes) {
      const v = acc(p.projectId);
      v.horas += toScaled(p.horas, 2);
      v.imputado += toCents(p.coste);
      if (p.equipoId) v.equipos.add(p.equipoId);
    }
    for (const o of ordenes) {
      if (!o.projectId || (obra && o.projectId !== obra)) continue;
      const v = acc(o.projectId);
      v.mant += toCents(o.coste);
      v.equipos.add(o.equipoId);
    }
    const visibles = [...porObra.keys()].filter(
      (id) => obras === null || obras.includes(id),
    );
    const nombres = visibles.length
      ? await db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(inArray(projects.id, visibles))
      : [];
    const obrasDto: ExplotacionObraDto[] = visibles
      .map((id) => {
        const v = porObra.get(id)!;
        return {
          projectId: id,
          nombre: nombres.find((n) => n.id === id)?.name ?? '',
          horasTrabajadas: Number(scaledToNumeric(v.horas, 2)),
          imputado: fromCents(v.imputado),
          mantenimientoAtribuido: fromCents(v.mant),
          equipos: v.equipos.size,
        };
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre));

    const suma = (f: (e: ExplotacionEquipoDto) => number) =>
      fromCents(sumCents(equiposDto.map((e) => toCents(f(e)))));
    return {
      desde: q.desde,
      hasta: q.hasta,
      jornadaHoras: q.jornadaHoras,
      equipos: equiposDto,
      obras: obrasDto,
      totales: {
        horasTrabajadas: Number(
          scaledToNumeric(
            sumCents(equiposDto.map((e) => toScaled(e.horasTrabajadas, 2))),
            2,
          ),
        ),
        amortizacion: suma((e) => e.coste.amortizacion),
        mantenimiento: suma((e) => e.coste.mantenimiento),
        total: suma((e) => e.coste.total),
        imputadoObras: suma((e) => e.coste.imputadoObras),
        diferencia: suma((e) => e.coste.diferencia),
      },
    };
  }
}
