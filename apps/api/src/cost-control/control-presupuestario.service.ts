import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
  SQL,
} from 'drizzle-orm';
import {
  auditLog,
  budgetItems,
  budgets,
  certifications,
  contratosSubcontrata,
  invoiceLines,
  invoices,
  partesMaquinaria,
  partesPersonal,
  paymentMilestones,
  projectBudgetControls,
  projectPhases,
  projects,
  purchaseOrders,
  type DbOrTx,
  type ProjectBudgetControl,
  type Tx,
} from '@erp/db';
import type { PgColumn } from 'drizzle-orm/pg-core';
import {
  CONTROL_PRESUPUESTARIO_POR_DEFECTO,
  capituloDeCodigo,
  centsToNumeric,
  cobradoEnBase,
  comprometidoPendiente,
  controlPresupuestarioUpdateSchema,
  cuadroMargenesObra,
  evaluarControlPresupuestario,
  margenPorPartida,
  sumCents,
  sumarEntradasCuadro,
  toCents,
  type ConfigControlPresupuestarioDto,
  type ControlPresupuestarioDto,
  type ControlPresupuestarioUpdateInput,
  type CuadroMargenesDto,
  type CuadroMargenesQuery,
  type EntradaCuadroMargenes,
  type FilaPartidaEntrada,
  type EvaluacionControlPresupuestario,
  type EventoControlPresupuestarioDto,
  type FilaMargenObraDto,
  type MargenesObraDto,
  type MargenesObraQuery,
  type ModoControlPresupuestario,
  type OperacionControl,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import {
  anotarAvisoRespuesta,
  getRequestContext,
} from '../common/request-context';
import { verificarVersion } from '../common/version';
import { DbService } from '../db/db.service';
import { costeAlmacen, costeAmortizacion } from './costes-imputados';

/** Estados de pedido que aún comprometen coste. */
const PEDIDOS_ABIERTOS = ['emitido', 'servido_parcial', 'servido'] as const;
/** Facturas de venta que cuentan como facturadas. */
const VENTA_EMITIDA = ['aprobada', 'pagada', 'rectificada'] as const;
const ENTIDAD_AUDITORIA = 'project_budget_control';
/*
 * Referencias cualificadas a la fila exterior en subconsultas correlacionadas:
 * en una SELECT de una sola tabla Drizzle no prefija las columnas, y dentro
 * de la subconsulta "id" se resolvería contra la tabla interna.
 */
const COL_PEDIDO_ID = sql.raw('"purchase_orders"."id"');
const COL_VENCIMIENTO_ID = sql.raw('"payment_milestones"."id"');

type Origen =
  | 'facturasCompra'
  | 'partesPersonal'
  | 'partesMaquinaria'
  | 'almacen'
  | 'amortizacion';

interface Rango {
  desde?: string;
  hasta?: string;
}

/** Todo lo cargado de una obra, en céntimos, por partida (`null` = sin partida). */
interface Magnitudes {
  presupuestoPorPartida: Map<string | null, bigint>;
  realPorPartida: Map<string | null, Record<Origen, bigint>>;
  pedidos: { phaseId: string | null; importe: string; ejecutado: string }[];
  subcontratas: { importe: string; ejecutado: string }[];
  certificado: bigint;
  facturado: bigint;
  cobro: { baseObra: string; totalVencimientos: string; liquidado: string }[];
}

function vacias(): Magnitudes {
  return {
    presupuestoPorPartida: new Map(),
    realPorPartida: new Map(),
    pedidos: [],
    subcontratas: [],
    certificado: 0n,
    facturado: 0n,
    cobro: [],
  };
}

const ORIGEN_CERO = (): Record<Origen, bigint> => ({
  facturasCompra: 0n,
  partesPersonal: 0n,
  partesMaquinaria: 0n,
  almacen: 0n,
  amortizacion: 0n,
});

function enRango(col: PgColumn, r: Rango): SQL[] {
  const out: SQL[] = [];
  if (r.desde) out.push(gte(col, r.desde));
  if (r.hasta) out.push(lte(col, r.hasta));
  return out;
}

function configDto(
  c: ProjectBudgetControl | undefined,
): ConfigControlPresupuestarioDto {
  if (!c) {
    return {
      ...CONTROL_PRESUPUESTARIO_POR_DEFECTO,
      version: 0,
      actualizadoEn: null,
    };
  }
  return {
    modo: c.mode as ModoControlPresupuestario,
    toleranciaPct: Number(c.tolerancePct),
    umbralAvisoPct: Number(c.warningPct),
    version: c.version,
    actualizadoEn: c.updatedAt.toISOString(),
  };
}

/** Error RFC 7807 de presupuesto excedido (422) con el detalle del cálculo. */
export function presupuestoExcedido(
  ev: EvaluacionControlPresupuestario,
  obra: string,
): HttpException {
  return new HttpException(
    {
      code: 'BUDGET_EXCEEDED',
      message:
        `La obra ${obra} supera su presupuesto: presupuestado ${ev.presupuestado} €, ` +
        `límite ${ev.limite} €, consumido ${ev.consumido} € + ${ev.importe} € de esta operación = ` +
        `${ev.consumidoTras} € (exceso ${ev.exceso} €)`,
      presupuestado: ev.presupuestado,
      limite: ev.limite,
      consumido: ev.consumido,
      importe: ev.importe,
      consumidoTras: ev.consumidoTras,
      exceso: ev.exceso,
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

/**
 * Control presupuestario activo y cuadro de márgenes por obra (SAP PS/CO,
 * Oracle PPM). Carga por lotes (número fijo de consultas, sea una obra o la
 * cartera entera) y compone con las reglas puras de `calculo.ts`.
 */
@Injectable()
export class ControlPresupuestarioService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  /* ───────────────────────────── carga ───────────────────────────── */

  private async cargar(
    ex: DbOrTx,
    ids: string[],
    rango: Rango = {},
  ): Promise<Map<string, Magnitudes>> {
    const m = new Map(ids.map((id) => [id, vacias()]));
    if (ids.length === 0) return m;
    const de = (id: string | null) => (id ? m.get(id) : undefined);

    // Presupuesto: partidas del presupuesto activo; sin él, el de cada partida.
    const activos = await ex
      .select({ id: budgets.id, projectId: budgets.projectId })
      .from(budgets)
      .where(
        and(
          inArray(budgets.projectId, ids),
          eq(budgets.status, 'activo'),
          isNull(budgets.deletedAt),
        ),
      );
    const obraDePresupuesto = new Map<string, string>();
    for (const b of activos) {
      if (![...obraDePresupuesto.values()].includes(b.projectId)) {
        obraDePresupuesto.set(b.id, b.projectId);
      }
    }
    if (obraDePresupuesto.size > 0) {
      const filas = await ex
        .select({
          budgetId: budgetItems.budgetId,
          phaseId: budgetItems.phaseId,
          total: sql<string>`coalesce(sum(${budgetItems.totalAmount}), 0)`,
        })
        .from(budgetItems)
        .where(inArray(budgetItems.budgetId, [...obraDePresupuesto.keys()]))
        .groupBy(budgetItems.budgetId, budgetItems.phaseId);
      for (const f of filas) {
        const p = de(obraDePresupuesto.get(f.budgetId) ?? null)!;
        p.presupuestoPorPartida.set(
          f.phaseId,
          (p.presupuestoPorPartida.get(f.phaseId) ?? 0n) + toCents(f.total),
        );
      }
    }
    const conPresupuesto = new Set(obraDePresupuesto.values());
    const sinPresupuesto = ids.filter((id) => !conPresupuesto.has(id));
    if (sinPresupuesto.length > 0) {
      const fases = await ex
        .select({
          projectId: projectPhases.projectId,
          id: projectPhases.id,
          budget: projectPhases.budgetAmount,
        })
        .from(projectPhases)
        .where(
          and(
            inArray(projectPhases.projectId, sinPresupuesto),
            isNull(projectPhases.deletedAt),
          ),
        );
      for (const f of fases) {
        de(f.projectId)!.presupuestoPorPartida.set(
          f.id,
          toCents(f.budget ?? 0),
        );
      }
    }

    const imputa = (
      origen: Origen,
      filas: {
        projectId: string | null;
        phaseId: string | null;
        total: string;
      }[],
    ) => {
      for (const f of filas) {
        const o = de(f.projectId);
        if (!o) continue;
        const acc = o.realPorPartida.get(f.phaseId) ?? ORIGEN_CERO();
        acc[origen] += toCents(f.total);
        o.realPorPartida.set(f.phaseId, acc);
      }
    };

    // Coste real: facturas de compra (incl. subcontratas) no anuladas.
    imputa(
      'facturasCompra',
      await ex
        .select({
          projectId: invoiceLines.projectId,
          phaseId: invoiceLines.phaseId,
          total: sql<string>`coalesce(sum(${invoiceLines.baseAmount}), 0)`,
        })
        .from(invoiceLines)
        .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
        .where(
          and(
            inArray(invoiceLines.projectId, ids),
            eq(invoices.kind, 'compra'),
            ne(invoices.status, 'anulada'),
            isNull(invoices.deletedAt),
            ...enRango(invoices.issueDate, rango),
          ),
        )
        .groupBy(invoiceLines.projectId, invoiceLines.phaseId),
    );
    // Partes de personal y maquinaria.
    imputa(
      'partesPersonal',
      await ex
        .select({
          projectId: partesPersonal.projectId,
          phaseId: partesPersonal.phaseId,
          total: sql<string>`coalesce(sum(${partesPersonal.totalCost}), 0)`,
        })
        .from(partesPersonal)
        .where(
          and(
            inArray(partesPersonal.projectId, ids),
            isNull(partesPersonal.deletedAt),
            ...enRango(partesPersonal.workDate, rango),
          ),
        )
        .groupBy(partesPersonal.projectId, partesPersonal.phaseId),
    );
    imputa(
      'partesMaquinaria',
      await ex
        .select({
          projectId: partesMaquinaria.projectId,
          phaseId: partesMaquinaria.phaseId,
          total: sql<string>`coalesce(sum(${partesMaquinaria.totalCost}), 0)`,
        })
        .from(partesMaquinaria)
        .where(
          and(
            inArray(partesMaquinaria.projectId, ids),
            isNull(partesMaquinaria.deletedAt),
            ...enRango(partesMaquinaria.workDate, rango),
          ),
        )
        .groupBy(partesMaquinaria.projectId, partesMaquinaria.phaseId),
    );
    // Almacén y amortización: mismas consultas que la economía de obra.
    const [almacen, amortizacion] = await Promise.all([
      costeAlmacen(ex, ids, { rango }),
      costeAmortizacion(ex, ids, { rango }),
    ]);
    const sinPartida = (origen: Origen, mapa: Map<string, bigint>) => {
      for (const [projectId, v] of mapa) {
        const o = de(projectId);
        if (!o) continue;
        const acc = o.realPorPartida.get(null) ?? ORIGEN_CERO();
        acc[origen] += v;
        o.realPorPartida.set(null, acc);
      }
    };
    sinPartida('almacen', almacen);
    sinPartida('amortizacion', amortizacion);

    // Comprometido: pedidos abiertos con lo facturado vía albaranes.
    const pedidos = await ex
      .select({
        projectId: purchaseOrders.projectId,
        phaseId: purchaseOrders.phaseId,
        importe: purchaseOrders.amount,
        ejecutado: sql<string>`coalesce((select sum(dn.amount) from delivery_notes dn where dn.order_id = ${COL_PEDIDO_ID} and dn.invoice_id is not null and dn.deleted_at is null), 0)`,
      })
      .from(purchaseOrders)
      .where(
        and(
          inArray(purchaseOrders.projectId, ids),
          inArray(purchaseOrders.status, [...PEDIDOS_ABIERTOS]),
          isNull(purchaseOrders.deletedAt),
        ),
      );
    for (const p of pedidos) de(p.projectId)?.pedidos.push(p);
    const subcontratas = await ex
      .select({
        projectId: contratosSubcontrata.proyectoId,
        importe: contratosSubcontrata.importeTotal,
        ejecutado: contratosSubcontrata.importeEjecutado,
      })
      .from(contratosSubcontrata)
      .where(
        and(
          inArray(contratosSubcontrata.proyectoId, ids),
          eq(contratosSubcontrata.status, 'activo'),
          isNull(contratosSubcontrata.deletedAt),
        ),
      );
    for (const s of subcontratas) de(s.projectId)?.subcontratas.push(s);

    // Certificado: acumulado de la última certificación o, con rango, la
    // producción de los períodos certificados dentro de él.
    if (rango.desde || rango.hasta) {
      const filas = await ex
        .select({
          projectId: certifications.projectId,
          total: sql<string>`coalesce(sum(${certifications.periodAmount}), 0)`,
        })
        .from(certifications)
        .where(
          and(
            inArray(certifications.projectId, ids),
            isNull(certifications.deletedAt),
            ...enRango(certifications.certDate, rango),
          ),
        )
        .groupBy(certifications.projectId);
      for (const f of filas) de(f.projectId)!.certificado = toCents(f.total);
    } else {
      const ultimas = await ex
        .selectDistinctOn([certifications.projectId], {
          projectId: certifications.projectId,
          total: certifications.cumulativeAmount,
        })
        .from(certifications)
        .where(
          and(
            inArray(certifications.projectId, ids),
            isNull(certifications.deletedAt),
          ),
        )
        .orderBy(certifications.projectId, sql`${certifications.seq} desc`);
      for (const f of ultimas) de(f.projectId)!.certificado = toCents(f.total);
    }

    // Facturado (base de las líneas de la obra) y cobrado en base.
    const ventas = await ex
      .select({
        invoiceId: invoiceLines.invoiceId,
        projectId: invoiceLines.projectId,
        base: sql<string>`sum(${invoiceLines.baseAmount})`,
        enRango: sql<boolean>`bool_and(${
          rango.desde || rango.hasta
            ? and(...enRango(invoices.issueDate, rango))
            : sql`true`
        })`,
      })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
      .where(
        and(
          inArray(invoiceLines.projectId, ids),
          eq(invoices.kind, 'venta'),
          inArray(invoices.status, [...VENTA_EMITIDA]),
          isNull(invoices.deletedAt),
        ),
      )
      .groupBy(invoiceLines.invoiceId, invoiceLines.projectId);
    for (const v of ventas) {
      if (v.enRango) de(v.projectId)!.facturado += toCents(v.base);
    }
    const facturasVenta = [...new Set(ventas.map((v) => v.invoiceId))];
    if (facturasVenta.length > 0) {
      const venc = await ex
        .select({
          invoiceId: paymentMilestones.invoiceId,
          total: sql<string>`coalesce(sum(${paymentMilestones.amount}), 0)`,
          liquidado: sql<string>`coalesce(sum((select coalesce(sum(ps.amount), 0) from payment_settlements ps where ps.milestone_id = ${COL_VENCIMIENTO_ID} and ps.status = 'vigente'${
            rango.desde ? sql` and ps.settled_on >= ${rango.desde}` : sql``
          }${
            rango.hasta ? sql` and ps.settled_on <= ${rango.hasta}` : sql``
          })), 0)`,
        })
        .from(paymentMilestones)
        .where(
          and(
            inArray(paymentMilestones.invoiceId, facturasVenta),
            eq(paymentMilestones.direction, 'cobro'),
          ),
        )
        .groupBy(paymentMilestones.invoiceId);
      const porFactura = new Map(venc.map((v) => [v.invoiceId, v]));
      for (const v of ventas) {
        const f = porFactura.get(v.invoiceId);
        if (!f) continue;
        de(v.projectId)!.cobro.push({
          baseObra: v.base,
          totalVencimientos: f.total,
          liquidado: f.liquidado,
        });
      }
    }
    return m;
  }

  private entrada(
    contrato: string | null,
    d: Magnitudes,
  ): EntradaCuadroMargenes {
    const real = ORIGEN_CERO();
    for (const r of d.realPorPartida.values()) {
      for (const k of Object.keys(real) as Origen[]) real[k] += r[k];
    }
    return {
      contrato,
      presupuestado: centsToNumeric(
        sumCents([...d.presupuestoPorPartida.values()]),
      ),
      comprometido: {
        pedidos: comprometidoPendiente(d.pedidos),
        subcontratas: comprometidoPendiente(d.subcontratas),
      },
      costeReal: {
        facturasCompra: centsToNumeric(real.facturasCompra),
        partesPersonal: centsToNumeric(real.partesPersonal),
        partesMaquinaria: centsToNumeric(real.partesMaquinaria),
        almacen: centsToNumeric(real.almacen),
        amortizacion: centsToNumeric(real.amortizacion),
      },
      certificado: centsToNumeric(d.certificado),
      facturado: centsToNumeric(d.facturado),
      cobrado: cobradoEnBase(d.cobro),
    };
  }

  /* ──────────────────────────── obras ──────────────────────────── */

  private async obrasVisibles(f: {
    projectId?: string;
    estado?: string;
    q?: string;
  }) {
    const companyId = this.dbs.getCompanyId();
    const filtros: SQL[] = [
      eq(projects.companyId, companyId),
      isNull(projects.deletedAt),
    ];
    const accesibles = await this.dbs.getObrasAccesibles();
    if (accesibles !== null) {
      if (accesibles.length === 0) return [];
      filtros.push(inArray(projects.id, accesibles));
    }
    if (f.projectId) filtros.push(eq(projects.id, f.projectId));
    if (f.estado) filtros.push(sql`${projects.status}::text = ${f.estado}`);
    if (f.q) {
      const patron = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      filtros.push(
        or(ilike(projects.code, patron), ilike(projects.name, patron))!,
      );
    }
    return this.dbs.db
      .select()
      .from(projects)
      .where(and(...filtros))
      .orderBy(projects.code);
  }

  private async obra(projectId: string) {
    const [p] = await this.obrasVisibles({ projectId });
    if (!p) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        message: 'Obra no encontrada',
      });
    }
    return p;
  }

  private async configs(
    ex: DbOrTx,
    ids: string[],
  ): Promise<Map<string, ProjectBudgetControl>> {
    if (ids.length === 0) return new Map();
    const filas = await ex
      .select()
      .from(projectBudgetControls)
      .where(inArray(projectBudgetControls.projectId, ids));
    return new Map(filas.map((c) => [c.projectId, c]));
  }

  private fila(
    p: typeof projects.$inferSelect,
    d: Magnitudes,
    cfg: ProjectBudgetControl | undefined,
  ): FilaMargenObraDto {
    const cuadro = cuadroMargenesObra(this.entrada(p.contractAmount, d));
    const c = configDto(cfg);
    const ev = evaluarControlPresupuestario({
      modo: c.modo,
      toleranciaPct: c.toleranciaPct,
      umbralAvisoPct: c.umbralAvisoPct,
      presupuestado: cuadro.presupuestado,
      consumido: cuadro.consumido,
    });
    return {
      projectId: p.id,
      codigo: p.code,
      nombre: p.name,
      estadoObra: p.status,
      ...cuadro,
      control: {
        modo: c.modo,
        estado: ev.estado,
        limite: ev.limite,
        disponible: ev.disponible,
      },
    };
  }

  /* ────────────────────────── consultas ────────────────────────── */

  /** Cuadro de márgenes de la cartera visible, con totales exactos. */
  async cuadro(f: CuadroMargenesQuery): Promise<CuadroMargenesDto> {
    const obras = await this.obrasVisibles(f);
    const ids = obras.map((o) => o.id);
    const rango = { desde: f.desde, hasta: f.hasta };
    const [datos, cfgs] = await Promise.all([
      this.cargar(this.dbs.db, ids, rango),
      this.configs(this.dbs.db, ids),
    ]);
    const entradas: EntradaCuadroMargenes[] = [];
    let filas = obras.map((p) => {
      const d = datos.get(p.id)!;
      entradas.push(this.entrada(p.contractAmount, d));
      return this.fila(p, d, cfgs.get(p.id));
    });
    if (f.soloAlertas) {
      const conAlerta = new Set(
        filas
          .filter(
            (o) =>
              o.control.estado === 'aviso' || o.control.estado === 'excedido',
          )
          .map((o) => o.projectId),
      );
      filas = filas.filter((o) => conAlerta.has(o.projectId));
      const idx = obras
        .map((o, i) => (conAlerta.has(o.id) ? i : -1))
        .filter((i) => i >= 0);
      entradas.splice(0, entradas.length, ...idx.map((i) => entradas[i]));
    }
    return {
      generadoEn: new Date().toISOString(),
      desde: f.desde ?? null,
      hasta: f.hasta ?? null,
      obras: filas,
      totales: cuadroMargenesObra(sumarEntradasCuadro(entradas)),
    };
  }

  /** Cuadro de una obra con desglose por partida y capítulo. */
  async margenesObra(
    projectId: string,
    rango: MargenesObraQuery,
  ): Promise<MargenesObraDto> {
    const p = await this.obra(projectId);
    const [datos, cfgs, fases] = await Promise.all([
      this.cargar(this.dbs.db, [projectId], rango),
      this.configs(this.dbs.db, [projectId]),
      this.dbs.db
        .select()
        .from(projectPhases)
        .where(
          and(
            eq(projectPhases.projectId, projectId),
            isNull(projectPhases.deletedAt),
          ),
        )
        .orderBy(projectPhases.code),
    ]);
    const d = datos.get(projectId)!;
    const compromisoPorPartida = new Map<string | null, string>();
    const pendientePorPartida = new Map<string | null, typeof d.pedidos>();
    for (const ped of d.pedidos) {
      const lista = pendientePorPartida.get(ped.phaseId) ?? [];
      lista.push(ped);
      pendientePorPartida.set(ped.phaseId, lista);
    }
    for (const [k, lista] of pendientePorPartida) {
      compromisoPorPartida.set(k, String(comprometidoPendiente(lista)));
    }
    const subcont = comprometidoPendiente(d.subcontratas);
    const realDe = (k: string | null) => {
      const r = d.realPorPartida.get(k);
      return r ? centsToNumeric(sumCents(Object.values(r))) : '0';
    };
    const ids = new Set(fases.map((f) => f.id));
    const filas: FilaPartidaEntrada[] = fases.map((f) => ({
      phaseId: f.id,
      codigo: f.code,
      nombre: f.name,
      capitulo: capituloDeCodigo(f.code),
      presupuestado: centsToNumeric(d.presupuestoPorPartida.get(f.id) ?? 0n),
      comprometido: compromisoPorPartida.get(f.id) ?? '0',
      costeReal: realDe(f.id),
    }));
    // Sin partida (o de partidas borradas): lo no asignado + subcontratas.
    const huerfanas = new Set(
      [
        ...d.presupuestoPorPartida.keys(),
        ...d.realPorPartida.keys(),
        ...compromisoPorPartida.keys(),
      ].filter((k) => k === null || !ids.has(k)),
    );
    let presSin = 0n;
    let compSin = toCents(subcont);
    let realSin = 0n;
    for (const k of huerfanas) {
      presSin += d.presupuestoPorPartida.get(k) ?? 0n;
      compSin += toCents(compromisoPorPartida.get(k) ?? '0');
      realSin += toCents(realDe(k));
    }
    if (presSin !== 0n || compSin !== 0n || realSin !== 0n) {
      filas.push({
        phaseId: null,
        codigo: '',
        nombre: 'Sin partida',
        capitulo: null,
        presupuestado: centsToNumeric(presSin),
        comprometido: centsToNumeric(compSin),
        costeReal: centsToNumeric(realSin),
      });
    }
    const { partidas, capitulos } = margenPorPartida(filas);
    return {
      generadoEn: new Date().toISOString(),
      desde: rango.desde ?? null,
      hasta: rango.hasta ?? null,
      obra: this.fila(p, d, cfgs.get(projectId)),
      partidas: partidas.map((x) => ({
        phaseId: x.phaseId,
        codigo: x.codigo,
        nombre: x.nombre,
        capitulo: x.capitulo,
        presupuestado: x.presupuestado,
        comprometido: x.comprometido,
        costeReal: x.costeReal,
        consumido: x.consumido,
        desviacion: x.desviacion,
        consumoPct: x.consumoPct,
        excedida: x.excedida,
      })),
      capitulos,
    };
  }

  /** Estado del control presupuestario de una obra y sus últimos eventos. */
  async estado(projectId: string): Promise<ControlPresupuestarioDto> {
    await this.obra(projectId);
    const ev = await this.evaluar(this.dbs.db, projectId, 0);
    const eventos = await this.dbs.db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.companyId, this.dbs.getCompanyId()),
          eq(auditLog.entityType, ENTIDAD_AUDITORIA),
          eq(auditLog.entityId, projectId),
        ),
      )
      .orderBy(desc(auditLog.occurredAt))
      .limit(20);
    return {
      projectId,
      config: ev.config,
      evaluacion: ev.evaluacion,
      eventos: eventos.map((e): EventoControlPresupuestarioDto => {
        const n = (e.newData ?? {}) as Record<string, unknown>;
        return {
          fecha: e.occurredAt.toISOString(),
          evento:
            n.evento === 'aviso' || n.evento === 'bloqueo'
              ? n.evento
              : 'configuracion',
          operacion: (n.operacion as OperacionControl | undefined) ?? null,
          importe: typeof n.importe === 'number' ? n.importe : null,
          exceso: typeof n.exceso === 'number' ? n.exceso : null,
          usuarioId: e.userId,
          correlationId: e.correlationId,
        };
      }),
    };
  }

  private async evaluar(
    ex: DbOrTx,
    projectId: string,
    importe: string | number,
  ) {
    const [p] = await ex
      .select({ contractAmount: projects.contractAmount })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const [datos, cfgs] = await Promise.all([
      this.cargar(ex, [projectId]),
      this.configs(ex, [projectId]),
    ]);
    const cuadro = cuadroMargenesObra(
      this.entrada(p?.contractAmount ?? null, datos.get(projectId)!),
    );
    const config = configDto(cfgs.get(projectId));
    return {
      config,
      evaluacion: evaluarControlPresupuestario({
        modo: config.modo,
        toleranciaPct: config.toleranciaPct,
        umbralAvisoPct: config.umbralAvisoPct,
        presupuestado: cuadro.presupuestado,
        consumido: cuadro.consumido,
        importe,
      }),
    };
  }

  /* ─────────────────────── control activo ─────────────────────── */

  /**
   * Comprueba, dentro de la transacción de la operación, si añadir `importe`
   * de coste a la obra cabe en su presupuesto. Serializa por obra (bloqueo
   * consultivo) para que dos operaciones concurrentes no pasen ambas.
   *  - bloqueo + exceso: audita el rechazo en una transacción aparte (la de la
   *    operación se deshace) y lanza 422 `BUDGET_EXCEEDED`.
   *  - aviso + exceso: audita en la transacción y añade `X-Budget-Warning`.
   * Debe llamarse ANTES de que la operación escriba en `audit_log`.
   */
  async verificar(
    tx: Tx,
    p: {
      projectId: string;
      importe: string | number;
      operacion: OperacionControl;
      referencia?: string | null;
    },
  ): Promise<EvaluacionControlPresupuestario> {
    if (toCents(p.importe) <= 0n) {
      return (await this.evaluar(tx, p.projectId, 0)).evaluacion;
    }
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`control-presupuestario:${p.projectId}`}))`,
    );
    const { evaluacion: ev, config } = await this.evaluar(
      tx,
      p.projectId,
      p.importe,
    );
    if (!ev.bloquea && !ev.avisa) return ev;
    const [obra] = await tx
      .select({ code: projects.code })
      .from(projects)
      .where(eq(projects.id, p.projectId));
    const datos = {
      evento: ev.bloquea ? 'bloqueo' : 'aviso',
      operacion: p.operacion,
      referencia: p.referencia ?? null,
      modo: config.modo,
      presupuestado: ev.presupuestado,
      limite: ev.limite,
      consumido: ev.consumido,
      importe: ev.importe,
      exceso: ev.exceso,
    };
    const entrada = {
      entityType: ENTIDAD_AUDITORIA,
      entityId: p.projectId,
      action: 'create' as const,
      newData: datos,
    };
    if (ev.bloquea) {
      const companyId = this.dbs.getCompanyId();
      await this.dbs.db.transaction((trx) =>
        this.audit.registrar(trx, entrada, { companyId }),
      );
      throw presupuestoExcedido(ev, obra?.code ?? p.projectId);
    }
    await this.audit.registrar(tx, entrada);
    anotarAvisoRespuesta(
      `BUDGET_EXCEEDED; obra=${obra?.code ?? p.projectId}; exceso=${ev.exceso}`,
    );
    return ev;
  }

  /** Alta o cambio de la configuración (If-Match si ya existe). */
  async configurar(
    projectId: string,
    input: ControlPresupuestarioUpdateInput,
    versionEsperada: number | undefined,
  ): Promise<ControlPresupuestarioDto> {
    await this.obra(projectId);
    const ctx = getRequestContext();
    const d = controlPresupuestarioUpdateSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    await this.dbs.db.transaction(async (tx) => {
      const [actual] = await tx
        .select()
        .from(projectBudgetControls)
        .where(eq(projectBudgetControls.projectId, projectId))
        .for('update');
      if (actual) {
        if (versionEsperada === undefined) {
          throw new HttpException(
            {
              code: 'PRECONDITION_REQUIRED',
              message:
                'Falta la cabecera If-Match con la versión de la configuración',
            },
            HttpStatus.PRECONDITION_REQUIRED,
          );
        }
        verificarVersion(actual.version, versionEsperada);
      }
      const valores = {
        mode: d.modo,
        tolerancePct: d.toleranciaPct.toFixed(2),
        warningPct: d.umbralAvisoPct.toFixed(2),
        updatedBy: ctx?.userId ?? null,
        updatedAt: new Date(),
      };
      const [nuevo] = actual
        ? await tx
            .update(projectBudgetControls)
            .set({ ...valores, version: actual.version + 1 })
            .where(eq(projectBudgetControls.projectId, projectId))
            .returning()
        : await tx
            .insert(projectBudgetControls)
            .values({ projectId, companyId, ...valores })
            .returning();
      await this.audit.registrar(tx, {
        entityType: ENTIDAD_AUDITORIA,
        entityId: projectId,
        action: actual ? 'update' : 'create',
        oldData: actual ?? undefined,
        newData: { evento: 'configuracion', ...nuevo },
      });
    });
    return this.estado(projectId);
  }
}
