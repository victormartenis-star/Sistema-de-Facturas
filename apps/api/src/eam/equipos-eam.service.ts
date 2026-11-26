import { ForbiddenException, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  equipoAsignaciones,
  equipoLecturasContador,
  equipos,
  fixedAssets,
  ordenesTrabajo,
  planesMantenimiento,
  projects,
  type DbOrTx,
  type Equipo,
  type PlanMantenimiento,
  type Tx,
} from '@erp/db';
import {
  asignacionCreateSchema,
  diferenciasAuditoria,
  estadoPreventivo,
  fichaEquipoSchema,
  lecturaContadorSchema,
  planCreateSchema,
  planUpdateSchema,
  scaledToNumeric,
  toScaled,
  todayIso,
  validarAsignacion,
  validarJerarquia,
  validarLectura,
  validarPlan,
  type AsignacionCreateInput,
  type AsignacionDto,
  type EquipoEamDto,
  type EstadoVencimiento,
  type FichaEquipoInput,
  type LecturaContadorDto,
  type LecturaContadorInput,
  type OrigenLectura,
  type PlanCreateInput,
  type PlanMantenimientoDto,
  type PlanUpdateInput,
  type TipoContador,
  type TipoPlan,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { getRequestContext } from '../common/request-context';
import { verificarVersion } from '../common/version';
import { DbService } from '../db/db.service';
import { errorEam, n2, reglaEam } from './comun';

const VIVAS = ['abierta', 'planificada', 'en_curso'] as const;
const RANGO: Record<EstadoVencimiento, number> = {
  al_dia: 0,
  proximo: 1,
  vencido: 2,
};

/**
 * Ficha EAM de los equipos del maestro: código, nº de serie, jerarquía
 * conjunto/componente sin ciclos, contadores con historia, asignación a obra
 * sin solapes y planes preventivos con su vencimiento. El rol obra solo ve
 * los equipos asignados (alguna vez) a sus obras.
 */
@Injectable()
export class EquiposEamService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  /** Equipo de la empresa, vivo y visible para el usuario (404 si no). */
  async equipo(ex: DbOrTx, id: string, bloquear = false): Promise<Equipo> {
    const q = ex
      .select()
      .from(equipos)
      .where(
        and(
          eq(equipos.id, id),
          eq(equipos.companyId, this.dbs.getCompanyId()),
          isNull(equipos.deletedAt),
        ),
      );
    const [e] = bloquear ? await q.for('update') : await q;
    if (!e) throw errorEam('EAM_EQUIPMENT_NOT_FOUND', 'Equipo no encontrado');
    const obras = await this.dbs.getObrasAccesibles();
    if (obras !== null) {
      const [a] =
        obras.length === 0
          ? []
          : await ex
              .select({ id: equipoAsignaciones.id })
              .from(equipoAsignaciones)
              .where(
                and(
                  eq(equipoAsignaciones.equipoId, id),
                  inArray(equipoAsignaciones.projectId, obras),
                ),
              )
              .limit(1);
      if (!a) throw errorEam('EAM_EQUIPMENT_NOT_FOUND', 'Equipo no encontrado');
    }
    return e;
  }

  /** La obra debe ser de la empresa y, para el rol obra, una de las suyas. */
  async obraAccesible(
    ex: DbOrTx,
    projectId: string,
  ): Promise<{ id: string; name: string }> {
    const [p] = await ex
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.companyId, this.dbs.getCompanyId()),
        ),
      );
    const obras = await this.dbs.getObrasAccesibles();
    if (!p || (obras !== null && !obras.includes(projectId))) {
      throw new ForbiddenException({
        code: 'PROJECT_ACCESS_DENIED',
        message: 'Obra no accesible',
      });
    }
    return p;
  }

  private async planDto(
    ex: DbOrTx,
    p: PlanMantenimiento,
    e: Equipo,
  ): Promise<PlanMantenimientoDto> {
    const [viva] = await ex
      .select({ id: ordenesTrabajo.id })
      .from(ordenesTrabajo)
      .where(
        and(
          eq(ordenesTrabajo.planId, p.id),
          inArray(ordenesTrabajo.status, [...VIVAS]),
        ),
      )
      .limit(1);
    const estado = estadoPreventivo({
      plan: {
        periodicidadDias: p.periodicidadDias,
        intervaloHoras: p.intervaloHoras,
        intervaloKm: p.intervaloKm,
        avisoDias: p.avisoDias,
        avisoHoras: p.avisoHoras,
        avisoKm: p.avisoKm,
      },
      ultima: { fecha: p.ultimaFecha, horas: p.ultimaHoras, km: p.ultimaKm },
      actual: { horas: e.contadorHoras, km: e.contadorKm },
      hoy: todayIso(),
    });
    return {
      ...estado,
      id: p.id,
      equipoId: p.equipoId,
      nombre: p.nombre,
      tipo: p.tipo as TipoPlan,
      periodicidadDias: p.periodicidadDias,
      intervaloHoras: n2(p.intervaloHoras),
      intervaloKm: n2(p.intervaloKm),
      avisoDias: p.avisoDias,
      avisoHoras: Number(p.avisoHoras),
      avisoKm: Number(p.avisoKm),
      ultimaFecha: p.ultimaFecha,
      ultimaHoras: n2(p.ultimaHoras),
      ultimaKm: n2(p.ultimaKm),
      activo: p.activo,
      ordenAbiertaId: viva?.id ?? null,
      version: p.version,
    };
  }

  async dto(ex: DbOrTx, e: Equipo): Promise<EquipoEamDto> {
    const hoy = todayIso();
    const [padre] = e.padreId
      ? await ex
          .select({ nombre: equipos.nombre })
          .from(equipos)
          .where(eq(equipos.id, e.padreId))
      : [];
    const componentes = await ex
      .select({
        id: equipos.id,
        nombre: equipos.nombre,
        codigo: equipos.codigo,
      })
      .from(equipos)
      .where(and(eq(equipos.padreId, e.id), isNull(equipos.deletedAt)))
      .orderBy(asc(equipos.nombre));
    const [obra] = await ex
      .select({
        id: equipoAsignaciones.id,
        projectId: projects.id,
        nombre: projects.name,
        desde: equipoAsignaciones.desde,
      })
      .from(equipoAsignaciones)
      .innerJoin(projects, eq(projects.id, equipoAsignaciones.projectId))
      .where(
        and(
          eq(equipoAsignaciones.equipoId, e.id),
          sql`${equipoAsignaciones.desde} <= ${hoy}`,
          sql`(${equipoAsignaciones.hasta} IS NULL OR ${equipoAsignaciones.hasta} >= ${hoy})`,
        ),
      )
      .limit(1);
    const [activo] = await ex
      .select({
        id: fixedAssets.id,
        codigo: fixedAssets.code,
        estado: fixedAssets.status,
      })
      .from(fixedAssets)
      .where(eq(fixedAssets.equipoId, e.id))
      .limit(1);
    const planes = await ex
      .select()
      .from(planesMantenimiento)
      .where(
        and(
          eq(planesMantenimiento.equipoId, e.id),
          eq(planesMantenimiento.activo, true),
        ),
      );
    let preventivo: EstadoVencimiento | null = null;
    for (const p of planes) {
      const s = (await this.planDto(ex, p, e)).estado;
      if (preventivo === null || RANGO[s] > RANGO[preventivo]) preventivo = s;
    }
    const [abiertas] = await ex
      .select({ n: sql<number>`count(*)::int` })
      .from(ordenesTrabajo)
      .where(
        and(
          eq(ordenesTrabajo.equipoId, e.id),
          inArray(ordenesTrabajo.status, [...VIVAS]),
        ),
      );
    return {
      id: e.id,
      nombre: e.nombre,
      codigo: e.codigo,
      matricula: e.matricula,
      numeroSerie: e.numeroSerie,
      tipo: e.tipo,
      ownership: e.ownership,
      estado: e.estado,
      padreId: e.padreId,
      padreNombre: padre?.nombre ?? null,
      componentes,
      contadorHoras: Number(e.contadorHoras),
      contadorKm: Number(e.contadorKm),
      contadorFecha: e.contadorFecha,
      obraActual: obra
        ? {
            asignacionId: obra.id,
            projectId: obra.projectId,
            nombre: obra.nombre,
            desde: obra.desde,
          }
        : null,
      activoFijo: activo ?? null,
      preventivo,
      ordenesAbiertas: abiertas?.n ?? 0,
      version: e.version,
    };
  }

  async listar(projectId?: string): Promise<EquipoEamDto[]> {
    const db = this.dbs.db;
    const obras = await this.dbs.getObrasAccesibles();
    const filtroObras = projectId ? [projectId] : obras;
    if (projectId) await this.obraAccesible(db, projectId);
    const filas =
      filtroObras === null
        ? await db
            .select()
            .from(equipos)
            .where(
              and(
                eq(equipos.companyId, this.dbs.getCompanyId()),
                isNull(equipos.deletedAt),
              ),
            )
            .orderBy(asc(equipos.nombre))
        : filtroObras.length === 0
          ? []
          : await db
              .selectDistinct({ e: equipos })
              .from(equipos)
              .innerJoin(
                equipoAsignaciones,
                eq(equipoAsignaciones.equipoId, equipos.id),
              )
              .where(
                and(
                  eq(equipos.companyId, this.dbs.getCompanyId()),
                  isNull(equipos.deletedAt),
                  inArray(equipoAsignaciones.projectId, filtroObras),
                ),
              )
              .then((r) =>
                r
                  .map((x) => x.e)
                  .sort((a, b) => a.nombre.localeCompare(b.nombre)),
              );
    return Promise.all(filas.map((e) => this.dto(db, e)));
  }

  async detalle(id: string): Promise<EquipoEamDto> {
    return this.dto(this.dbs.db, await this.equipo(this.dbs.db, id));
  }

  /** Código, nº de serie y conjunto del que es componente (sin ciclos, ≤ 5 niveles). */
  async ficha(
    id: string,
    input: FichaEquipoInput,
    version: number | undefined,
  ): Promise<EquipoEamDto> {
    const d = fichaEquipoSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    try {
      await this.dbs.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`jerarquia-equipos:${companyId}`}))`,
        );
        const e = await this.equipo(tx, id, true);
        verificarVersion(e.version, version);
        if (d.padreId !== undefined && d.padreId !== null) {
          await this.equipo(tx, d.padreId);
          const todos = await tx
            .select({ id: equipos.id, padreId: equipos.padreId })
            .from(equipos)
            .where(
              and(eq(equipos.companyId, companyId), isNull(equipos.deletedAt)),
            );
          const padres = Object.fromEntries(
            todos.map((x) => [x.id, x.padreId]),
          );
          // Profundidad del subárbol que cuelga de este equipo.
          const hijos = new Map<string, string[]>();
          for (const x of todos)
            if (x.padreId)
              hijos.set(x.padreId, [...(hijos.get(x.padreId) ?? []), x.id]);
          const prof = (n: string, visitados: Set<string>): number => {
            if (visitados.has(n)) return 0;
            visitados.add(n);
            return Math.max(
              0,
              ...(hijos.get(n) ?? []).map((h) => 1 + prof(h, visitados)),
            );
          };
          reglaEam(() =>
            validarJerarquia({
              id,
              padreId: d.padreId!,
              padres,
              profundidadSubarbol: prof(id, new Set()),
            }),
          );
        }
        const cambios = {
          ...(d.codigo !== undefined && {
            codigo: d.codigo ? d.codigo.toUpperCase() : null,
          }),
          ...(d.numeroSerie !== undefined && {
            numeroSerie: d.numeroSerie || null,
          }),
          ...(d.padreId !== undefined && { padreId: d.padreId ?? null }),
        };
        await tx
          .update(equipos)
          .set({
            ...cambios,
            version: sql`${equipos.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(equipos.id, id));
        const antes = {
          codigo: e.codigo,
          numeroSerie: e.numeroSerie,
          padreId: e.padreId,
        };
        await this.audit.registrar(tx, {
          entityType: 'equipo',
          entityId: id,
          action: 'update',
          oldData: antes,
          newData: diferenciasAuditoria(antes, { ...antes, ...cambios }),
        });
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw errorEam('EAM_CODE_DUPLICATE', 'Ya hay un equipo con ese código');
      }
      throw e;
    }
    return this.detalle(id);
  }

  async lecturas(id: string): Promise<LecturaContadorDto[]> {
    await this.equipo(this.dbs.db, id);
    const filas = await this.dbs.db
      .select()
      .from(equipoLecturasContador)
      .where(eq(equipoLecturasContador.equipoId, id))
      .orderBy(
        desc(equipoLecturasContador.fecha),
        desc(equipoLecturasContador.createdAt),
      )
      .limit(200);
    return filas.map((l) => ({
      id: l.id,
      tipo: l.tipo as TipoContador,
      fecha: l.fecha,
      valor: Number(l.valor),
      anterior: n2(l.anterior),
      origen: l.origen as OrigenLectura,
      motivo: l.motivo,
      createdAt: l.createdAt.toISOString(),
    }));
  }

  /**
   * Registra una lectura dentro de la transacción del llamador (también la
   * usa el cierre de una orden). Actualiza el contador vigente y audita.
   */
  async registrarLecturaEnTx(
    tx: Tx,
    e: Equipo,
    d: {
      tipo: TipoContador;
      fecha: string;
      valor: number;
      correccion?: boolean;
      motivo?: string | null;
    },
    origen: OrigenLectura,
    ordenTrabajoId: string | null = null,
  ): Promise<void> {
    const anterior = d.tipo === 'horas' ? e.contadorHoras : e.contadorKm;
    const [ultima] = await tx
      .select({ fecha: equipoLecturasContador.fecha })
      .from(equipoLecturasContador)
      .where(
        and(
          eq(equipoLecturasContador.equipoId, e.id),
          eq(equipoLecturasContador.tipo, d.tipo),
        ),
      )
      .orderBy(desc(equipoLecturasContador.fecha))
      .limit(1);
    reglaEam(() =>
      validarLectura({
        tipo: d.tipo,
        anterior: ultima ? anterior : null,
        fechaAnterior: ultima?.fecha ?? null,
        valor: d.valor,
        fecha: d.fecha,
        hoy: todayIso(),
        correccion: d.correccion,
        motivo: d.motivo,
      }),
    );
    const valor = scaledToNumeric(toScaled(d.valor, 2), 2);
    const [lectura] = await tx
      .insert(equipoLecturasContador)
      .values({
        companyId: e.companyId,
        equipoId: e.id,
        tipo: d.tipo,
        fecha: d.fecha,
        valor,
        anterior: ultima ? anterior : null,
        origen: d.correccion ? 'correccion' : origen,
        motivo: d.motivo ?? null,
        ordenTrabajoId,
        createdBy: getRequestContext()?.userId ?? null,
      })
      .returning();
    const fechaContador =
      e.contadorFecha && e.contadorFecha > d.fecha && !d.correccion
        ? e.contadorFecha
        : d.fecha;
    await tx
      .update(equipos)
      .set({
        ...(d.tipo === 'horas'
          ? { contadorHoras: valor }
          : { contadorKm: valor }),
        contadorFecha: fechaContador,
        version: sql`${equipos.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(equipos.id, e.id));
    if (d.tipo === 'horas') e.contadorHoras = valor;
    else e.contadorKm = valor;
    await this.audit.registrar(tx, {
      entityType: 'equipo_lectura',
      entityId: lectura.id,
      action: 'create',
      oldData: { equipoId: e.id, [d.tipo]: anterior },
      newData: {
        equipoId: e.id,
        [d.tipo]: valor,
        fecha: d.fecha,
        origen: lectura.origen,
        motivo: d.motivo ?? null,
      },
    });
  }

  async registrarLectura(
    id: string,
    input: LecturaContadorInput,
    version: number | undefined,
  ): Promise<EquipoEamDto> {
    const d = lecturaContadorSchema.parse(input);
    await this.dbs.db.transaction(async (tx) => {
      const e = await this.equipo(tx, id, true);
      verificarVersion(e.version, version);
      if (e.estado === 'baja')
        throw errorEam('EAM_EQUIPMENT_RETIRED', 'El equipo está dado de baja');
      await this.registrarLecturaEnTx(tx, e, d, 'manual');
    });
    return this.detalle(id);
  }

  private asignacionDto(
    a: typeof equipoAsignaciones.$inferSelect,
    nombre: string,
  ): AsignacionDto {
    return {
      id: a.id,
      equipoId: a.equipoId,
      projectId: a.projectId,
      projectNombre: nombre,
      desde: a.desde,
      hasta: a.hasta,
      notas: a.notas,
      version: a.version,
    };
  }

  async asignaciones(id: string): Promise<AsignacionDto[]> {
    await this.equipo(this.dbs.db, id);
    const obras = await this.dbs.getObrasAccesibles();
    // El rol obra solo ve las asignaciones a sus obras (equipo() ya exige alguna).
    const filas = await this.dbs.db
      .select({ a: equipoAsignaciones, nombre: projects.name })
      .from(equipoAsignaciones)
      .innerJoin(projects, eq(projects.id, equipoAsignaciones.projectId))
      .where(
        and(
          eq(equipoAsignaciones.equipoId, id),
          ...(obras !== null
            ? [inArray(equipoAsignaciones.projectId, obras)]
            : []),
        ),
      )
      .orderBy(desc(equipoAsignaciones.desde));
    return filas.map((f) => this.asignacionDto(f.a, f.nombre));
  }

  /** Asigna el equipo a una obra: una sola obra a la vez (sin solapes). */
  async asignar(
    id: string,
    input: AsignacionCreateInput,
  ): Promise<AsignacionDto> {
    const d = asignacionCreateSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    const r = await this.dbs.db.transaction(async (tx) => {
      const e = await this.equipo(tx, id, true);
      if (e.estado === 'baja')
        throw errorEam('EAM_EQUIPMENT_RETIRED', 'El equipo está dado de baja');
      const obra = await this.obraAccesible(tx, d.projectId);
      const existentes = await tx
        .select({
          id: equipoAsignaciones.id,
          desde: equipoAsignaciones.desde,
          hasta: equipoAsignaciones.hasta,
        })
        .from(equipoAsignaciones)
        .where(eq(equipoAsignaciones.equipoId, id));
      reglaEam(() =>
        validarAsignacion(
          { desde: d.desde, hasta: d.hasta ?? null },
          existentes,
        ),
      );
      const [a] = await tx
        .insert(equipoAsignaciones)
        .values({
          companyId,
          equipoId: id,
          projectId: d.projectId,
          desde: d.desde,
          hasta: d.hasta ?? null,
          notas: d.notas ?? null,
          createdBy: getRequestContext()?.userId ?? null,
        })
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'equipo_asignacion',
        entityId: a.id,
        action: 'create',
        newData: a,
      });
      return this.asignacionDto(a, obra.name);
    });
    return r;
  }

  /** Cierra (o adelanta el fin de) una asignación. */
  async cerrarAsignacion(
    asignacionId: string,
    hasta: string,
    version: number | undefined,
  ): Promise<AsignacionDto> {
    return this.dbs.db.transaction(async (tx) => {
      const [a] = await tx
        .select()
        .from(equipoAsignaciones)
        .where(
          and(
            eq(equipoAsignaciones.id, asignacionId),
            eq(equipoAsignaciones.companyId, this.dbs.getCompanyId()),
          ),
        )
        .for('update');
      if (!a)
        throw errorEam('EAM_ASSIGNMENT_NOT_FOUND', 'Asignación no encontrada');
      const obra = await this.obraAccesible(tx, a.projectId);
      verificarVersion(a.version, version);
      const existentes = await tx
        .select({
          id: equipoAsignaciones.id,
          desde: equipoAsignaciones.desde,
          hasta: equipoAsignaciones.hasta,
        })
        .from(equipoAsignaciones)
        .where(eq(equipoAsignaciones.equipoId, a.equipoId));
      reglaEam(() =>
        validarAsignacion({ id: a.id, desde: a.desde, hasta }, existentes),
      );
      const [act] = await tx
        .update(equipoAsignaciones)
        .set({
          hasta,
          version: sql`${equipoAsignaciones.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(equipoAsignaciones.id, a.id))
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'equipo_asignacion',
        entityId: a.id,
        action: 'update',
        oldData: { hasta: a.hasta },
        newData: { hasta },
      });
      return this.asignacionDto(act, obra.name);
    });
  }

  async planes(id: string): Promise<PlanMantenimientoDto[]> {
    const e = await this.equipo(this.dbs.db, id);
    const filas = await this.dbs.db
      .select()
      .from(planesMantenimiento)
      .where(eq(planesMantenimiento.equipoId, id))
      .orderBy(asc(planesMantenimiento.nombre));
    return Promise.all(filas.map((p) => this.planDto(this.dbs.db, p, e)));
  }

  async plan(ex: DbOrTx, planId: string): Promise<PlanMantenimientoDto> {
    const [p] = await ex
      .select()
      .from(planesMantenimiento)
      .where(
        and(
          eq(planesMantenimiento.id, planId),
          eq(planesMantenimiento.companyId, this.dbs.getCompanyId()),
        ),
      );
    if (!p)
      throw errorEam(
        'EAM_PLAN_NOT_FOUND',
        'Plan de mantenimiento no encontrado',
      );
    return this.planDto(ex, p, await this.equipo(ex, p.equipoId));
  }

  async crearPlan(
    id: string,
    input: PlanCreateInput,
  ): Promise<PlanMantenimientoDto> {
    const d = planCreateSchema.parse(input);
    reglaEam(() => validarPlan(d));
    const planId = await this.dbs.db.transaction(async (tx) => {
      const e = await this.equipo(tx, id);
      if (e.estado === 'baja')
        throw errorEam('EAM_EQUIPMENT_RETIRED', 'El equipo está dado de baja');
      const [p] = await tx
        .insert(planesMantenimiento)
        .values({
          companyId: this.dbs.getCompanyId(),
          equipoId: id,
          nombre: d.nombre,
          tipo: d.tipo,
          periodicidadDias: d.periodicidadDias ?? null,
          intervaloHoras: d.intervaloHoras?.toFixed(2) ?? null,
          intervaloKm: d.intervaloKm?.toFixed(2) ?? null,
          avisoDias: d.avisoDias,
          avisoHoras: d.avisoHoras.toFixed(2),
          avisoKm: d.avisoKm.toFixed(2),
          ultimaFecha: d.ultimaFecha ?? null,
          ultimaHoras: d.ultimaHoras?.toFixed(2) ?? null,
          ultimaKm: d.ultimaKm?.toFixed(2) ?? null,
          createdBy: getRequestContext()?.userId ?? null,
        })
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'plan_mantenimiento',
        entityId: p.id,
        action: 'create',
        newData: p,
      });
      return p.id;
    });
    return this.plan(this.dbs.db, planId);
  }

  async actualizarPlan(
    planId: string,
    input: PlanUpdateInput,
    version: number | undefined,
  ): Promise<PlanMantenimientoDto> {
    const d = planUpdateSchema.parse(input);
    await this.dbs.db.transaction(async (tx) => {
      const [p] = await tx
        .select()
        .from(planesMantenimiento)
        .where(
          and(
            eq(planesMantenimiento.id, planId),
            eq(planesMantenimiento.companyId, this.dbs.getCompanyId()),
          ),
        )
        .for('update');
      if (!p)
        throw errorEam(
          'EAM_PLAN_NOT_FOUND',
          'Plan de mantenimiento no encontrado',
        );
      await this.equipo(tx, p.equipoId);
      verificarVersion(p.version, version);
      const fix = (v: number | null | undefined) =>
        v === undefined ? undefined : v === null ? null : v.toFixed(2);
      const cambios = Object.fromEntries(
        Object.entries({
          nombre: d.nombre,
          tipo: d.tipo,
          periodicidadDias: d.periodicidadDias,
          intervaloHoras: fix(d.intervaloHoras),
          intervaloKm: fix(d.intervaloKm),
          avisoDias: d.avisoDias,
          avisoHoras: fix(d.avisoHoras),
          avisoKm: fix(d.avisoKm),
          ultimaFecha: d.ultimaFecha,
          ultimaHoras: fix(d.ultimaHoras),
          ultimaKm: fix(d.ultimaKm),
          activo: d.activo,
        }).filter(([, v]) => v !== undefined),
      );
      const resultado = { ...p, ...cambios };
      reglaEam(() => validarPlan(resultado));
      await tx
        .update(planesMantenimiento)
        .set({
          ...cambios,
          version: sql`${planesMantenimiento.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(planesMantenimiento.id, planId));
      const antes = Object.fromEntries(
        Object.keys(cambios).map((k) => [k, (p as Record<string, unknown>)[k]]),
      );
      await this.audit.registrar(tx, {
        entityType: 'plan_mantenimiento',
        entityId: planId,
        action: 'update',
        oldData: antes,
        newData: diferenciasAuditoria(antes, cambios),
      });
    });
    return this.plan(this.dbs.db, planId);
  }
}
