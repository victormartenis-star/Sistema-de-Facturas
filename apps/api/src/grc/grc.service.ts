import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  approvalDelegations,
  approvalRequests,
  approvalSteps,
  auditLog,
  sodPolicies,
  users,
  type DbOrTx,
  type Tx,
} from '@erp/db';
import {
  CONFLICTOS_SOD,
  CONFLICTOS_SOD_FIJOS,
  CONFLICTO_SOD_LABELS,
  ErrorGrc,
  POLITICA_SOD_DEFECTO,
  delegacionCreateSchema,
  evaluarSod,
  todayIso,
  validarDelegacion,
  validarPoliticaSod,
  type ConflictoSod,
  type Delegacion,
  type DelegacionCreateInput,
  type DelegacionDto,
  type ModoSod,
  type PoliticaSodDto,
  type ResultadoSod,
  type UsuarioDestino,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { getRequestContext } from '../common/request-context';
import { verificarVersion } from '../common/version';
import { DbService } from '../db/db.service';

const ROLES_APROBADOR = ['administracion', 'gerente', 'admin'];

/** Rechazo de una regla pura GRC → RFC 7807. */
export function reglaGrc<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ErrorGrc) {
      const cuerpo = { code: e.code, message: e.message };
      if (e.code === 'APPROVAL_DELEGATION_OVERLAP')
        throw new ConflictException(cuerpo);
      if (e.code === 'SOD_POLICY_LOCKED') throw new ForbiddenException(cuerpo);
      throw new UnprocessableEntityException(cuerpo);
    }
    throw e;
  }
}

export interface ContextoSod {
  operacion: string;
  entidadId: string;
  referencia: string;
}

/**
 * Governance, Risk & Compliance: políticas de segregación de funciones,
 * delegaciones (suplencias), creador de un documento (por la auditoría),
 * usuarios destinatarios y registro de eventos SoD (bloqueos y excepciones)
 * en `audit_log`, que sirve de informe de riesgos.
 */
@Injectable()
export class GrcService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  /* ───────────────────────── políticas SoD ───────────────────────── */

  async politica(ex: DbOrTx): Promise<Partial<Record<ConflictoSod, ModoSod>>> {
    const filas = await ex
      .select({ conflicto: sodPolicies.conflict, modo: sodPolicies.mode })
      .from(sodPolicies)
      .where(eq(sodPolicies.companyId, this.dbs.getCompanyId()));
    return Object.fromEntries(
      filas.map((f) => [f.conflicto, f.modo]),
    ) as Partial<Record<ConflictoSod, ModoSod>>;
  }

  async politicas(): Promise<PoliticaSodDto[]> {
    const filas = await this.dbs.db
      .select()
      .from(sodPolicies)
      .where(eq(sodPolicies.companyId, this.dbs.getCompanyId()));
    return CONFLICTOS_SOD.map((c) => {
      const f = filas.find((x) => x.conflict === c);
      return {
        conflicto: c,
        descripcion: CONFLICTO_SOD_LABELS[c],
        modo: (f?.mode as ModoSod) ?? POLITICA_SOD_DEFECTO[c],
        fija: CONFLICTOS_SOD_FIJOS.includes(c),
        configurada: Boolean(f),
        version: f?.version ?? 0,
      };
    });
  }

  async actualizarPolitica(
    conflicto: ConflictoSod,
    modo: ModoSod,
    version: number | undefined,
  ): Promise<PoliticaSodDto[]> {
    reglaGrc(() => validarPoliticaSod(conflicto, modo));
    const companyId = this.dbs.getCompanyId();
    await this.dbs.db.transaction(async (tx) => {
      const [f] = await tx
        .select()
        .from(sodPolicies)
        .where(
          and(
            eq(sodPolicies.companyId, companyId),
            eq(sodPolicies.conflict, conflicto),
          ),
        )
        .for('update');
      const userId = getRequestContext()?.userId ?? null;
      if (f) {
        verificarVersion(f.version, version);
        await tx
          .update(sodPolicies)
          .set({
            mode: modo,
            updatedBy: userId,
            version: f.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(sodPolicies.id, f.id));
      } else {
        await tx.insert(sodPolicies).values({
          companyId,
          conflict: conflicto,
          mode: modo,
          updatedBy: userId,
        });
      }
      const [actual] = await tx
        .select({ id: sodPolicies.id })
        .from(sodPolicies)
        .where(
          and(
            eq(sodPolicies.companyId, companyId),
            eq(sodPolicies.conflict, conflicto),
          ),
        );
      await this.audit.registrar(tx, {
        entityType: 'sod_policy',
        entityId: actual.id,
        action: f ? 'update' : 'create',
        oldData: {
          conflicto,
          modo: (f?.mode as ModoSod) ?? POLITICA_SOD_DEFECTO[conflicto],
        },
        newData: { conflicto, modo },
      });
    });
    return this.politicas();
  }

  /* ───────────────────────── eventos SoD ───────────────────────── */

  /** Excepciones permitidas por política: quedan en la auditoría (antes/después). */
  async registrarExcepciones(
    tx: Tx,
    ctx: ContextoSod,
    sod: ResultadoSod,
    enNombreDe: string | null = null,
  ): Promise<void> {
    if (sod.excepciones.length === 0) return;
    await this.audit.registrar(tx, {
      entityType: 'sod_event',
      entityId: ctx.entidadId,
      action: 'create',
      oldData: null,
      newData: {
        resultado: 'permitido',
        operacion: ctx.operacion,
        referencia: ctx.referencia,
        excepciones: sod.excepciones,
        enNombreDe,
      },
    });
  }

  /**
   * Conflicto que impide la operación: se audita en una transacción aparte
   * (la de la operación se deshará) y se lanza el error RFC 7807.
   */
  async bloquear(
    ctx: ContextoSod,
    sod: ResultadoSod,
    codigoLegado?: string,
  ): Promise<never> {
    const companyId = this.dbs.getCompanyId();
    await this.dbs.db.transaction((trx) =>
      this.audit.registrar(
        trx,
        {
          entityType: 'sod_event',
          entityId: ctx.entidadId,
          action: 'create',
          newData: {
            resultado: 'bloqueado',
            operacion: ctx.operacion,
            referencia: ctx.referencia,
            errorCode: codigoLegado ?? sod.bloqueo,
            conflictos: sod.conflictos,
          },
        },
        { companyId },
      ),
    );
    const detalle = sod.conflictos
      .map((c) => CONFLICTO_SOD_LABELS[c.conflicto])
      .join('; ');
    if (codigoLegado === 'SELF_APPROVAL_FORBIDDEN') {
      throw new ForbiddenException({
        code: codigoLegado,
        message:
          'Quien solicita la aprobación no puede decidirla (segregación de funciones)',
        conflictos: sod.conflictos,
      });
    }
    if (sod.bloqueo === 'SOD_JUSTIFICATION_REQUIRED') {
      throw new UnprocessableEntityException({
        code: 'SOD_JUSTIFICATION_REQUIRED',
        message: `Segregación de funciones: ${detalle}. Indica una justificación (justificacionSod)`,
        conflictos: sod.conflictos,
      });
    }
    throw new ForbiddenException({
      code: 'SOD_CONFLICT',
      message: `Segregación de funciones: ${detalle}`,
      conflictos: sod.conflictos,
    });
  }

  /** Eventos SoD de la empresa (informe de riesgos). */
  async eventos(limite = 200) {
    const filas = await this.dbs.db
      .select({
        id: auditLog.id,
        fecha: auditLog.occurredAt,
        userId: auditLog.userId,
        usuario: users.fullName,
        entidadId: auditLog.entityId,
        datos: auditLog.newData,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.userId))
      .where(
        and(
          eq(auditLog.companyId, this.dbs.getCompanyId()),
          eq(auditLog.entityType, 'sod_event'),
        ),
      )
      .orderBy(desc(auditLog.sequenceNumber))
      .limit(limite);
    return filas.map((f) => ({ ...f, fecha: f.fecha.toISOString() }));
  }

  /**
   * «Quien aprobó la factura de compra la paga»: si el usuario (o aquel en
   * cuyo nombre actuó) aprobó algún nivel de la factura, aplica la política
   * (bloquear, justificar o auditar). Devuelve sin hacer nada si no hay conflicto.
   */
  async verificarAprobadorPaga(
    tx: Tx,
    facturaIds: readonly string[],
    ctx: ContextoSod,
    justificacion?: string | null,
  ): Promise<void> {
    const userId = getRequestContext()?.userId;
    if (!userId || facturaIds.length === 0) return;
    const [aprobo] = await tx
      .select({ id: approvalSteps.id })
      .from(approvalSteps)
      .innerJoin(
        approvalRequests,
        eq(approvalRequests.id, approvalSteps.requestId),
      )
      .where(
        and(
          eq(approvalRequests.companyId, this.dbs.getCompanyId()),
          eq(approvalRequests.operation, 'factura_compra'),
          inArray(approvalRequests.entityId, [...facturaIds]),
          eq(approvalSteps.status, 'aprobado'),
          or(
            eq(approvalSteps.decidedBy, userId),
            eq(approvalSteps.onBehalfOf, userId),
          ),
        ),
      )
      .limit(1);
    if (!aprobo) return;
    const sod = evaluarSod({
      detectados: ['aprobador_paga'],
      politica: await this.politica(tx),
      justificacion,
    });
    if (sod.bloqueo) await this.bloquear(ctx, sod);
    await this.registrarExcepciones(tx, ctx, sod);
  }

  /* ───────────────────────── personas ───────────────────────── */

  /** Creador del documento según la auditoría (primera alta registrada). */
  async creadorDe(ex: DbOrTx, entidadId: string): Promise<string | null> {
    const [f] = await ex
      .select({ userId: auditLog.userId })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.companyId, this.dbs.getCompanyId()),
          eq(auditLog.entityId, entidadId),
          eq(auditLog.action, 'create'),
        ),
      )
      .orderBy(asc(auditLog.sequenceNumber))
      .limit(1);
    return f?.userId ?? null;
  }

  async usuariosActivos(ex: DbOrTx): Promise<UsuarioDestino[]> {
    const filas = await ex
      .select({ id: users.id, rol: users.role, activo: users.isActive })
      .from(users)
      .where(
        and(
          eq(users.companyId, this.dbs.getCompanyId()),
          isNull(users.deletedAt),
        ),
      );
    return filas.map((f) => ({ id: f.id, rol: f.rol, activo: f.activo }));
  }

  async delegacionesVigentes(ex: DbOrTx): Promise<Delegacion[]> {
    const filas = await ex
      .select({ d: approvalDelegations, rol: users.role })
      .from(approvalDelegations)
      .innerJoin(users, eq(users.id, approvalDelegations.delegatorId))
      .where(
        and(
          eq(approvalDelegations.companyId, this.dbs.getCompanyId()),
          eq(approvalDelegations.isActive, true),
        ),
      );
    return filas.map(({ d, rol }) => ({
      delegante: { id: d.delegatorId, rol },
      delegadoId: d.delegateId,
      desde: d.fromDate,
      hasta: d.toDate,
      activa: d.isActive,
    }));
  }

  /* ───────────────────────── delegaciones ───────────────────────── */

  private async delegacionDto(id: string): Promise<DelegacionDto> {
    const [d] = await this.listarDelegaciones(true, id);
    if (!d)
      throw new NotFoundException({
        code: 'APPROVAL_DELEGATION_NOT_FOUND',
        message: 'Delegación no encontrada',
      });
    return d;
  }

  /** Mis delegaciones (dadas o recibidas); con `todas`, las de la empresa. */
  async listarDelegaciones(
    todas: boolean,
    id?: string,
  ): Promise<DelegacionDto[]> {
    const userId = getRequestContext()?.userId ?? '';
    const delegante = sql`(select full_name from users u where u.id = ${approvalDelegations.delegatorId})`;
    const delegado = sql`(select full_name from users u where u.id = ${approvalDelegations.delegateId})`;
    const filas = await this.dbs.db
      .select({
        d: approvalDelegations,
        delegante: sql<string>`${delegante}`,
        delegado: sql<string>`${delegado}`,
      })
      .from(approvalDelegations)
      .where(
        and(
          eq(approvalDelegations.companyId, this.dbs.getCompanyId()),
          ...(id ? [eq(approvalDelegations.id, id)] : []),
          ...(todas
            ? []
            : [
                or(
                  eq(approvalDelegations.delegatorId, userId),
                  eq(approvalDelegations.delegateId, userId),
                ),
              ]),
        ),
      )
      .orderBy(desc(approvalDelegations.fromDate));
    return filas.map(({ d, delegante: dn, delegado: dd }) => ({
      id: d.id,
      deleganteId: d.delegatorId,
      deleganteNombre: dn,
      delegadoId: d.delegateId,
      delegadoNombre: dd,
      desde: d.fromDate,
      hasta: d.toDate,
      motivo: d.reason,
      activa: d.isActive,
      version: d.version,
    }));
  }

  /**
   * Delegación de quien aprueba (o, para gobierno, en nombre de otro): el
   * delegado decide con el rol del delegante entre las dos fechas.
   */
  async crearDelegacion(
    input: DelegacionCreateInput & { deleganteId?: string | null },
  ): Promise<DelegacionDto> {
    const d = delegacionCreateSchema.parse(input);
    const ctx = getRequestContext();
    const companyId = this.dbs.getCompanyId();
    const deleganteId = input.deleganteId ?? ctx?.userId ?? '';
    if (
      deleganteId !== ctx?.userId &&
      ctx?.role !== 'admin' &&
      ctx?.role !== 'gerente'
    ) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Solo admin o gerente delegan en nombre de otro',
      });
    }
    if (d.hasta < todayIso()) {
      throw new UnprocessableEntityException({
        code: 'APPROVAL_DELEGATION_INVALID',
        message: 'La delegación ya habría terminado',
      });
    }
    const id = await this.dbs.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`delegacion:${deleganteId}`}))`,
      );
      const personas = await tx
        .select({ id: users.id, rol: users.role, activo: users.isActive })
        .from(users)
        .where(
          and(
            eq(users.companyId, companyId),
            inArray(users.id, [deleganteId, d.delegadoId]),
            isNull(users.deletedAt),
          ),
        );
      const quien = personas.find((p) => p.id === deleganteId);
      const delegado = personas.find((p) => p.id === d.delegadoId);
      if (
        !quien ||
        !ROLES_APROBADOR.includes(quien.rol) ||
        !delegado?.activo ||
        !ROLES_APROBADOR.includes(delegado.rol)
      ) {
        throw new UnprocessableEntityException({
          code: 'APPROVAL_USER_INVALID',
          message:
            'Delegante y delegado deben ser usuarios activos con rol de aprobación',
        });
      }
      const existentes = await tx
        .select({
          desde: approvalDelegations.fromDate,
          hasta: approvalDelegations.toDate,
          activa: approvalDelegations.isActive,
        })
        .from(approvalDelegations)
        .where(
          and(
            eq(approvalDelegations.companyId, companyId),
            eq(approvalDelegations.delegatorId, deleganteId),
          ),
        );
      reglaGrc(() =>
        validarDelegacion(
          {
            deleganteId,
            delegadoId: d.delegadoId,
            desde: d.desde,
            hasta: d.hasta,
          },
          existentes,
        ),
      );
      const [nueva] = await tx
        .insert(approvalDelegations)
        .values({
          companyId,
          delegatorId: deleganteId,
          delegateId: d.delegadoId,
          fromDate: d.desde,
          toDate: d.hasta,
          reason: d.motivo,
          createdBy: ctx?.userId ?? null,
        })
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'approval_delegation',
        entityId: nueva.id,
        action: 'create',
        newData: nueva,
      });
      return nueva.id;
    });
    return this.delegacionDto(id);
  }

  async revocarDelegacion(
    id: string,
    version: number | undefined,
  ): Promise<DelegacionDto> {
    const ctx = getRequestContext();
    await this.dbs.db.transaction(async (tx) => {
      const [d] = await tx
        .select()
        .from(approvalDelegations)
        .where(
          and(
            eq(approvalDelegations.id, id),
            eq(approvalDelegations.companyId, this.dbs.getCompanyId()),
          ),
        )
        .for('update');
      if (!d)
        throw new NotFoundException({
          code: 'APPROVAL_DELEGATION_NOT_FOUND',
          message: 'Delegación no encontrada',
        });
      if (
        d.delegatorId !== ctx?.userId &&
        ctx?.role !== 'admin' &&
        ctx?.role !== 'gerente'
      ) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'Solo el delegante, admin o gerente la revocan',
        });
      }
      verificarVersion(d.version, version);
      await tx
        .update(approvalDelegations)
        .set({ isActive: false, version: d.version + 1, updatedAt: new Date() })
        .where(eq(approvalDelegations.id, id));
      await this.audit.registrar(tx, {
        entityType: 'approval_delegation',
        entityId: id,
        action: 'update',
        oldData: { activa: d.isActive },
        newData: { activa: false },
      });
    });
    return this.delegacionDto(id);
  }
}
