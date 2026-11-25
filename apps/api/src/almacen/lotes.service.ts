import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  stockArticles,
  stockItems,
  stockLots,
  stockMovementLots,
  stockMovements,
  warehouses,
  type StockArticle,
  type Tx,
} from '@erp/db';
import {
  ErrorLote,
  asignarLotesSalida,
  validarLotesEntrada,
  type LoteDto,
  type LoteIndicado,
  type LotesQuery,
  type SeguimientoStock,
  type TrazaLoteDto,
  type UnidadStock,
} from '@erp/shared';
import { DbService } from '../db/db.service';

/** Traduce el rechazo de una regla pura de lotes a RFC 7807. */
function regla<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ErrorLote) {
      if (e.codigo === 'BATCH_SERIAL_INSUFFICIENT') {
        throw new ConflictException({ code: e.codigo, message: e.message });
      }
      throw new UnprocessableEntityException({
        code: e.codigo,
        message: e.message,
      });
    }
    throw e;
  }
}

interface Base {
  companyId: string;
  movimientoId: string;
  articulo: StockArticle;
  cantidad: string;
}

/**
 * Lotes y números de serie del almacén (SAP batch / serial management,
 * Oracle lot & serial control). Cada operación de stock de un artículo con
 * seguimiento reparte su cantidad por lote en `stock_movement_lots`, dentro
 * de la transacción del movimiento y bajo el bloqueo del saldo del artículo
 * en el almacén (`stock_items ... FOR UPDATE`), así que la existencia por lote
 * —suma de esas filas— es coherente con la del artículo.
 */
@Injectable()
export class LotesService {
  constructor(private readonly dbs: DbService) {}

  /** El número de serie identifica unidades: exige la unidad `ud`. */
  exigirUnidadSerie(
    seguimiento: SeguimientoStock,
    unidad: UnidadStock | string,
  ): void {
    if (seguimiento === 'serie' && unidad !== 'ud') {
      throw new UnprocessableEntityException({
        code: 'BATCH_SERIAL_INVALID',
        message: 'Un artículo con número de serie se gestiona en unidades (ud)',
      });
    }
  }

  /** Solo se cambia el seguimiento de un artículo sin existencias. */
  async exigirCambioSeguimiento(
    tx: Tx,
    a: StockArticle,
    nuevo: SeguimientoStock,
  ): Promise<void> {
    this.exigirUnidadSerie(nuevo, a.unit);
    const [s] = await tx
      .select({ q: sql<string>`coalesce(sum(${stockItems.quantity}), 0)` })
      .from(stockItems)
      .where(eq(stockItems.articleId, a.id));
    if (Number(s?.q ?? 0) !== 0) {
      throw new ConflictException({
        code: 'BATCH_SERIAL_TRACKING_LOCKED',
        message: `El artículo ${a.code} tiene existencias: el seguimiento por lote o serie solo cambia sin stock`,
      });
    }
  }

  private seguimiento(a: StockArticle): SeguimientoStock {
    return a.tracking as SeguimientoStock;
  }

  private async insertar(
    tx: Tx,
    companyId: string,
    movimientoId: string,
    filas: { lotId: string; almacenId: string; cantidad: string }[],
  ): Promise<void> {
    if (filas.length === 0) return;
    await tx.insert(stockMovementLots).values(
      filas.map((f) => ({
        companyId,
        movementId: movimientoId,
        lotId: f.lotId,
        warehouseId: f.almacenId,
        quantity: f.cantidad,
      })),
    );
  }

  /** Existencia de cada lote del artículo en el almacén (> 0). */
  private async disponibles(
    tx: Tx,
    companyId: string,
    almacenId: string,
    articuloId: string,
  ) {
    const r = await tx.execute(sql`
      select l.id as "lotId", l.code as codigo, sum(ml.quantity)::text as cantidad,
        l.expiry_date::text as caducidad, l.created_at::text as alta
      from stock_movement_lots ml
      join stock_lots l on l.id = ml.lot_id
      where ml.company_id = ${companyId} and ml.warehouse_id = ${almacenId}
        and l.article_id = ${articuloId}
      group by l.id
      having sum(ml.quantity) > 0`);
    return r.rows as {
      lotId: string;
      codigo: string;
      cantidad: string;
      caducidad: string | null;
      alta: string;
    }[];
  }

  /**
   * Entrada (recepción, devolución sin trazabilidad previa, sobrante): crea o
   * reutiliza los lotes y, en serie, rechaza un número ya en stock.
   */
  async entrar(
    tx: Tx,
    b: Base & { almacenId: string; lotes?: LoteIndicado[] | null },
  ): Promise<void> {
    const seg = this.seguimiento(b.articulo);
    const lotes = regla(() => validarLotesEntrada(seg, b.cantidad, b.lotes));
    if (lotes.length === 0) return;
    const filas: { lotId: string; almacenId: string; cantidad: string }[] = [];
    for (const l of [...lotes].sort((x, y) =>
      x.codigo.localeCompare(y.codigo),
    )) {
      await tx
        .insert(stockLots)
        .values({
          companyId: b.companyId,
          articleId: b.articulo.id,
          kind: seg,
          code: l.codigo,
          expiryDate: l.caducidad,
        })
        .onConflictDoNothing();
      const [lote] = await tx
        .select()
        .from(stockLots)
        .where(
          and(
            eq(stockLots.companyId, b.companyId),
            eq(stockLots.articleId, b.articulo.id),
            eq(stockLots.code, l.codigo),
          ),
        )
        .for('update');
      if (seg === 'serie') {
        const [s] = await tx
          .select({
            q: sql<string>`coalesce(sum(${stockMovementLots.quantity}), 0)`,
          })
          .from(stockMovementLots)
          .where(eq(stockMovementLots.lotId, lote.id));
        if (Number(s?.q ?? 0) > 0) {
          throw new ConflictException({
            code: 'BATCH_SERIAL_DUPLICATE',
            message: `El número de serie ${l.codigo} ya está en stock`,
          });
        }
      }
      if (l.caducidad && !lote.expiryDate) {
        await tx
          .update(stockLots)
          .set({ expiryDate: l.caducidad, version: lote.version + 1 })
          .where(eq(stockLots.id, lote.id));
      }
      filas.push({
        lotId: lote.id,
        almacenId: b.almacenId,
        cantidad: l.cantidad,
      });
    }
    await this.insertar(tx, b.companyId, b.movimientoId, filas);
  }

  /**
   * Salida (consumo a obra, faltante de regularización, origen de un
   * traspaso): lotes indicados o FEFO sobre la existencia del almacén.
   * Devuelve el reparto (para replicarlo en el destino de un traspaso).
   */
  async salir(
    tx: Tx,
    b: Base & { almacenId: string; lotes?: LoteIndicado[] | null },
  ): Promise<{ lotId: string; cantidad: string }[]> {
    const seg = this.seguimiento(b.articulo);
    const disponibles =
      seg === 'ninguno'
        ? []
        : await this.disponibles(tx, b.companyId, b.almacenId, b.articulo.id);
    const asignados = regla(() =>
      asignarLotesSalida({
        seguimiento: seg,
        cantidad: b.cantidad,
        disponibles,
        explicitos: b.lotes,
      }),
    );
    await this.insertar(
      tx,
      b.companyId,
      b.movimientoId,
      asignados.map((a) => ({
        lotId: a.lotId,
        almacenId: b.almacenId,
        cantidad: `-${a.cantidad}`,
      })),
    );
    return asignados.map((a) => ({ lotId: a.lotId, cantidad: a.cantidad }));
  }

  /**
   * Devolución de obra: solo lotes que la obra consumió (neto de devoluciones
   * previas), indicados o por FEFO sobre lo consumido.
   */
  async devolver(
    tx: Tx,
    b: Base & {
      almacenId: string;
      projectId: string;
      lotes?: LoteIndicado[] | null;
    },
  ): Promise<void> {
    const seg = this.seguimiento(b.articulo);
    let consumidos: Awaited<ReturnType<LotesService['disponibles']>> = [];
    if (seg !== 'ninguno') {
      const r = await tx.execute(sql`
        select l.id as "lotId", l.code as codigo, (-sum(ml.quantity))::text as cantidad,
          l.expiry_date::text as caducidad, l.created_at::text as alta
        from stock_movement_lots ml
        join stock_movements m on m.id = ml.movement_id
        join stock_lots l on l.id = ml.lot_id
        where ml.company_id = ${b.companyId} and m.project_id = ${b.projectId}
          and l.article_id = ${b.articulo.id}
          and m.type in ('salida_obra', 'devolucion')
        group by l.id
        having -sum(ml.quantity) > 0`);
      consumidos = r.rows as typeof consumidos;
    }
    const asignados = regla(() =>
      asignarLotesSalida({
        seguimiento: seg,
        cantidad: b.cantidad,
        disponibles: consumidos,
        explicitos: b.lotes,
        devolucion: true,
      }),
    );
    await this.insertar(
      tx,
      b.companyId,
      b.movimientoId,
      asignados.map((a) => ({
        lotId: a.lotId,
        almacenId: b.almacenId,
        cantidad: a.cantidad,
      })),
    );
  }

  /** Traspaso: sale del origen (indicado o FEFO) y entra igual en el destino. */
  async traspasar(
    tx: Tx,
    b: Base & {
      origenId: string;
      destinoId: string;
      lotes?: LoteIndicado[] | null;
    },
  ): Promise<void> {
    const salida = await this.salir(tx, { ...b, almacenId: b.origenId });
    await this.insertar(
      tx,
      b.companyId,
      b.movimientoId,
      salida.map((s) => ({
        lotId: s.lotId,
        almacenId: b.destinoId,
        cantidad: s.cantidad,
      })),
    );
  }

  /** Regularización: el sobrante entra con sus lotes; el faltante sale (FEFO o indicado). */
  async regularizar(
    tx: Tx,
    b: Omit<Base, 'cantidad'> & {
      almacenId: string;
      diferencia: string;
      lotes?: LoteIndicado[] | null;
    },
  ): Promise<void> {
    if (b.diferencia.startsWith('-')) {
      await this.salir(tx, { ...b, cantidad: b.diferencia.slice(1) });
    } else {
      await this.entrar(tx, { ...b, cantidad: b.diferencia });
    }
  }

  /** Reparto por lote de los movimientos indicados (para sus DTO). */
  async porMovimientos(
    ids: string[],
  ): Promise<
    Map<string, { codigo: string; cantidad: number; almacenId: string }[]>
  > {
    const out = new Map<
      string,
      { codigo: string; cantidad: number; almacenId: string }[]
    >();
    if (ids.length === 0) return out;
    const filas = await this.dbs.db
      .select({
        movimientoId: stockMovementLots.movementId,
        codigo: stockLots.code,
        cantidad: stockMovementLots.quantity,
        almacenId: stockMovementLots.warehouseId,
      })
      .from(stockMovementLots)
      .innerJoin(stockLots, eq(stockLots.id, stockMovementLots.lotId))
      .where(inArray(stockMovementLots.movementId, ids))
      .orderBy(asc(stockLots.code), asc(stockMovementLots.createdAt));
    for (const f of filas) {
      const l = out.get(f.movimientoId) ?? [];
      l.push({
        codigo: f.codigo,
        cantidad: Number(f.cantidad),
        almacenId: f.almacenId,
      });
      out.set(f.movimientoId, l);
    }
    return out;
  }

  /** Almacenes visibles (centrales y acopios de las obras accesibles). */
  private async almacenesVisibles(): Promise<string[] | null> {
    const obras = await this.dbs.getObrasAccesibles();
    if (obras === null) return null;
    const filas = await this.dbs.db
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(
        and(
          eq(warehouses.companyId, this.dbs.getCompanyId()),
          obras.length === 0
            ? eq(warehouses.kind, 'central')
            : sql`(${warehouses.kind} = 'central' or ${inArray(warehouses.projectId, obras)})`,
        ),
      );
    return filas.map((f) => f.id);
  }

  /** Lotes y series con su existencia por almacén visible. */
  async listar(q: LotesQuery): Promise<LoteDto[]> {
    const companyId = this.dbs.getCompanyId();
    const visibles = await this.almacenesVisibles();
    const f: SQL[] = [eq(stockLots.companyId, companyId)];
    if (q.articuloId) f.push(eq(stockLots.articleId, q.articuloId));
    if (q.q)
      f.push(
        sql`${stockLots.code} ilike ${`%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`,
      );
    const lotes = await this.dbs.db
      .select({ l: stockLots, a: stockArticles })
      .from(stockLots)
      .innerJoin(stockArticles, eq(stockArticles.id, stockLots.articleId))
      .where(and(...f))
      .orderBy(asc(stockArticles.code), asc(stockLots.code))
      .limit(500);
    if (lotes.length === 0) return [];
    const saldos = await this.dbs.db
      .select({
        lotId: stockMovementLots.lotId,
        almacenId: stockMovementLots.warehouseId,
        almacenCodigo: warehouses.code,
        cantidad: sql<string>`sum(${stockMovementLots.quantity})`,
      })
      .from(stockMovementLots)
      .innerJoin(warehouses, eq(warehouses.id, stockMovementLots.warehouseId))
      .where(
        and(
          inArray(
            stockMovementLots.lotId,
            lotes.map((x) => x.l.id),
          ),
          visibles === null
            ? undefined
            : visibles.length === 0
              ? sql`false`
              : inArray(stockMovementLots.warehouseId, visibles),
          q.almacenId
            ? eq(stockMovementLots.warehouseId, q.almacenId)
            : undefined,
        ),
      )
      .groupBy(
        stockMovementLots.lotId,
        stockMovementLots.warehouseId,
        warehouses.code,
      )
      .having(sql`sum(${stockMovementLots.quantity}) <> 0`);
    const porLote = new Map<string, LoteDto['porAlmacen']>();
    for (const s of saldos) {
      const l = porLote.get(s.lotId) ?? [];
      l.push({
        almacenId: s.almacenId,
        almacenCodigo: s.almacenCodigo,
        cantidad: Number(s.cantidad),
      });
      porLote.set(s.lotId, l);
    }
    return lotes
      .map(({ l, a }) => {
        const porAlmacen = (porLote.get(l.id) ?? []).sort((x, y) =>
          x.almacenCodigo.localeCompare(y.almacenCodigo),
        );
        return {
          id: l.id,
          articuloId: a.id,
          articuloCodigo: a.code,
          articuloNombre: a.name,
          seguimiento: l.kind as LoteDto['seguimiento'],
          codigo: l.code,
          caducidad: l.expiryDate,
          cantidad: Number(
            porAlmacen.reduce((t, x) => t + x.cantidad, 0).toFixed(3),
          ),
          porAlmacen,
          alta: l.createdAt.toISOString().slice(0, 10),
        };
      })
      .filter((l) => (q.conStock ? l.cantidad > 0 : true))
      .filter((l) => (q.almacenId ? l.porAlmacen.length > 0 : true));
  }

  /** Trazabilidad de un lote o serie: movimientos y obras que lo consumieron. */
  async traza(id: string): Promise<TrazaLoteDto> {
    const companyId = this.dbs.getCompanyId();
    const [base] = (await this.listar({})).filter((l) => l.id === id);
    const [existe] = await this.dbs.db
      .select({ id: stockLots.id })
      .from(stockLots)
      .where(and(eq(stockLots.id, id), eq(stockLots.companyId, companyId)));
    if (!existe || !base) {
      throw new NotFoundException({
        code: 'BATCH_SERIAL_NOT_FOUND',
        message: 'Lote o número de serie no encontrado',
      });
    }
    const visibles = await this.almacenesVisibles();
    const movs = await this.dbs.db
      .select({
        movimientoId: stockMovements.id,
        tipo: stockMovements.type,
        fecha: stockMovements.movementDate,
        almacenId: stockMovementLots.warehouseId,
        almacenCodigo: warehouses.code,
        cantidad: stockMovementLots.quantity,
        projectId: stockMovements.projectId,
        albaranId: stockMovements.deliveryNoteId,
      })
      .from(stockMovementLots)
      .innerJoin(
        stockMovements,
        eq(stockMovements.id, stockMovementLots.movementId),
      )
      .innerJoin(warehouses, eq(warehouses.id, stockMovementLots.warehouseId))
      .where(
        and(
          eq(stockMovementLots.lotId, id),
          visibles === null
            ? undefined
            : visibles.length === 0
              ? sql`false`
              : inArray(stockMovementLots.warehouseId, visibles),
        ),
      )
      .orderBy(
        asc(stockMovements.movementDate),
        asc(stockMovements.createdAt),
        asc(stockMovementLots.createdAt),
      );
    const obras = new Map<string, number>();
    for (const m of movs) {
      if (
        m.projectId &&
        (m.tipo === 'salida_obra' || m.tipo === 'devolucion')
      ) {
        obras.set(
          m.projectId,
          Number(
            ((obras.get(m.projectId) ?? 0) - Number(m.cantidad)).toFixed(3),
          ),
        );
      }
    }
    return {
      ...base,
      movimientos: movs.map((m) => ({ ...m, cantidad: Number(m.cantidad) })),
      obras: [...obras.entries()]
        .filter(([, q]) => q !== 0)
        .map(([projectId, cantidad]) => ({ projectId, cantidad })),
    };
  }
}
