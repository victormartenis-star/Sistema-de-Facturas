import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, eq, inArray, sql, SQL } from 'drizzle-orm';
import {
  equipos,
  fixedAssetDepreciations,
  fixedAssets,
  projects,
  type FixedAsset,
  type Tx,
} from '@erp/db';
import {
  CUENTAS_ACTIVO,
  CUENTAS_BAJA,
  activoBajaSchema,
  activoCreateSchema,
  activoUpdateSchema,
  amortizarSchema,
  centsToNumeric,
  clavePeriodo,
  cuadroAmortizacion,
  fromCents,
  resultadoBaja,
  sumCents,
  toCents,
  type ActivoBajaInput,
  type ActivoCreateInput,
  type ActivoDetalleDto,
  type ActivoDto,
  type ActivoUpdateInput,
  type AmortizarInput,
  type CategoriaActivo,
  type EstadoActivo,
  type LineaPropuesta,
  type ResultadoAmortizacionDto,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { cambiarEstado } from '../common/cambiar-estado';
import { getRequestContext } from '../common/request-context';
import { verificarVersion } from '../common/version';
import { ContabilidadService } from '../contabilidad/contabilidad.service';
import { DbService } from '../db/db.service';

interface Acumulado {
  total: string;
  ultimo: string | null;
}

function activoNoEncontrado(): NotFoundException {
  return new NotFoundException({
    code: 'ASSET_NOT_FOUND',
    message: 'Activo no encontrado',
  });
}

function aDto(a: FixedAsset, acc: Acumulado): ActivoDto {
  const acumulada = toCents(acc.total);
  return {
    id: a.id,
    codigo: a.code,
    nombre: a.name,
    categoria: a.category as CategoriaActivo,
    equipoId: a.equipoId,
    projectId: a.projectId,
    fechaAdquisicion: a.acquisitionDate,
    fechaInicio: a.startDate,
    coste: Number(a.cost),
    valorResidual: Number(a.residualValue),
    vidaUtilMeses: a.usefulLifeMonths,
    estado: a.status as EstadoActivo,
    amortizacionAcumulada: fromCents(acumulada),
    valorNeto: fromCents(toCents(a.cost) - acumulada),
    amortizadoHasta: acc.ultimo,
    fechaBaja: a.disposalDate,
    importeVenta: a.disposalAmount === null ? null : Number(a.disposalAmount),
    motivoBaja: a.disposalReason,
    notas: a.notes,
    version: a.version,
  };
}

/**
 * Activos fijos y amortización (SAP FI-AA / Oracle Assets, PGC).
 * Contabiliza a través de `ContabilidadService.contabilizarEnTx`, así que
 * cuadre, cuentas, períodos cerrados y numeración son los del libro mayor.
 */
@Injectable()
export class ActivosService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly contabilidad: ContabilidadService,
  ) {}

  /** Acumulado y último período contabilizado por activo (una consulta). */
  private async acumulados(ids: string[]): Promise<Map<string, Acumulado>> {
    if (ids.length === 0) return new Map();
    const filas = await this.dbs.db
      .select({
        assetId: fixedAssetDepreciations.assetId,
        total: sql<string>`coalesce(sum(${fixedAssetDepreciations.amount}), 0)`,
        ultimo: sql<
          string | null
        >`max(${fixedAssetDepreciations.year}::text || '-' || lpad(${fixedAssetDepreciations.month}::text, 2, '0'))`,
      })
      .from(fixedAssetDepreciations)
      .where(inArray(fixedAssetDepreciations.assetId, ids))
      .groupBy(fixedAssetDepreciations.assetId);
    return new Map(
      filas.map((f) => [f.assetId, { total: f.total, ultimo: f.ultimo }]),
    );
  }

  async listar(f: {
    estado?: EstadoActivo;
    categoria?: CategoriaActivo;
    q?: string;
  }) {
    const companyId = this.dbs.getCompanyId();
    const filtros: SQL[] = [eq(fixedAssets.companyId, companyId)];
    if (f.estado) filtros.push(eq(fixedAssets.status, f.estado));
    if (f.categoria) filtros.push(eq(fixedAssets.category, f.categoria));
    if (f.q) {
      const patron = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      filtros.push(
        sql`(${fixedAssets.code} ILIKE ${patron} OR ${fixedAssets.name} ILIKE ${patron})`,
      );
    }
    const filas = await this.dbs.db
      .select()
      .from(fixedAssets)
      .where(and(...filtros))
      .orderBy(asc(fixedAssets.code));
    const acc = await this.acumulados(filas.map((a) => a.id));
    return filas.map((a) =>
      aDto(a, acc.get(a.id) ?? { total: '0', ultimo: null }),
    );
  }

  private async cargar(id: string): Promise<FixedAsset> {
    const [a] = await this.dbs.db
      .select()
      .from(fixedAssets)
      .where(
        and(
          eq(fixedAssets.id, id),
          eq(fixedAssets.companyId, this.dbs.getCompanyId()),
        ),
      )
      .limit(1);
    if (!a) throw activoNoEncontrado();
    return a;
  }

  async detalle(id: string): Promise<ActivoDetalleDto> {
    const a = await this.cargar(id);
    const cuotas = await this.dbs.db
      .select()
      .from(fixedAssetDepreciations)
      .where(eq(fixedAssetDepreciations.assetId, id));
    const porPeriodo = new Map(
      cuotas.map((c) => [clavePeriodo(c.year, c.month), c]),
    );
    const acc = (await this.acumulados([id])).get(id) ?? {
      total: '0',
      ultimo: null,
    };
    return {
      ...aDto(a, acc),
      cuadro: cuadroAmortizacion({
        coste: a.cost,
        residual: a.residualValue,
        vidaMeses: a.usefulLifeMonths,
        inicio: a.startDate,
      }).map((c) => {
        const hecha = porPeriodo.get(clavePeriodo(c.ejercicio, c.mes));
        return {
          ejercicio: c.ejercicio,
          mes: c.mes,
          importe: c.cuota,
          acumulada: c.acumulada,
          valorNeto: c.valorNeto,
          contabilizada: Boolean(hecha),
          asientoId: hecha?.journalEntryId ?? null,
        };
      }),
    };
  }

  /** Obra y máquina, si vienen, deben ser de la empresa. */
  private async validarReferencias(
    companyId: string,
    projectId?: string | null,
    equipoId?: string | null,
  ) {
    if (projectId) {
      const [p] = await this.dbs.db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(eq(projects.id, projectId), eq(projects.companyId, companyId)),
        )
        .limit(1);
      if (!p) {
        throw new UnprocessableEntityException({
          code: 'PROJECT_NOT_FOUND',
          message: 'La obra no existe',
        });
      }
    }
    if (equipoId) {
      const [e] = await this.dbs.db
        .select({ id: equipos.id })
        .from(equipos)
        .where(and(eq(equipos.id, equipoId), eq(equipos.companyId, companyId)))
        .limit(1);
      if (!e) {
        throw new UnprocessableEntityException({
          code: 'EQUIPO_NOT_FOUND',
          message: 'La máquina no existe',
        });
      }
    }
  }

  async crear(input: ActivoCreateInput): Promise<ActivoDetalleDto> {
    const companyId = this.dbs.getCompanyId();
    const d = activoCreateSchema.parse(input);
    await this.validarReferencias(companyId, d.projectId, d.equipoId);
    const id = await this.dbs.db.transaction(async (tx) => {
      const [dup] = await tx
        .select({ code: fixedAssets.code, equipoId: fixedAssets.equipoId })
        .from(fixedAssets)
        .where(
          and(
            eq(fixedAssets.companyId, companyId),
            d.equipoId
              ? sql`(${fixedAssets.code} = ${d.codigo} OR ${fixedAssets.equipoId} = ${d.equipoId})`
              : eq(fixedAssets.code, d.codigo),
          ),
        )
        .limit(1);
      if (dup) {
        throw new ConflictException(
          dup.code === d.codigo
            ? {
                code: 'ASSET_CODE_DUPLICATE',
                message: `Ya existe el activo ${d.codigo}`,
              }
            : {
                code: 'ASSET_EQUIPO_IN_USE',
                message: 'Esa máquina ya está dada de alta como activo',
              },
        );
      }
      const [a] = await tx
        .insert(fixedAssets)
        .values({
          companyId,
          code: d.codigo,
          name: d.nombre,
          category: d.categoria,
          equipoId: d.equipoId ?? null,
          projectId: d.projectId ?? null,
          acquisitionDate: d.fechaAdquisicion,
          startDate: d.fechaInicio,
          cost: d.coste.toFixed(2),
          residualValue: d.valorResidual.toFixed(2),
          usefulLifeMonths: d.vidaUtilMeses,
          notes: d.notas ?? null,
          createdBy: getRequestContext()?.userId ?? null,
        })
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'fixed_asset',
        entityId: a.id,
        action: 'create',
        newData: a,
      });
      return a.id;
    });
    return this.detalle(id);
  }

  async actualizar(
    id: string,
    input: ActivoUpdateInput,
    versionEsperada: number | undefined,
  ): Promise<ActivoDetalleDto> {
    const companyId = this.dbs.getCompanyId();
    const d = activoUpdateSchema.parse(input);
    await this.validarReferencias(companyId, d.projectId);
    await this.dbs.db.transaction(async (tx) => {
      const [a] = await tx
        .select()
        .from(fixedAssets)
        .where(
          and(eq(fixedAssets.id, id), eq(fixedAssets.companyId, companyId)),
        )
        .for('update');
      if (!a) throw activoNoEncontrado();
      verificarVersion(a.version, versionEsperada);
      const [nuevo] = await tx
        .update(fixedAssets)
        .set({
          ...(d.nombre !== undefined && { name: d.nombre }),
          ...(d.projectId !== undefined && { projectId: d.projectId ?? null }),
          ...(d.notas !== undefined && { notes: d.notas ?? null }),
          version: a.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(fixedAssets.id, id))
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'fixed_asset',
        entityId: id,
        action: 'update',
        oldData: a,
        newData: nuevo,
      });
    });
    return this.detalle(id);
  }

  /**
   * Contabiliza las cuotas pendientes hasta `hasta` (AAAA-MM) de todos los
   * activos en uso, en orden. Idempotente: una cuota por activo y mes. Cada
   * activo va en su transacción; uno rechazado (p. ej. período cerrado) se
   * informa y no bloquea al resto.
   */
  async amortizar(input: AmortizarInput): Promise<ResultadoAmortizacionDto> {
    const { hasta } = amortizarSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    const activos = await this.dbs.db
      .select()
      .from(fixedAssets)
      .where(
        and(
          eq(fixedAssets.companyId, companyId),
          eq(fixedAssets.status, 'activo'),
        ),
      )
      .orderBy(asc(fixedAssets.code));
    const res: ResultadoAmortizacionDto = {
      hasta,
      cuotas: 0,
      importe: 0,
      omitidos: [],
    };
    const importes: bigint[] = [];
    for (const a of activos) {
      try {
        const hechas = await this.dbs.db.transaction((tx) =>
          this.amortizarActivo(tx, companyId, a, hasta),
        );
        res.cuotas += hechas.length;
        importes.push(...hechas);
      } catch (e) {
        if (!(e instanceof HttpException) || e.getStatus() >= 500) throw e;
        const cuerpo = e.getResponse() as { message?: string } | string;
        res.omitidos.push({
          activoId: a.id,
          codigo: a.code,
          motivo:
            typeof cuerpo === 'string' ? cuerpo : (cuerpo.message ?? e.message),
        });
      }
    }
    res.importe = fromCents(sumCents(importes));
    return res;
  }

  private async amortizarActivo(
    tx: Tx,
    companyId: string,
    a: FixedAsset,
    hasta: string,
  ): Promise<bigint[]> {
    // Serializa ejecuciones concurrentes sobre el mismo activo.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`activo:${a.id}`}))`,
    );
    const hechas = await tx
      .select({
        year: fixedAssetDepreciations.year,
        month: fixedAssetDepreciations.month,
      })
      .from(fixedAssetDepreciations)
      .where(eq(fixedAssetDepreciations.assetId, a.id));
    const ya = new Set(hechas.map((h) => clavePeriodo(h.year, h.month)));
    const cuentas = CUENTAS_ACTIVO[a.category as CategoriaActivo];
    const importes: bigint[] = [];
    const cuadro = cuadroAmortizacion({
      coste: a.cost,
      residual: a.residualValue,
      vidaMeses: a.usefulLifeMonths,
      inicio: a.startDate,
    });
    for (const c of cuadro) {
      const clave = clavePeriodo(c.ejercicio, c.mes);
      if (clave > hasta) break;
      if (ya.has(clave) || c.cuota <= 0) continue;
      const cents = toCents(c.cuota);
      const [cuota] = await tx
        .insert(fixedAssetDepreciations)
        .values({
          companyId,
          assetId: a.id,
          year: c.ejercicio,
          month: c.mes,
          amount: centsToNumeric(cents),
        })
        .returning();
      const ultimoDia = new Date(Date.UTC(c.ejercicio, c.mes, 0))
        .toISOString()
        .slice(0, 10);
      const concepto = `Amortización ${clave} · ${a.code} ${a.name}`;
      const asiento = await this.contabilidad.contabilizarEnTx(tx, {
        companyId,
        fecha: ultimoDia,
        concepto,
        origen: 'amortizacion',
        origenId: cuota.id,
        lineas: [
          {
            cuenta: cuentas.gasto,
            debe: centsToNumeric(cents),
            haber: '0.00',
            projectId: a.projectId,
            concepto,
          },
          {
            cuenta: cuentas.acumulada,
            debe: '0.00',
            haber: centsToNumeric(cents),
            projectId: null,
            concepto,
          },
        ],
      });
      await tx
        .update(fixedAssetDepreciations)
        .set({ journalEntryId: asiento.id })
        .where(eq(fixedAssetDepreciations.id, cuota.id));
      await this.audit.registrar(tx, {
        entityType: 'fixed_asset_depreciation',
        entityId: cuota.id,
        action: 'create',
        newData: { ...cuota, journalEntryId: asiento.id },
      });
      importes.push(cents);
    }
    return importes;
  }

  /**
   * Baja (venta o desguace) en `fecha`: exige la amortización contabilizada
   * hasta el mes anterior y ninguna cuota desde el mes de la baja. Asiento:
   * 281x (acumulada) + 5720 (venta) + 6710 (pérdida)  a  21x (coste) + 7710 (beneficio).
   */
  async baja(
    id: string,
    input: ActivoBajaInput,
    versionEsperada: number | undefined,
  ): Promise<ActivoDetalleDto> {
    const companyId = this.dbs.getCompanyId();
    const d = activoBajaSchema.parse(input);
    await this.dbs.db.transaction(async (tx) => {
      const [a] = await tx
        .select()
        .from(fixedAssets)
        .where(
          and(eq(fixedAssets.id, id), eq(fixedAssets.companyId, companyId)),
        )
        .for('update');
      if (!a) throw activoNoEncontrado();
      verificarVersion(a.version, versionEsperada);
      if (a.status === 'baja') {
        throw new ConflictException({
          code: 'ASSET_DISPOSED',
          message: 'El activo ya está dado de baja',
        });
      }
      if (d.fecha < a.acquisitionDate) {
        throw new UnprocessableEntityException({
          code: 'ASSET_DISPOSAL_DATE_INVALID',
          message: 'La baja no puede ser anterior a la adquisición',
        });
      }
      const mesBaja = d.fecha.slice(0, 7);
      const cuotas = await tx
        .select()
        .from(fixedAssetDepreciations)
        .where(eq(fixedAssetDepreciations.assetId, id));
      const hechas = new Set(cuotas.map((c) => clavePeriodo(c.year, c.month)));
      if ([...hechas].some((k) => k >= mesBaja)) {
        throw new ConflictException({
          code: 'ASSET_DEPRECIATED_BEYOND_DISPOSAL',
          message: `Hay amortización contabilizada desde ${mesBaja}: anula esos asientos antes de la baja`,
        });
      }
      const faltan = cuadroAmortizacion({
        coste: a.cost,
        residual: a.residualValue,
        vidaMeses: a.usefulLifeMonths,
        inicio: a.startDate,
      }).filter((c) => {
        const k = clavePeriodo(c.ejercicio, c.mes);
        return k < mesBaja && !hechas.has(k);
      });
      if (faltan.length > 0) {
        const p = faltan.at(-1)!;
        throw new ConflictException({
          code: 'ASSET_DEPRECIATION_PENDING',
          message: `Faltan ${faltan.length} cuotas de amortización: amortiza hasta ${clavePeriodo(p.ejercicio, p.mes)} antes de la baja`,
        });
      }

      const acumulada = sumCents(cuotas.map((c) => toCents(c.amount)));
      const venta = toCents(d.importeVenta);
      const { resultado } = resultadoBaja({
        coste: a.cost,
        acumulada: fromCents(acumulada),
        importeVenta: d.importeVenta,
      });
      const r = toCents(resultado);
      const cuentas = CUENTAS_ACTIVO[a.category as CategoriaActivo];
      const concepto = `Baja ${a.code} ${a.name}: ${d.motivo}`;
      const linea = (
        cuenta: string,
        lado: 'debe' | 'haber',
        cents: bigint,
      ): LineaPropuesta => ({
        cuenta,
        debe: lado === 'debe' ? centsToNumeric(cents) : '0.00',
        haber: lado === 'haber' ? centsToNumeric(cents) : '0.00',
        projectId: null,
        concepto,
      });
      const lineas: LineaPropuesta[] = [];
      if (acumulada > 0n)
        lineas.push(linea(cuentas.acumulada, 'debe', acumulada));
      if (venta > 0n) lineas.push(linea(CUENTAS_BAJA.cobro, 'debe', venta));
      if (r < 0n) lineas.push(linea(CUENTAS_BAJA.perdida, 'debe', -r));
      lineas.push(linea(cuentas.activo, 'haber', toCents(a.cost)));
      if (r > 0n) lineas.push(linea(CUENTAS_BAJA.beneficio, 'haber', r));

      const asiento = await this.contabilidad.contabilizarEnTx(tx, {
        companyId,
        fecha: d.fecha,
        concepto,
        origen: 'baja_inmovilizado',
        origenId: a.id,
        lineas,
      });
      await cambiarEstado(
        tx,
        fixedAssets,
        'fixed_asset',
        id,
        'activo',
        'baja',
        {
          disposalDate: d.fecha,
          disposalAmount: centsToNumeric(venta),
          disposalReason: d.motivo,
          disposalEntryId: asiento.id,
        },
        a.version,
      );
      // La máquina vinculada deja de estar operativa.
      if (a.equipoId) {
        await tx
          .update(equipos)
          .set({ estado: 'baja', fechaBaja: d.fecha, updatedAt: new Date() })
          .where(eq(equipos.id, a.equipoId));
      }
      await this.audit.registrar(tx, {
        entityType: 'fixed_asset',
        entityId: id,
        action: 'update',
        oldData: { status: 'activo' },
        newData: {
          status: 'baja',
          fecha: d.fecha,
          importeVenta: d.importeVenta,
          resultado,
          asientoId: asiento.id,
        },
      });
    });
    return this.detalle(id);
  }
}
