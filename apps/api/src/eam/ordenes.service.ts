import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  and,
  desc,
  eq,
  inArray,
  like,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  equipoAsignaciones,
  equipos,
  mantenimientosEquipo,
  ordenesTrabajo,
  planesMantenimiento,
  projects,
  proveedores,
  type DbOrTx,
  type Equipo,
  type OrdenTrabajo,
  type Tx,
} from '@erp/db';
import {
  DESTINO_ACCION_ORDEN,
  ORDEN_TRABAJO_TRANSITIONS,
  addDays,
  centsToNumeric,
  costeOrden,
  diferenciasAuditoria,
  ordenAccionSchema,
  ordenCreateSchema,
  todayIso,
  validarCierreOrden,
  type EstadoOrdenTrabajo,
  type OrdenAccionInput,
  type OrdenCreateInput,
  type OrdenTrabajoDto,
  type OrdenesQuery,
  type PrioridadOrden,
  type TipoOrdenTrabajo,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { cambiarEstado } from '../common/cambiar-estado';
import { getRequestContext } from '../common/request-context';
import { verificarVersion } from '../common/version';
import { DbService } from '../db/db.service';
import { errorEam, n2, reglaEam } from './comun';
import { EquiposEamService } from './equipos-eam.service';

const TIPO_HISTORICO: Record<
  TipoOrdenTrabajo,
  'preventivo' | 'correctivo' | 'itv'
> = {
  preventiva: 'preventivo',
  revision: 'preventivo',
  correctiva: 'correctivo',
  itv: 'itv',
};

/**
 * Órdenes de trabajo de mantenimiento (SAP PM IW31/IW32/IW41, Oracle Work
 * Orders): aviso → planificada → en curso → cerrada (o cancelada).
 *  - Iniciar deja el equipo en mantenimiento; cerrar (o cancelar en curso)
 *    lo devuelve a operativo si no le queda otra orden en curso.
 *  - Cerrar fija parada y coste (mano de obra, repuestos, externo), registra
 *    las lecturas de contador, actualiza la última ejecución del plan y deja
 *    el mantenimiento en el histórico del equipo enlazado a la orden (el
 *    coste cuenta una sola vez).
 *  - La obra es atribución analítica: el coste no se carga a la obra.
 * El jefe de obra puede dar avisos de avería de equipos de sus obras.
 */
@Injectable()
export class OrdenesService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly equiposEam: EquiposEamService,
  ) {}

  private async dto(ex: DbOrTx, o: OrdenTrabajo): Promise<OrdenTrabajoDto> {
    const [e] = await ex
      .select({ nombre: equipos.nombre })
      .from(equipos)
      .where(eq(equipos.id, o.equipoId));
    const [p] = o.projectId
      ? await ex
          .select({ name: projects.name })
          .from(projects)
          .where(eq(projects.id, o.projectId))
      : [];
    return {
      id: o.id,
      numero: o.numero,
      equipoId: o.equipoId,
      equipoNombre: e?.nombre ?? '',
      planId: o.planId,
      tipo: o.tipo as TipoOrdenTrabajo,
      prioridad: o.prioridad as PrioridadOrden,
      estado: o.status,
      projectId: o.projectId,
      projectNombre: p?.name ?? null,
      descripcion: o.descripcion,
      fechaAviso: o.fechaAviso,
      fechaPlanificada: o.fechaPlanificada,
      inicio: o.inicio,
      fin: o.fin,
      horasParada: Number(o.horasParada),
      horasManoObra: Number(o.horasManoObra),
      tarifaManoObra: Number(o.tarifaManoObra),
      costeManoObra: Number(o.costeManoObra),
      costeRepuestos: Number(o.costeRepuestos),
      costeExterno: Number(o.costeExterno),
      costeTotal: Number(o.costeTotal),
      proveedorId: o.proveedorId,
      lecturaHoras: n2(o.lecturaHoras),
      lecturaKm: n2(o.lecturaKm),
      notasCierre: o.notasCierre,
      motivoCancelacion: o.motivoCancelacion,
      version: o.version,
    };
  }

  /** Filtro de visibilidad del rol obra: órdenes de sus obras o de equipos asignados a ellas. */
  private async filtroObra(): Promise<SQL | undefined | null> {
    const obras = await this.dbs.getObrasAccesibles();
    if (obras === null) return undefined;
    if (obras.length === 0) return null;
    return or(
      inArray(ordenesTrabajo.projectId, obras),
      inArray(
        ordenesTrabajo.equipoId,
        this.dbs.db
          .select({ id: equipoAsignaciones.equipoId })
          .from(equipoAsignaciones)
          .where(inArray(equipoAsignaciones.projectId, obras)),
      ),
    );
  }

  async listar(q: OrdenesQuery): Promise<OrdenTrabajoDto[]> {
    const visible = await this.filtroObra();
    if (visible === null) return [];
    const filtros: SQL[] = [
      eq(ordenesTrabajo.companyId, this.dbs.getCompanyId()),
    ];
    if (visible) filtros.push(visible);
    if (q.equipoId) filtros.push(eq(ordenesTrabajo.equipoId, q.equipoId));
    if (q.projectId) filtros.push(eq(ordenesTrabajo.projectId, q.projectId));
    if (q.estado) filtros.push(eq(ordenesTrabajo.status, q.estado));
    if (q.tipo) filtros.push(eq(ordenesTrabajo.tipo, q.tipo));
    const filas = await this.dbs.db
      .select()
      .from(ordenesTrabajo)
      .where(and(...filtros))
      .orderBy(desc(ordenesTrabajo.fechaAviso), desc(ordenesTrabajo.numero))
      .limit(300);
    return Promise.all(filas.map((o) => this.dto(this.dbs.db, o)));
  }

  async detalle(id: string): Promise<OrdenTrabajoDto> {
    const visible = await this.filtroObra();
    const [o] =
      visible === null
        ? []
        : await this.dbs.db
            .select()
            .from(ordenesTrabajo)
            .where(
              and(
                eq(ordenesTrabajo.id, id),
                eq(ordenesTrabajo.companyId, this.dbs.getCompanyId()),
                ...(visible ? [visible] : []),
              ),
            );
    if (!o)
      throw errorEam('EAM_WO_NOT_FOUND', 'Orden de trabajo no encontrada');
    return this.dto(this.dbs.db, o);
  }

  private async numero(tx: Tx, fecha: string): Promise<string> {
    const companyId = this.dbs.getCompanyId();
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`orden-trabajo:${companyId}`}))`,
    );
    const anio = fecha.slice(0, 4);
    const [n] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(ordenesTrabajo)
      .where(
        and(
          eq(ordenesTrabajo.companyId, companyId),
          like(ordenesTrabajo.numero, `OT-${anio}-%`),
        ),
      );
    return `OT-${anio}-${String((n?.n ?? 0) + 1).padStart(4, '0')}`;
  }

  /** Alta en la transacción del llamador (aviso manual o generación desde un plan). */
  private async crearEnTx(
    tx: Tx,
    e: Equipo,
    d: ReturnType<typeof ordenCreateSchema.parse>,
  ): Promise<OrdenTrabajo> {
    if (e.estado === 'baja')
      throw errorEam('EAM_EQUIPMENT_RETIRED', 'El equipo está dado de baja');
    if (d.fechaAviso > todayIso())
      throw errorEam('EAM_WO_DATES_INVALID', 'El aviso no puede ser futuro');
    if (d.fechaPlanificada && d.fechaPlanificada < d.fechaAviso) {
      throw errorEam(
        'EAM_WO_DATES_INVALID',
        'La fecha planificada es anterior al aviso',
      );
    }
    if (d.projectId) await this.equiposEam.obraAccesible(tx, d.projectId);
    if (d.planId) {
      const [p] = await tx
        .select({ equipoId: planesMantenimiento.equipoId })
        .from(planesMantenimiento)
        .where(
          and(
            eq(planesMantenimiento.id, d.planId),
            eq(planesMantenimiento.companyId, e.companyId),
          ),
        );
      if (!p || p.equipoId !== e.id)
        throw errorEam('EAM_PLAN_NOT_FOUND', 'El plan no es de este equipo');
    }
    try {
      const [o] = await tx
        .insert(ordenesTrabajo)
        .values({
          companyId: e.companyId,
          numero: await this.numero(tx, d.fechaAviso),
          equipoId: e.id,
          planId: d.planId ?? null,
          tipo: d.tipo,
          prioridad: d.prioridad,
          projectId: d.projectId ?? null,
          descripcion: d.descripcion,
          fechaAviso: d.fechaAviso,
          fechaPlanificada: d.fechaPlanificada ?? null,
          createdBy: getRequestContext()?.userId ?? null,
        })
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'orden_trabajo',
        entityId: o.id,
        action: 'create',
        newData: o,
      });
      return o;
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw errorEam(
          'EAM_WO_PLAN_OPEN',
          'El plan ya tiene una orden de trabajo viva',
        );
      }
      throw err;
    }
  }

  /**
   * Aviso u orden. El rol obra solo puede dar avisos correctivos de equipos
   * asignados a sus obras, imputados a una de ellas.
   */
  async crear(input: OrdenCreateInput): Promise<OrdenTrabajoDto> {
    const d = ordenCreateSchema.parse(input);
    const obras = await this.dbs.getObrasAccesibles();
    if (
      obras !== null &&
      (d.tipo !== 'correctiva' || !d.projectId || d.planId)
    ) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message:
          'Desde obra solo se dan avisos de avería (correctivos) imputados a la obra',
      });
    }
    const o = await this.dbs.db.transaction(async (tx) => {
      const e = await this.equiposEam.equipo(tx, d.equipoId, true);
      return this.crearEnTx(tx, e, d);
    });
    return this.dto(this.dbs.db, o);
  }

  /**
   * Genera las órdenes preventivas de los planes activos vencidos o próximos
   * que no tienen orden viva (idempotente: el índice único lo garantiza).
   */
  async generarDesdePlanes(fecha?: string): Promise<OrdenTrabajoDto[]> {
    const hoy = fecha ?? todayIso();
    const companyId = this.dbs.getCompanyId();
    const creadas = await this.dbs.db.transaction(async (tx) => {
      const planes = await tx
        .select({
          id: planesMantenimiento.id,
          equipoId: planesMantenimiento.equipoId,
        })
        .from(planesMantenimiento)
        .innerJoin(equipos, eq(equipos.id, planesMantenimiento.equipoId))
        .where(
          and(
            eq(planesMantenimiento.companyId, companyId),
            eq(planesMantenimiento.activo, true),
            ne(equipos.estado, 'baja'),
            sql`${equipos.deletedAt} IS NULL`,
          ),
        );
      const out: OrdenTrabajo[] = [];
      for (const p of planes) {
        const plan = await this.equiposEam.plan(tx, p.id);
        if (plan.estado === 'al_dia' || plan.ordenAbiertaId) continue;
        const e = await this.equiposEam.equipo(tx, p.equipoId, true);
        out.push(
          await this.crearEnTx(tx, e, {
            equipoId: e.id,
            tipo:
              plan.tipo === 'itv'
                ? 'itv'
                : plan.tipo === 'revision'
                  ? 'revision'
                  : 'preventiva',
            prioridad: plan.estado === 'vencido' ? 'alta' : 'media',
            planId: p.id,
            projectId: null,
            descripcion: `${plan.nombre} (${plan.estado === 'vencido' ? 'vencido' : 'próximo'} por ${plan.criterio})`,
            fechaAviso: hoy,
            fechaPlanificada:
              plan.fechaProxima && plan.fechaProxima >= hoy
                ? plan.fechaProxima
                : hoy,
          }),
        );
      }
      return out;
    });
    return Promise.all(creadas.map((o) => this.dto(this.dbs.db, o)));
  }

  /** Devuelve el equipo a operativo si no le queda otra orden en curso. */
  private async liberarEquipo(tx: Tx, equipoId: string, ordenId: string) {
    const [otra] = await tx
      .select({ id: ordenesTrabajo.id })
      .from(ordenesTrabajo)
      .where(
        and(
          eq(ordenesTrabajo.equipoId, equipoId),
          eq(ordenesTrabajo.status, 'en_curso'),
          ne(ordenesTrabajo.id, ordenId),
        ),
      )
      .limit(1);
    if (!otra) {
      await tx
        .update(equipos)
        .set({ estado: 'operativo', updatedAt: new Date() })
        .where(
          and(
            eq(equipos.id, equipoId),
            inArray(equipos.estado, ['en_mantenimiento', 'averiado']),
          ),
        );
    }
  }

  async accion(
    id: string,
    input: OrdenAccionInput,
    version: number | undefined,
  ): Promise<OrdenTrabajoDto> {
    const d = ordenAccionSchema.parse(input);
    const hoy = todayIso();
    await this.dbs.db.transaction(async (tx) => {
      const [o] = await tx
        .select()
        .from(ordenesTrabajo)
        .where(
          and(
            eq(ordenesTrabajo.id, id),
            eq(ordenesTrabajo.companyId, this.dbs.getCompanyId()),
          ),
        )
        .for('update');
      if (!o)
        throw errorEam('EAM_WO_NOT_FOUND', 'Orden de trabajo no encontrada');
      verificarVersion(o.version, version);
      const de = o.status as EstadoOrdenTrabajo;
      const a = DESTINO_ACCION_ORDEN[d.accion];
      // Misma máquina que cambiarEstado, pero con el código de error del dominio.
      if (!ORDEN_TRABAJO_TRANSITIONS[de].includes(a)) {
        throw errorEam(
          'EAM_WO_INVALID_TRANSITION',
          `Una orden ${de} no puede pasar a ${a}`,
        );
      }
      if (d.fecha > hoy)
        throw errorEam('EAM_WO_DATES_INVALID', 'La fecha no puede ser futura');
      const e = await this.equiposEam.equipo(tx, o.equipoId, true);
      const extra: Record<string, unknown> = {};

      if (d.accion === 'planificar') {
        if (!d.fechaPlanificada || d.fechaPlanificada < o.fechaAviso) {
          throw errorEam(
            'EAM_WO_DATES_INVALID',
            'Indica una fecha planificada no anterior al aviso',
          );
        }
        extra.fechaPlanificada = d.fechaPlanificada;
      } else if (d.accion === 'iniciar') {
        if (d.fecha < o.fechaAviso)
          throw errorEam(
            'EAM_WO_DATES_INVALID',
            'El inicio es anterior al aviso',
          );
        extra.inicio = d.fecha;
        await tx
          .update(equipos)
          .set({ estado: 'en_mantenimiento', updatedAt: new Date() })
          .where(eq(equipos.id, e.id));
      } else if (d.accion === 'cancelar') {
        if (!d.motivo || d.motivo.trim().length < 3) {
          throw errorEam(
            'EAM_WO_REASON_REQUIRED',
            'Indica el motivo de la cancelación',
          );
        }
        extra.motivoCancelacion = d.motivo;
        if (de === 'en_curso') await this.liberarEquipo(tx, e.id, o.id);
      } else {
        // Cierre: parada, coste, contadores, plan e histórico.
        reglaEam(() =>
          validarCierreOrden({
            inicio: o.inicio!,
            fin: d.fecha,
            hoy,
            horasParada: d.horasParada,
          }),
        );
        const c = reglaEam(() =>
          costeOrden({
            horasManoObra: d.horasManoObra,
            tarifaManoObra: d.tarifaManoObra,
            repuestos: d.costeRepuestos,
            externo: d.costeExterno,
          }),
        );
        if (d.proveedorId) {
          const [pv] = await tx
            .select({ id: proveedores.id })
            .from(proveedores)
            .where(
              and(
                eq(proveedores.id, d.proveedorId),
                eq(proveedores.companyId, e.companyId),
              ),
            );
          if (!pv)
            throw errorEam('EAM_WO_COST_INVALID', 'Proveedor no encontrado');
        }
        if (d.lecturaHoras !== undefined && d.lecturaHoras !== null) {
          await this.equiposEam.registrarLecturaEnTx(
            tx,
            e,
            { tipo: 'horas', fecha: d.fecha, valor: d.lecturaHoras },
            'orden',
            o.id,
          );
        }
        if (d.lecturaKm !== undefined && d.lecturaKm !== null) {
          await this.equiposEam.registrarLecturaEnTx(
            tx,
            e,
            { tipo: 'km', fecha: d.fecha, valor: d.lecturaKm },
            'orden',
            o.id,
          );
        }
        let proxima: string | null = null;
        if (o.planId) {
          const [p] = await tx
            .select()
            .from(planesMantenimiento)
            .where(eq(planesMantenimiento.id, o.planId))
            .for('update');
          await tx
            .update(planesMantenimiento)
            .set({
              ultimaFecha: d.fecha,
              ultimaHoras: e.contadorHoras,
              ultimaKm: e.contadorKm,
              version: sql`${planesMantenimiento.version} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(planesMantenimiento.id, o.planId));
          await this.audit.registrar(tx, {
            entityType: 'plan_mantenimiento',
            entityId: o.planId,
            action: 'update',
            oldData: {
              ultimaFecha: p.ultimaFecha,
              ultimaHoras: p.ultimaHoras,
              ultimaKm: p.ultimaKm,
            },
            newData: {
              ultimaFecha: d.fecha,
              ultimaHoras: e.contadorHoras,
              ultimaKm: e.contadorKm,
              ordenTrabajoId: o.id,
            },
          });
          if (p.periodicidadDias)
            proxima = addDays(d.fecha, p.periodicidadDias);
        }
        const [hist] = await tx
          .insert(mantenimientosEquipo)
          .values({
            companyId: e.companyId,
            equipoId: e.id,
            tipo: TIPO_HISTORICO[o.tipo as TipoOrdenTrabajo],
            fecha: d.fecha,
            proveedorId: d.proveedorId ?? null,
            coste: centsToNumeric(c.total),
            proximaRevisionFecha: proxima,
            descripcion: `${o.numero}: ${o.descripcion}`.slice(0, 1000),
            ordenTrabajoId: o.id,
          })
          .returning({ id: mantenimientosEquipo.id });
        Object.assign(extra, {
          fin: d.fecha,
          horasParada: (d.horasParada ?? 0).toFixed(2),
          horasManoObra: (d.horasManoObra ?? 0).toFixed(2),
          tarifaManoObra: (d.tarifaManoObra ?? 0).toFixed(2),
          costeManoObra: centsToNumeric(c.manoObra),
          costeRepuestos: centsToNumeric(c.repuestos),
          costeExterno: centsToNumeric(c.externo),
          costeTotal: centsToNumeric(c.total),
          proveedorId: d.proveedorId ?? null,
          lecturaHoras: d.lecturaHoras?.toFixed(2) ?? null,
          lecturaKm: d.lecturaKm?.toFixed(2) ?? null,
          notasCierre: d.notas ?? null,
        });
        await this.liberarEquipo(tx, e.id, o.id);
        await this.audit.registrar(tx, {
          entityType: 'mantenimiento_equipo',
          entityId: hist.id,
          action: 'create',
          newData: {
            equipoId: e.id,
            ordenTrabajoId: o.id,
            coste: centsToNumeric(c.total),
          },
        });
      }
      await cambiarEstado(
        tx,
        ordenesTrabajo,
        'orden_trabajo',
        o.id,
        de,
        a,
        extra,
        o.version,
      );
      const antes: Record<string, unknown> = { status: de };
      for (const k of Object.keys(extra))
        antes[k] = (o as Record<string, unknown>)[k];
      await this.audit.registrar(tx, {
        entityType: 'orden_trabajo',
        entityId: o.id,
        action: 'update',
        oldData: antes,
        newData: diferenciasAuditoria(antes, { status: a, ...extra }),
        meta: { accion: d.accion, fecha: d.fecha },
      });
    });
    return this.detalle(id);
  }
}
