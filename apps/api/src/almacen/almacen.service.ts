import { randomUUID } from 'node:crypto';
import {
  ConflictException,
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
  lte,
  or,
  sql,
  SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  deliveryNotes,
  projects,
  stockArticles,
  stockItems,
  stockMovements,
  warehouses,
  type StockArticle,
  type StockItem,
  type StockMovement,
  type Tx,
  type Warehouse,
} from '@erp/db';
import {
  ErrorStock,
  almacenCreateSchema,
  almacenUpdateSchema,
  articuloCreateSchema,
  articuloUpdateSchema,
  calcularOffset,
  centsToNumeric,
  consumoObraSchema,
  construirPagina,
  devolucionObraSchema,
  entradaStock,
  entradaStockSchema,
  esModoPaginado,
  existenciaUpdateSchema,
  fromCents,
  normalizarPaginacion,
  pmpDe,
  regularizacionStock,
  regularizacionStockSchema,
  salidaStock,
  sumCents,
  toCents,
  traspasoStock,
  traspasoStockSchema,
  valorEntradaStock,
  type AlmacenCreateInput,
  type AlmacenDto,
  type AlmacenUpdateInput,
  type ArticuloCreateInput,
  type ArticuloDto,
  type ArticuloUpdateInput,
  type ConsumoObraDto,
  type ConsumoObraInput,
  type DevolucionObraInput,
  type EntradaStockInput,
  type ExistenciaDto,
  type ExistenciasQuery,
  type ExistenciaUpdateInput,
  type MovimientoStockDto,
  type MovimientosQuery,
  type OrigenAsiento,
  type PaginaDto,
  type RegularizacionStockInput,
  type SaldoValorado,
  type TipoAlmacen,
  type TipoMovimientoStock,
  type TraspasoStockInput,
  type UnidadStock,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { getRequestContext } from '../common/request-context';
import { verificarVersion } from '../common/version';
import { ContabilidadService } from '../contabilidad/contabilidad.service';
import { ControlPresupuestarioService } from '../cost-control/control-presupuestario.service';
import { DbService } from '../db/db.service';

/*
 * Referencias cualificadas a la fila exterior en subconsultas correlacionadas:
 * en una SELECT de una sola tabla Drizzle no prefija las columnas, y dentro
 * de la subconsulta "id" se resolvería contra la tabla interna.
 */
const COL_ARTICULO_ID = sql.raw('"stock_articles"."id"');
const COL_ALMACEN_ID = sql.raw('"warehouses"."id"');

/** Máximo de movimientos de un listado no paginado. */
const LIMITE_MOVIMIENTOS = 500;

/* ───────────────────────────── errores ───────────────────────────── */

function noEncontrado(code: string, message: string): NotFoundException {
  return new NotFoundException({ code, message });
}

const almacenNoEncontrado = () =>
  noEncontrado('WAREHOUSE_NOT_FOUND', 'Almacén no encontrado');
const articuloNoEncontrado = () =>
  noEncontrado('STOCK_ARTICLE_NOT_FOUND', 'Artículo no encontrado');

/** Traduce el rechazo de una regla pura de stock a RFC 7807. */
function traducirErrorStock(e: unknown): never {
  if (e instanceof ErrorStock) {
    if (e.codigo === 'INSUFFICIENT_STOCK') {
      throw new ConflictException({
        code: e.codigo,
        message: e.message,
        disponible:
          e.disponible === undefined ? undefined : Number(e.disponible),
      });
    }
    throw new UnprocessableEntityException({
      code: e.codigo,
      message: e.message,
    });
  }
  throw e;
}

/** Ejecuta una regla pura y traduce su rechazo. */
function regla<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    return traducirErrorStock(e);
  }
}

/** PMP (número) de un saldo; con saldo cero, el último conocido. */
function pmpNumero(s: SaldoValorado, ultimo: string): string {
  return s.pmp ?? ultimo;
}

/* ───────────────────────────── mapeos ───────────────────────────── */

function existenciaDto(
  i: StockItem,
  w: Pick<Warehouse, 'code' | 'name'>,
  a: Pick<StockArticle, 'code' | 'name' | 'unit'>,
): ExistenciaDto {
  const cantidad = Number(i.quantity);
  const reservada = Number(i.reservedQuantity);
  const minimo = Number(i.minStock);
  return {
    id: i.id,
    almacenId: i.warehouseId,
    almacenCodigo: w.code,
    almacenNombre: w.name,
    articuloId: i.articleId,
    articuloCodigo: a.code,
    articuloNombre: a.name,
    unidad: a.unit as UnidadStock,
    cantidad,
    reservada,
    disponible: Number((cantidad - reservada).toFixed(3)),
    pmp: Number(i.averageCost),
    valor: Number(i.stockValue),
    stockMinimo: minimo,
    bajoMinimo: minimo > 0 && cantidad <= minimo,
    version: i.version,
  };
}

const destino = alias(warehouses, 'destino');

interface FilaMovimiento {
  m: StockMovement;
  almacenCodigo: string;
  destinoCodigo: string | null;
  articuloCodigo: string;
  articuloNombre: string;
  unidad: string;
}

function movimientoDto(f: FilaMovimiento): MovimientoStockDto {
  const m = f.m;
  return {
    id: m.id,
    tipo: m.type as TipoMovimientoStock,
    fecha: m.movementDate,
    almacenId: m.warehouseId,
    almacenCodigo: f.almacenCodigo,
    almacenDestinoId: m.targetWarehouseId,
    almacenDestinoCodigo: f.destinoCodigo,
    articuloId: m.articleId,
    articuloCodigo: f.articuloCodigo,
    articuloNombre: f.articuloNombre,
    unidad: f.unidad as UnidadStock,
    cantidad: Number(m.quantity),
    costeUnitario: Number(m.unitCost),
    valor: Number(m.totalValue),
    cantidadResultante: Number(m.quantityAfter),
    pmpResultante: Number(m.averageCostAfter),
    projectId: m.projectId,
    albaranId: m.deliveryNoteId,
    asientoId: m.journalEntryId,
    motivo: m.reason,
    notas: m.notes,
    usuarioId: m.createdBy,
    creadoEn: m.createdAt.toISOString(),
  };
}

/** Negativo de un texto `numeric` (para cantidades y valores de salida). */
function negativo(n: string): string {
  return n.startsWith('-') ? n.slice(1) : `-${n}`;
}

interface NuevoMovimiento {
  id: string;
  companyId: string;
  tipo: TipoMovimientoStock;
  fecha: string;
  almacenId: string;
  destinoId?: string | null;
  articuloId: string;
  projectId?: string | null;
  albaranId?: string | null;
  cantidad: string;
  valor: string;
  saldo: SaldoValorado;
  ultimoPmp: string;
  motivo?: string | null;
  notas?: string | null;
  asientoId: string | null;
}

/**
 * Almacén y stock (SAP MM / Oracle Inventory) con valoración a PMP.
 *
 * Cada operación es una transacción que bloquea (`FOR UPDATE`, en orden
 * estable para no provocar interbloqueos) los saldos que toca, valora con las
 * funciones puras de `calculo.ts`, escribe el movimiento inmutable, actualiza
 * el saldo (versión + 1), contabiliza por `ContabilidadService.contabilizarEnTx`
 * (cuadre, cuentas y período cerrado del libro mayor) y audita. Cualquier
 * rechazo deshace todo.
 */
@Injectable()
export class AlmacenService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly contabilidad: ContabilidadService,
    private readonly control: ControlPresupuestarioService,
  ) {}

  /* ─────────────────────────── acceso ─────────────────────────── */

  /**
   * Filtro de almacenes visibles: los roles con acceso por obra ven los
   * centrales y los acopios de sus obras.
   */
  private async filtroVisibles(): Promise<SQL | undefined> {
    const obras = await this.dbs.getObrasAccesibles();
    if (obras === null) return undefined;
    return obras.length === 0
      ? eq(warehouses.kind, 'central')
      : or(
          eq(warehouses.kind, 'central'),
          inArray(warehouses.projectId, obras),
        );
  }

  private async cargarAlmacen(
    tx: Tx,
    companyId: string,
    id: string,
    exigirActivo = true,
  ): Promise<Warehouse> {
    const [w] = await tx
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.id, id), eq(warehouses.companyId, companyId)))
      .limit(1);
    if (!w) throw almacenNoEncontrado();
    if (w.kind === 'obra') {
      const obras = await this.dbs.getObrasAccesibles();
      if (obras !== null && !obras.includes(w.projectId!)) {
        throw almacenNoEncontrado();
      }
    }
    if (exigirActivo && !w.isActive) {
      throw new ConflictException({
        code: 'WAREHOUSE_INACTIVE',
        message: `El almacén ${w.code} está inactivo`,
      });
    }
    return w;
  }

  private async cargarArticulo(
    tx: Tx,
    companyId: string,
    id: string,
  ): Promise<StockArticle> {
    const [a] = await tx
      .select()
      .from(stockArticles)
      .where(
        and(eq(stockArticles.id, id), eq(stockArticles.companyId, companyId)),
      )
      .limit(1);
    if (!a) throw articuloNoEncontrado();
    if (!a.isActive) {
      throw new ConflictException({
        code: 'STOCK_ARTICLE_INACTIVE',
        message: `El artículo ${a.code} está inactivo`,
      });
    }
    return a;
  }

  /** La obra existe en la empresa y el usuario tiene acceso. */
  private async validarObra(
    tx: Tx,
    companyId: string,
    projectId: string,
  ): Promise<{ id: string; code: string }> {
    const obras = await this.dbs.getObrasAccesibles();
    const [p] = await tx
      .select({ id: projects.id, code: projects.code })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.companyId, companyId)))
      .limit(1);
    if (!p || (obras !== null && !obras.includes(p.id))) {
      throw new UnprocessableEntityException({
        code: 'PROJECT_NOT_FOUND',
        message: 'La obra no existe',
      });
    }
    return p;
  }

  /** Saldo del artículo en el almacén, creado si no existía, bloqueado. */
  private async bloquearSaldo(
    tx: Tx,
    companyId: string,
    warehouseId: string,
    articleId: string,
  ): Promise<StockItem> {
    await tx
      .insert(stockItems)
      .values({ companyId, warehouseId, articleId })
      .onConflictDoNothing();
    const [i] = await tx
      .select()
      .from(stockItems)
      .where(
        and(
          eq(stockItems.warehouseId, warehouseId),
          eq(stockItems.articleId, articleId),
        ),
      )
      .for('update');
    return i;
  }

  private async guardarSaldo(
    tx: Tx,
    item: StockItem,
    s: SaldoValorado,
  ): Promise<StockItem> {
    const [nuevo] = await tx
      .update(stockItems)
      .set({
        quantity: s.cantidad,
        stockValue: s.valor,
        averageCost: pmpNumero(s, item.averageCost),
        version: item.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(stockItems.id, item.id))
      .returning();
    return nuevo;
  }

  /** Asiento de dos líneas (debe/haber) por el valor absoluto; null si es 0. */
  private async asiento(
    tx: Tx,
    p: {
      companyId: string;
      fecha: string;
      concepto: string;
      origen: OrigenAsiento;
      origenId: string;
      valor: string;
      debe: { cuenta: string; projectId: string | null };
      haber: { cuenta: string; projectId: string | null };
    },
  ): Promise<string | null> {
    const cents = toCents(p.valor);
    const abs = cents < 0n ? -cents : cents;
    if (abs === 0n) return null;
    const importe = centsToNumeric(abs);
    const a = await this.contabilidad.contabilizarEnTx(tx, {
      companyId: p.companyId,
      fecha: p.fecha,
      concepto: p.concepto,
      origen: p.origen,
      origenId: p.origenId,
      lineas: [
        {
          cuenta: p.debe.cuenta,
          debe: importe,
          haber: '0.00',
          projectId: p.debe.projectId,
          concepto: p.concepto,
        },
        {
          cuenta: p.haber.cuenta,
          debe: '0.00',
          haber: importe,
          projectId: p.haber.projectId,
          concepto: p.concepto,
        },
      ],
    });
    return a.id;
  }

  private async registrarMovimiento(
    tx: Tx,
    n: NuevoMovimiento,
  ): Promise<string> {
    const cantidadAbs = n.cantidad.replace(/^-/, '');
    const valorAbs = n.valor.replace(/^-/, '');
    const coste =
      pmpDe({ cantidad: cantidadAbs, valor: valorAbs }) ?? n.ultimoPmp;
    const [m] = await tx
      .insert(stockMovements)
      .values({
        id: n.id,
        companyId: n.companyId,
        type: n.tipo,
        movementDate: n.fecha,
        warehouseId: n.almacenId,
        targetWarehouseId: n.destinoId ?? null,
        articleId: n.articuloId,
        projectId: n.projectId ?? null,
        deliveryNoteId: n.albaranId ?? null,
        quantity: n.cantidad,
        unitCost: coste,
        totalValue: n.valor,
        quantityAfter: n.saldo.cantidad,
        averageCostAfter: pmpNumero(n.saldo, n.ultimoPmp),
        reason: n.motivo ?? null,
        notes: n.notas ?? null,
        journalEntryId: n.asientoId,
        createdBy: getRequestContext()?.userId ?? null,
      })
      .returning();
    await this.audit.registrar(tx, {
      entityType: 'stock_movement',
      entityId: m.id,
      action: 'create',
      newData: m,
    });
    return m.id;
  }

  /* ─────────────────────────── almacenes ─────────────────────────── */

  async listarAlmacenes(f: { activo?: boolean } = {}): Promise<AlmacenDto[]> {
    const companyId = this.dbs.getCompanyId();
    const filtros: (SQL | undefined)[] = [
      eq(warehouses.companyId, companyId),
      await this.filtroVisibles(),
    ];
    if (f.activo !== undefined) filtros.push(eq(warehouses.isActive, f.activo));
    const filas = await this.dbs.db
      .select({
        w: warehouses,
        projectNombre: projects.name,
        valor: sql<string>`coalesce((select sum(si.stock_value) from stock_items si where si.warehouse_id = ${COL_ALMACEN_ID}), 0)`,
        alertas: sql<number>`(select count(*)::int from stock_items si where si.warehouse_id = ${COL_ALMACEN_ID} and si.min_stock > 0 and si.quantity <= si.min_stock)`,
      })
      .from(warehouses)
      .leftJoin(projects, eq(projects.id, warehouses.projectId))
      .where(and(...filtros))
      .orderBy(asc(warehouses.code));
    return filas.map((f) => ({
      id: f.w.id,
      codigo: f.w.code,
      nombre: f.w.name,
      tipo: f.w.kind as TipoAlmacen,
      projectId: f.w.projectId,
      projectNombre: f.projectNombre ?? null,
      direccion: f.w.address,
      activo: f.w.isActive,
      valor: Number(f.valor),
      alertas: Number(f.alertas),
      version: f.w.version,
    }));
  }

  private async almacenDto(id: string): Promise<AlmacenDto> {
    const todos = await this.listarAlmacenes();
    const a = todos.find((w) => w.id === id);
    if (!a) throw almacenNoEncontrado();
    return a;
  }

  async crearAlmacen(input: AlmacenCreateInput): Promise<AlmacenDto> {
    const companyId = this.dbs.getCompanyId();
    const d = almacenCreateSchema.parse(input);
    const id = await this.dbs.db.transaction(async (tx) => {
      if (d.projectId) await this.validarObra(tx, companyId, d.projectId);
      const [dup] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(
          and(
            eq(warehouses.companyId, companyId),
            eq(warehouses.code, d.codigo),
          ),
        )
        .limit(1);
      if (dup) {
        throw new ConflictException({
          code: 'WAREHOUSE_CODE_DUPLICATE',
          message: `Ya existe el almacén ${d.codigo}`,
        });
      }
      const [w] = await tx
        .insert(warehouses)
        .values({
          companyId,
          code: d.codigo,
          name: d.nombre,
          kind: d.tipo,
          projectId: d.projectId ?? null,
          address: d.direccion ?? null,
        })
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'warehouse',
        entityId: w.id,
        action: 'create',
        newData: w,
      });
      return w.id;
    });
    return this.almacenDto(id);
  }

  async actualizarAlmacen(
    id: string,
    input: AlmacenUpdateInput,
    versionEsperada: number | undefined,
  ): Promise<AlmacenDto> {
    const companyId = this.dbs.getCompanyId();
    const d = almacenUpdateSchema.parse(input);
    await this.dbs.db.transaction(async (tx) => {
      const [w] = await tx
        .select()
        .from(warehouses)
        .where(and(eq(warehouses.id, id), eq(warehouses.companyId, companyId)))
        .for('update');
      if (!w) throw almacenNoEncontrado();
      verificarVersion(w.version, versionEsperada);
      if (d.activo === false && w.isActive) {
        const [conStock] = await tx
          .select({ id: stockItems.id })
          .from(stockItems)
          .where(
            and(
              eq(stockItems.warehouseId, id),
              sql`${stockItems.quantity} > 0`,
            ),
          )
          .limit(1);
        if (conStock) {
          throw new ConflictException({
            code: 'WAREHOUSE_HAS_STOCK',
            message:
              'El almacén tiene existencias: trasládalas o regulariza antes de desactivarlo',
          });
        }
      }
      const [nuevo] = await tx
        .update(warehouses)
        .set({
          ...(d.nombre !== undefined && { name: d.nombre }),
          ...(d.direccion !== undefined && { address: d.direccion ?? null }),
          ...(d.activo !== undefined && { isActive: d.activo }),
          version: w.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(warehouses.id, id))
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'warehouse',
        entityId: id,
        action: 'update',
        oldData: w,
        newData: nuevo,
      });
    });
    return this.almacenDto(id);
  }

  /* ─────────────────────────── artículos ─────────────────────────── */

  async listarArticulos(
    f: { q?: string; activo?: boolean } = {},
  ): Promise<ArticuloDto[]> {
    const companyId = this.dbs.getCompanyId();
    const filtros: SQL[] = [eq(stockArticles.companyId, companyId)];
    if (f.activo !== undefined) {
      filtros.push(eq(stockArticles.isActive, f.activo));
    }
    if (f.q) {
      const patron = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      filtros.push(
        sql`(${stockArticles.code} ILIKE ${patron} OR ${stockArticles.name} ILIKE ${patron})`,
      );
    }
    const filas = await this.dbs.db
      .select({
        a: stockArticles,
        cantidad: sql<string>`coalesce((select sum(si.quantity) from stock_items si where si.article_id = ${COL_ARTICULO_ID}), 0)`,
        valor: sql<string>`coalesce((select sum(si.stock_value) from stock_items si where si.article_id = ${COL_ARTICULO_ID}), 0)`,
      })
      .from(stockArticles)
      .where(and(...filtros))
      .orderBy(asc(stockArticles.code));
    return filas.map(({ a, cantidad, valor }) => ({
      id: a.id,
      codigo: a.code,
      nombre: a.name,
      unidad: a.unit as UnidadStock,
      cuentaExistencias: a.inventoryAccount,
      cuentaVariacion: a.variationAccount,
      activo: a.isActive,
      notas: a.notes,
      cantidadTotal: Number(cantidad),
      valorTotal: Number(valor),
      version: a.version,
    }));
  }

  private async articuloDto(id: string): Promise<ArticuloDto> {
    const a = (await this.listarArticulos()).find((x) => x.id === id);
    if (!a) throw articuloNoEncontrado();
    return a;
  }

  async crearArticulo(input: ArticuloCreateInput): Promise<ArticuloDto> {
    const companyId = this.dbs.getCompanyId();
    const d = articuloCreateSchema.parse(input);
    const id = await this.dbs.db.transaction(async (tx) => {
      const [dup] = await tx
        .select({ id: stockArticles.id })
        .from(stockArticles)
        .where(
          and(
            eq(stockArticles.companyId, companyId),
            eq(stockArticles.code, d.codigo),
          ),
        )
        .limit(1);
      if (dup) {
        throw new ConflictException({
          code: 'STOCK_ARTICLE_CODE_DUPLICATE',
          message: `Ya existe el artículo ${d.codigo}`,
        });
      }
      const [a] = await tx
        .insert(stockArticles)
        .values({
          companyId,
          code: d.codigo,
          name: d.nombre,
          unit: d.unidad,
          inventoryAccount: d.cuentaExistencias,
          variationAccount: d.cuentaVariacion,
          notes: d.notas ?? null,
        })
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'stock_article',
        entityId: a.id,
        action: 'create',
        newData: a,
      });
      return a.id;
    });
    return this.articuloDto(id);
  }

  async actualizarArticulo(
    id: string,
    input: ArticuloUpdateInput,
    versionEsperada: number | undefined,
  ): Promise<ArticuloDto> {
    const companyId = this.dbs.getCompanyId();
    const d = articuloUpdateSchema.parse(input);
    await this.dbs.db.transaction(async (tx) => {
      const [a] = await tx
        .select()
        .from(stockArticles)
        .where(
          and(eq(stockArticles.id, id), eq(stockArticles.companyId, companyId)),
        )
        .for('update');
      if (!a) throw articuloNoEncontrado();
      verificarVersion(a.version, versionEsperada);
      const [nuevo] = await tx
        .update(stockArticles)
        .set({
          ...(d.nombre !== undefined && { name: d.nombre }),
          ...(d.cuentaExistencias !== undefined && {
            inventoryAccount: d.cuentaExistencias,
          }),
          ...(d.cuentaVariacion !== undefined && {
            variationAccount: d.cuentaVariacion,
          }),
          ...(d.activo !== undefined && { isActive: d.activo }),
          ...(d.notas !== undefined && { notes: d.notas ?? null }),
          version: a.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(stockArticles.id, id))
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'stock_article',
        entityId: id,
        action: 'update',
        oldData: a,
        newData: nuevo,
      });
    });
    return this.articuloDto(id);
  }

  /* ────────────────────────── existencias ────────────────────────── */

  async existencias(f: ExistenciasQuery): Promise<ExistenciaDto[]> {
    const companyId = this.dbs.getCompanyId();
    const filtros: (SQL | undefined)[] = [
      eq(stockItems.companyId, companyId),
      await this.filtroVisibles(),
    ];
    if (f.almacenId) filtros.push(eq(stockItems.warehouseId, f.almacenId));
    if (f.articuloId) filtros.push(eq(stockItems.articleId, f.articuloId));
    if (f.bajoMinimo) {
      filtros.push(
        sql`${stockItems.minStock} > 0 AND ${stockItems.quantity} <= ${stockItems.minStock}`,
      );
    } else if (!f.conCero) {
      filtros.push(
        sql`(${stockItems.quantity} > 0 OR ${stockItems.minStock} > 0)`,
      );
    }
    if (f.q) {
      const patron = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      filtros.push(
        sql`(${stockArticles.code} ILIKE ${patron} OR ${stockArticles.name} ILIKE ${patron})`,
      );
    }
    const filas = await this.dbs.db
      .select({ i: stockItems, w: warehouses, a: stockArticles })
      .from(stockItems)
      .innerJoin(warehouses, eq(warehouses.id, stockItems.warehouseId))
      .innerJoin(stockArticles, eq(stockArticles.id, stockItems.articleId))
      .where(and(...filtros))
      .orderBy(asc(warehouses.code), asc(stockArticles.code));
    return filas.map(({ i, w, a }) => existenciaDto(i, w, a));
  }

  async actualizarExistencia(
    id: string,
    input: ExistenciaUpdateInput,
    versionEsperada: number | undefined,
  ): Promise<ExistenciaDto> {
    const companyId = this.dbs.getCompanyId();
    const d = existenciaUpdateSchema.parse(input);
    return this.dbs.db.transaction(async (tx) => {
      const [i] = await tx
        .select()
        .from(stockItems)
        .where(and(eq(stockItems.id, id), eq(stockItems.companyId, companyId)))
        .for('update');
      if (!i) {
        throw noEncontrado('STOCK_ITEM_NOT_FOUND', 'Existencia no encontrada');
      }
      const w = await this.cargarAlmacen(tx, companyId, i.warehouseId, false);
      verificarVersion(i.version, versionEsperada);
      const [nuevo] = await tx
        .update(stockItems)
        .set({
          minStock: d.stockMinimo.toFixed(3),
          version: i.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(stockItems.id, id))
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'stock_item',
        entityId: id,
        action: 'update',
        oldData: { minStock: i.minStock },
        newData: { minStock: nuevo.minStock },
      });
      const [a] = await tx
        .select()
        .from(stockArticles)
        .where(eq(stockArticles.id, i.articleId));
      return existenciaDto(nuevo, w, a);
    });
  }

  async resumen() {
    const almacenes = await this.listarAlmacenes({ activo: true });
    const companyId = this.dbs.getCompanyId();
    const visibles = almacenes.map((a) => a.id);
    let lineas = new Map<string, number>();
    let articulos = 0;
    if (visibles.length > 0) {
      const filas = await this.dbs.db
        .select({
          warehouseId: stockItems.warehouseId,
          n: sql<number>`count(*)::int`,
        })
        .from(stockItems)
        .where(
          and(
            eq(stockItems.companyId, companyId),
            inArray(stockItems.warehouseId, visibles),
            sql`${stockItems.quantity} > 0`,
          ),
        )
        .groupBy(stockItems.warehouseId);
      lineas = new Map(filas.map((f) => [f.warehouseId, Number(f.n)]));
      const [d] = await this.dbs.db
        .select({
          n: sql<number>`count(distinct ${stockItems.articleId})::int`,
        })
        .from(stockItems)
        .where(
          and(
            inArray(stockItems.warehouseId, visibles),
            sql`${stockItems.quantity} > 0`,
          ),
        );
      articulos = Number(d?.n ?? 0);
    }
    return {
      valoracionTotal: fromCents(
        sumCents(almacenes.map((a) => toCents(a.valor))),
      ),
      almacenes: almacenes.length,
      articulosConStock: articulos,
      alertas: almacenes.reduce((s, a) => s + a.alertas, 0),
      porAlmacen: almacenes.map((a) => ({
        almacenId: a.id,
        codigo: a.codigo,
        nombre: a.nombre,
        tipo: a.tipo,
        valor: a.valor,
        lineas: lineas.get(a.id) ?? 0,
        alertas: a.alertas,
      })),
    };
  }

  /* ────────────────────────── movimientos ────────────────────────── */

  private consultaMovimientos() {
    return this.dbs.db
      .select({
        m: stockMovements,
        almacenCodigo: warehouses.code,
        destinoCodigo: destino.code,
        articuloCodigo: stockArticles.code,
        articuloNombre: stockArticles.name,
        unidad: stockArticles.unit,
      })
      .from(stockMovements)
      .innerJoin(warehouses, eq(warehouses.id, stockMovements.warehouseId))
      .leftJoin(destino, eq(destino.id, stockMovements.targetWarehouseId))
      .innerJoin(stockArticles, eq(stockArticles.id, stockMovements.articleId));
  }

  private async porIds(ids: string[]): Promise<MovimientoStockDto[]> {
    if (ids.length === 0) return [];
    const filas = await this.consultaMovimientos().where(
      inArray(stockMovements.id, ids),
    );
    const orden = new Map(ids.map((id, i) => [id, i]));
    return filas
      .map(movimientoDto)
      .sort((a, b) => orden.get(a.id)! - orden.get(b.id)!);
  }

  async movimientos(
    q: MovimientosQuery,
  ): Promise<MovimientoStockDto[] | PaginaDto<MovimientoStockDto>> {
    const companyId = this.dbs.getCompanyId();
    const filtros: (SQL | undefined)[] = [
      eq(stockMovements.companyId, companyId),
    ];
    const obras = await this.dbs.getObrasAccesibles();
    if (obras !== null) {
      // Movimientos de almacenes visibles (centrales o acopios de sus obras).
      filtros.push(
        obras.length === 0
          ? eq(warehouses.kind, 'central')
          : or(
              eq(warehouses.kind, 'central'),
              inArray(warehouses.projectId, obras),
            ),
      );
    }
    if (q.almacenId) {
      filtros.push(
        or(
          eq(stockMovements.warehouseId, q.almacenId),
          eq(stockMovements.targetWarehouseId, q.almacenId),
        ),
      );
    }
    if (q.articuloId) filtros.push(eq(stockMovements.articleId, q.articuloId));
    if (q.projectId) filtros.push(eq(stockMovements.projectId, q.projectId));
    if (q.tipo) filtros.push(eq(stockMovements.type, q.tipo));
    if (q.desde) filtros.push(gte(stockMovements.movementDate, q.desde));
    if (q.hasta) filtros.push(lte(stockMovements.movementDate, q.hasta));
    const where = and(...filtros);
    const orden = [
      desc(stockMovements.movementDate),
      desc(stockMovements.createdAt),
      desc(stockMovements.id),
    ];
    if (!esModoPaginado(q)) {
      const filas = await this.consultaMovimientos()
        .where(where)
        .orderBy(...orden)
        .limit(LIMITE_MOVIMIENTOS);
      return filas.map(movimientoDto);
    }
    const { page, pageSize } = normalizarPaginacion(q);
    const [filas, [{ total }]] = await Promise.all([
      this.consultaMovimientos()
        .where(where)
        .orderBy(...orden)
        .limit(pageSize)
        .offset(calcularOffset(page, pageSize)),
      this.dbs.db
        .select({ total: sql<number>`count(*)::int` })
        .from(stockMovements)
        .innerJoin(warehouses, eq(warehouses.id, stockMovements.warehouseId))
        .where(where),
    ]);
    return construirPagina(
      filas.map(movimientoDto),
      Number(total),
      page,
      pageSize,
    );
  }

  /* ──────────────────────────── entradas ──────────────────────────── */

  /**
   * Entrada de material (recepción de albarán o manual): suma existencias,
   * recalcula el PMP y contabiliza `existencias a variación` por línea.
   * Un albarán se recepciona en stock una sola vez y por un valor que no
   * supera su importe.
   */
  async entrada(input: EntradaStockInput): Promise<MovimientoStockDto[]> {
    const companyId = this.dbs.getCompanyId();
    const d = entradaStockSchema.parse(input);
    const ids = await this.dbs.db.transaction(async (tx) => {
      const w = await this.cargarAlmacen(tx, companyId, d.almacenId);
      let albaran: { id: string; number: string } | null = null;
      const valores = d.lineas.map((l) =>
        regla(() => valorEntradaStock(l.cantidad, l.costeUnitario)),
      );
      if (d.albaranId) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`albaran-stock:${d.albaranId}`}))`,
        );
        const [n] = await tx
          .select()
          .from(deliveryNotes)
          .where(
            and(
              eq(deliveryNotes.id, d.albaranId),
              eq(deliveryNotes.companyId, companyId),
              sql`${deliveryNotes.deletedAt} IS NULL`,
            ),
          )
          .limit(1);
        if (!n) {
          throw new UnprocessableEntityException({
            code: 'DELIVERY_NOTE_NOT_FOUND',
            message: 'El albarán no existe',
          });
        }
        const [ya] = await tx
          .select({ id: stockMovements.id })
          .from(stockMovements)
          .where(eq(stockMovements.deliveryNoteId, n.id))
          .limit(1);
        if (ya) {
          throw new ConflictException({
            code: 'DELIVERY_NOTE_ALREADY_STOCKED',
            message: `El albarán ${n.noteNumber} ya se recepcionó en stock`,
          });
        }
        const total = sumCents(valores.map(toCents));
        if (total > toCents(n.amount)) {
          throw new UnprocessableEntityException({
            code: 'DELIVERY_NOTE_AMOUNT_EXCEEDED',
            message: `La entrada (${centsToNumeric(total)} €) supera el importe del albarán ${n.noteNumber} (${n.amount} €)`,
          });
        }
        albaran = { id: n.id, number: n.noteNumber };
      }
      const lineas = d.lineas
        .map((l, i) => ({ ...l, valor: valores[i] }))
        .sort((a, b) => a.articuloId.localeCompare(b.articuloId));
      const creados: string[] = [];
      for (const l of lineas) {
        const art = await this.cargarArticulo(tx, companyId, l.articuloId);
        const item = await this.bloquearSaldo(tx, companyId, w.id, art.id);
        const cantidad = l.cantidad.toFixed(3);
        const saldo = regla(() =>
          entradaStock(
            { cantidad: item.quantity, valor: item.stockValue },
            { cantidad, valor: l.valor },
          ),
        );
        const id = randomUUID();
        const concepto = `Entrada ${art.code} en ${w.code}${albaran ? ` · albarán ${albaran.number}` : ''}`;
        const asientoId = await this.asiento(tx, {
          companyId,
          fecha: d.fecha,
          concepto,
          origen: 'entrada_almacen',
          origenId: id,
          valor: l.valor,
          debe: { cuenta: art.inventoryAccount, projectId: null },
          haber: { cuenta: art.variationAccount, projectId: null },
        });
        creados.push(
          await this.registrarMovimiento(tx, {
            id,
            companyId,
            tipo: 'entrada_compra',
            fecha: d.fecha,
            almacenId: w.id,
            articuloId: art.id,
            albaranId: albaran?.id,
            cantidad,
            valor: l.valor,
            saldo,
            ultimoPmp: item.averageCost,
            notas: d.notas,
            asientoId,
          }),
        );
        await this.guardarSaldo(tx, item, saldo);
      }
      return creados;
    });
    return this.porIds(ids);
  }

  /* ───────────────────────── consumo a obra ───────────────────────── */

  /**
   * Salida de material imputada a una obra: valora al PMP vigente sin
   * alterarlo y contabiliza `variación (obra) a existencias`.
   */
  async consumo(input: ConsumoObraInput): Promise<MovimientoStockDto[]> {
    const companyId = this.dbs.getCompanyId();
    const d = consumoObraSchema.parse(input);
    const ids = await this.dbs.db.transaction(async (tx) => {
      const w = await this.cargarAlmacen(tx, companyId, d.almacenId);
      const obra = await this.validarObra(tx, companyId, d.projectId);
      this.exigirAcopioDeLaObra(w, obra.id);
      const lineas = [...d.lineas].sort((a, b) =>
        a.articuloId.localeCompare(b.articuloId),
      );
      // 1) Bloquea y valora todas las líneas sin escribir nada.
      const valoradas = [];
      for (const l of lineas) {
        const art = await this.cargarArticulo(tx, companyId, l.articuloId);
        const item = await this.bloquearSaldo(tx, companyId, w.id, art.id);
        const cantidad = l.cantidad.toFixed(3);
        const sal = regla(() =>
          salidaStock(
            { cantidad: item.quantity, valor: item.stockValue },
            cantidad,
            item.reservedQuantity,
          ),
        );
        valoradas.push({ art, item, cantidad, sal });
      }
      // 2) Control presupuestario activo con el coste total imputado (antes
      //    de cualquier escritura en audit_log de esta transacción).
      await this.control.verificar(tx, {
        projectId: obra.id,
        importe: centsToNumeric(
          sumCents(valoradas.map((v) => toCents(v.sal.valor))),
        ),
        operacion: 'consumo_almacen',
        referencia: w.code,
      });
      // 3) Asientos, kárdex y saldos.
      const creados: string[] = [];
      for (const { art, item, cantidad, sal } of valoradas) {
        const id = randomUUID();
        const concepto = `Consumo ${art.code} de ${w.code} a obra ${obra.code}`;
        const asientoId = await this.asiento(tx, {
          companyId,
          fecha: d.fecha,
          concepto,
          origen: 'consumo_obra',
          origenId: id,
          valor: sal.valor,
          debe: { cuenta: art.variationAccount, projectId: obra.id },
          haber: { cuenta: art.inventoryAccount, projectId: null },
        });
        creados.push(
          await this.registrarMovimiento(tx, {
            id,
            companyId,
            tipo: 'salida_obra',
            fecha: d.fecha,
            almacenId: w.id,
            articuloId: art.id,
            projectId: obra.id,
            cantidad: negativo(cantidad),
            valor: negativo(sal.valor),
            saldo: sal.saldo,
            ultimoPmp: item.averageCost,
            notas: d.notas,
            asientoId,
          }),
        );
        await this.guardarSaldo(tx, item, sal.saldo);
      }
      return creados;
    });
    return this.porIds(ids);
  }

  /** Un acopio de obra solo sirve (y recibe) material de su propia obra. */
  private exigirAcopioDeLaObra(w: Warehouse, projectId: string): void {
    if (w.kind === 'obra' && w.projectId !== projectId) {
      throw new UnprocessableEntityException({
        code: 'WAREHOUSE_PROJECT_MISMATCH',
        message: `El almacén ${w.code} es el acopio de otra obra`,
      });
    }
  }

  /**
   * Devolución a almacén de material sobrante de una obra. Se valora al coste
   * medio con que la obra lo consumió (neto de devoluciones previas), de modo
   * que revierte exactamente el coste imputado; no puede superar lo consumido.
   */
  async devolucion(input: DevolucionObraInput): Promise<MovimientoStockDto[]> {
    const companyId = this.dbs.getCompanyId();
    const d = devolucionObraSchema.parse(input);
    const ids = await this.dbs.db.transaction(async (tx) => {
      const w = await this.cargarAlmacen(tx, companyId, d.almacenId);
      const obra = await this.validarObra(tx, companyId, d.projectId);
      this.exigirAcopioDeLaObra(w, obra.id);
      // Serializa devoluciones concurrentes de la misma obra.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`devolucion-obra:${obra.id}`}))`,
      );
      const lineas = [...d.lineas].sort((a, b) =>
        a.articuloId.localeCompare(b.articuloId),
      );
      const creados: string[] = [];
      for (const l of lineas) {
        const art = await this.cargarArticulo(tx, companyId, l.articuloId);
        const [neto] = await tx
          .select({
            cantidad: sql<string>`coalesce(-sum(${stockMovements.quantity}), 0)`,
            valor: sql<string>`coalesce(-sum(${stockMovements.totalValue}), 0)`,
          })
          .from(stockMovements)
          .where(
            and(
              eq(stockMovements.companyId, companyId),
              eq(stockMovements.projectId, obra.id),
              eq(stockMovements.articleId, art.id),
              inArray(stockMovements.type, ['salida_obra', 'devolucion']),
            ),
          );
        const cantidad = l.cantidad.toFixed(3);
        let valor: string;
        try {
          valor = salidaStock(
            { cantidad: neto.cantidad, valor: neto.valor },
            cantidad,
          ).valor;
        } catch (e) {
          if (e instanceof ErrorStock && e.codigo === 'INSUFFICIENT_STOCK') {
            throw new UnprocessableEntityException({
              code: 'RETURN_EXCEEDS_CONSUMPTION',
              message: `La obra ${obra.code} solo tiene ${Number(neto.cantidad)} ${art.unit} de ${art.code} consumidos netos`,
            });
          }
          return traducirErrorStock(e);
        }
        const item = await this.bloquearSaldo(tx, companyId, w.id, art.id);
        const saldo = regla(() =>
          entradaStock(
            { cantidad: item.quantity, valor: item.stockValue },
            { cantidad, valor },
          ),
        );
        const id = randomUUID();
        const concepto = `Devolución ${art.code} de obra ${obra.code} a ${w.code}`;
        const asientoId = await this.asiento(tx, {
          companyId,
          fecha: d.fecha,
          concepto,
          origen: 'devolucion_obra',
          origenId: id,
          valor,
          debe: { cuenta: art.inventoryAccount, projectId: null },
          haber: { cuenta: art.variationAccount, projectId: obra.id },
        });
        creados.push(
          await this.registrarMovimiento(tx, {
            id,
            companyId,
            tipo: 'devolucion',
            fecha: d.fecha,
            almacenId: w.id,
            articuloId: art.id,
            projectId: obra.id,
            cantidad,
            valor,
            saldo,
            ultimoPmp: item.averageCost,
            notas: d.notas,
            asientoId,
          }),
        );
        await this.guardarSaldo(tx, item, saldo);
      }
      return creados;
    });
    return this.porIds(ids);
  }

  /* ──────────────────────────── traspasos ──────────────────────────── */

  /**
   * Traspaso atómico origen → destino: sale al PMP del origen y recalcula el
   * del destino. Sin asiento (misma cuenta de existencias). `If-Match`, si
   * llega, es la versión del saldo de origen.
   */
  async traspaso(
    input: TraspasoStockInput,
    versionOrigen: number | undefined,
  ): Promise<MovimientoStockDto> {
    const companyId = this.dbs.getCompanyId();
    const d = traspasoStockSchema.parse(input);
    const id = await this.dbs.db.transaction(async (tx) => {
      const origen = await this.cargarAlmacen(tx, companyId, d.origenId);
      const dest = await this.cargarAlmacen(tx, companyId, d.destinoId);
      const art = await this.cargarArticulo(tx, companyId, d.articuloId);
      // Bloqueo en orden estable (por id de almacén) contra interbloqueos.
      const [primero, segundo] = [origen.id, dest.id].sort();
      const bloqueados = new Map<string, StockItem>();
      bloqueados.set(
        primero,
        await this.bloquearSaldo(tx, companyId, primero, art.id),
      );
      bloqueados.set(
        segundo,
        await this.bloquearSaldo(tx, companyId, segundo, art.id),
      );
      const io = bloqueados.get(origen.id)!;
      const id_ = bloqueados.get(dest.id)!;
      verificarVersion(io.version, versionOrigen);
      const cantidad = d.cantidad.toFixed(3);
      const r = regla(() =>
        traspasoStock(
          { cantidad: io.quantity, valor: io.stockValue },
          { cantidad: id_.quantity, valor: id_.stockValue },
          cantidad,
          io.reservedQuantity,
        ),
      );
      const movId = await this.registrarMovimiento(tx, {
        id: randomUUID(),
        companyId,
        tipo: 'traspaso',
        fecha: d.fecha,
        almacenId: origen.id,
        destinoId: dest.id,
        articuloId: art.id,
        cantidad: negativo(cantidad),
        valor: negativo(r.valor),
        saldo: r.origen,
        ultimoPmp: io.averageCost,
        notas: d.notas,
        asientoId: null,
      });
      await this.guardarSaldo(tx, io, r.origen);
      await this.guardarSaldo(tx, id_, r.destino);
      return movId;
    });
    return (await this.porIds([id]))[0];
  }

  /* ────────────────────────── regularización ────────────────────────── */

  /**
   * Regularización por recuento físico con motivo obligatorio. Faltante:
   * `variación a existencias`; sobrante: `existencias a variación`. En un
   * acopio de obra la diferencia se imputa a esa obra. `If-Match` (versión
   * del saldo leída al contar) evita regularizar sobre un teórico ya movido.
   */
  async regularizacion(
    input: RegularizacionStockInput,
    versionEsperada: number | undefined,
  ): Promise<MovimientoStockDto> {
    const companyId = this.dbs.getCompanyId();
    const d = regularizacionStockSchema.parse(input);
    const id = await this.dbs.db.transaction(async (tx) => {
      const w = await this.cargarAlmacen(tx, companyId, d.almacenId);
      const art = await this.cargarArticulo(tx, companyId, d.articuloId);
      const item = await this.bloquearSaldo(tx, companyId, w.id, art.id);
      verificarVersion(item.version, versionEsperada);
      const r = regla(() =>
        regularizacionStock(
          { cantidad: item.quantity, valor: item.stockValue },
          d.cantidadContada.toFixed(3),
          {
            reservada: item.reservedQuantity,
            costeUnitario: d.costeUnitario ?? null,
            pmpReferencia:
              toCents(item.averageCost) > 0n ? item.averageCost : null,
          },
        ),
      );
      if (Number(r.diferencia) === 0) {
        throw new UnprocessableEntityException({
          code: 'STOCK_REGULARIZATION_NO_DIFFERENCE',
          message:
            'El recuento coincide con el stock teórico: no hay nada que regularizar',
        });
      }
      const movId = randomUUID();
      const faltante = r.diferencia.startsWith('-');
      const concepto = `Regularización ${art.code} en ${w.code}: ${d.motivo}`;
      const cuentaExist = { cuenta: art.inventoryAccount, projectId: null };
      const cuentaVar = {
        cuenta: art.variationAccount,
        projectId: w.projectId,
      };
      const asientoId = await this.asiento(tx, {
        companyId,
        fecha: d.fecha,
        concepto,
        origen: 'regularizacion_inventario',
        origenId: movId,
        valor: r.valor,
        debe: faltante ? cuentaVar : cuentaExist,
        haber: faltante ? cuentaExist : cuentaVar,
      });
      await this.registrarMovimiento(tx, {
        id: movId,
        companyId,
        tipo: 'regularizacion',
        fecha: d.fecha,
        almacenId: w.id,
        articuloId: art.id,
        projectId: w.projectId,
        cantidad: r.diferencia,
        valor: r.valor,
        saldo: r.saldo,
        ultimoPmp: item.averageCost,
        motivo: d.motivo,
        asientoId,
      });
      await this.guardarSaldo(tx, item, r.saldo);
      return movId;
    });
    return (await this.porIds([id]))[0];
  }

  /* ─────────────────────── imputación por obra ─────────────────────── */

  async consumosObra(projectId: string): Promise<ConsumoObraDto> {
    const companyId = this.dbs.getCompanyId();
    await this.dbs.db.transaction((tx) =>
      this.validarObra(tx, companyId, projectId),
    );
    const filas = await this.dbs.db
      .select({
        articuloId: stockArticles.id,
        codigo: stockArticles.code,
        nombre: stockArticles.name,
        unidad: stockArticles.unit,
        cantidad: sql<string>`-sum(${stockMovements.quantity})`,
        valor: sql<string>`-sum(${stockMovements.totalValue})`,
      })
      .from(stockMovements)
      .innerJoin(stockArticles, eq(stockArticles.id, stockMovements.articleId))
      .where(
        and(
          eq(stockMovements.companyId, companyId),
          eq(stockMovements.projectId, projectId),
          inArray(stockMovements.type, ['salida_obra', 'devolucion']),
        ),
      )
      .groupBy(stockArticles.id)
      .orderBy(asc(stockArticles.code));
    return {
      projectId,
      total: fromCents(sumCents(filas.map((f) => toCents(f.valor)))),
      porArticulo: filas.map((f) => ({
        articuloId: f.articuloId,
        codigo: f.codigo,
        nombre: f.nombre,
        unidad: f.unidad as UnidadStock,
        cantidad: Number(f.cantidad),
        valor: Number(f.valor),
      })),
    };
  }
}
