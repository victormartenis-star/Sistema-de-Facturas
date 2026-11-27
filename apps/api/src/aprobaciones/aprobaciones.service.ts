import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  or,
  sql,
  SQL,
} from 'drizzle-orm';
import {
  approvalRequests,
  approvalRuleLevels,
  approvalRules,
  approvalSteps,
  auditLog,
  certificacionesSubcontrata,
  contratosSubcontrata,
  invoiceLines,
  invoices,
  projects,
  purchaseOrders,
  userProjectAccess,
  users,
  type ApprovalRequest,
  type ApprovalRule,
  type ApprovalStep,
  type DbOrTx,
  type Tx,
} from '@erp/db';
import {
  CONFLICTO_SOD_LABELS,
  ESTADO_SOLICITUD_LABELS,
  OPERACION_APROBACION_LABELS,
  ROL_APROBADOR_LABELS,
  centsToNumeric,
  decidirPaso,
  decisionAprobarSchema,
  decisionMotivoSchema,
  destinatariosPaso,
  escalarRol,
  evaluarAprobacion,
  exigeReaprobacion,
  nivelesAprobacion,
  reasignarPasoSchema,
  reglaAplicable,
  reglaAprobacionCreateSchema,
  reglaAprobacionUpdateSchema,
  rolMaximo,
  solicitudAprobacionCreateSchema,
  toCents,
  todayIso,
  validarNiveles,
  type ConflictoSod,
  type DecisionAprobarInput,
  type DecisionMotivoInput,
  type DecisionPaso,
  type Delegacion,
  type EstadoAprobacionDto,
  type EstadoPasoAprobacion,
  type EstadoSolicitudAprobacion,
  type EvaluacionAprobacion,
  type ModoSod,
  type NivelAprobacionDto,
  type NivelConfigurado,
  type OperacionAprobacion,
  type PasoAprobacionDto,
  type ReasignarPasoInput,
  type ReglaAprobacionCreateInput,
  type ReglaAprobacionDto,
  type ReglaAprobacionUpdateInput,
  type RolAprobador,
  type SolicitudAprobacionCreateInput,
  type SolicitudAprobacionDto,
  type SolicitudesQuery,
} from '@erp/shared';
import { NotificacionesService } from '../alerts/notificaciones.service';
import { AuditService } from '../audit/audit.service';
import { cambiarEstado, cambiarEstadoMasivo } from '../common/cambiar-estado';
import { getRequestContext } from '../common/request-context';
import { verificarVersion } from '../common/version';
import { DbService } from '../db/db.service';
import { GrcService, reglaGrc } from '../grc/grc.service';

/** Documento sujeto a aprobación, ya resuelto. */
interface Documento {
  operacion: OperacionAprobacion;
  id: string;
  referencia: string;
  /** Importe que se compara con los umbrales. */
  importe: string;
  projectId: string | null;
}

/** Contexto compartido para calcular quién puede decidir varias solicitudes. */
interface ContextoDecision {
  delegaciones: Delegacion[];
  politica: Partial<Record<ConflictoSod, ModoSod>>;
  creadores: Map<string, string | null>;
  pasos: Map<string, ApprovalStep[]>;
  nombres: Map<string, string>;
}

const reglaNoEncontrada = () =>
  new NotFoundException({
    code: 'APPROVAL_RULE_NOT_FOUND',
    message: 'Regla de aprobación no encontrada',
  });
const solicitudNoEncontrada = () =>
  new NotFoundException({
    code: 'APPROVAL_REQUEST_NOT_FOUND',
    message: 'Solicitud de aprobación no encontrada',
  });

function nivelesConfig(
  filas: {
    level: number;
    minAmount: string;
    requiredRole: string;
    approverUserId: string | null;
    slaHours: number | null;
  }[],
): NivelConfigurado[] {
  return filas.map((n) => ({
    nivel: n.level,
    importeMinimo: n.minAmount,
    rolRequerido: n.requiredRole as RolAprobador,
    aprobadorId: n.approverUserId,
    plazoHoras: n.slaHours,
  }));
}

function reglaDto(
  r: ApprovalRule,
  codigo: string | null,
  niveles: NivelAprobacionDto[] = [],
): ReglaAprobacionDto {
  return {
    id: r.id,
    nombre: r.name,
    operacion: r.operation as OperacionAprobacion,
    importeMinimo: Number(r.minAmount),
    rolRequerido: r.requiredRole as RolAprobador,
    projectId: r.projectId,
    projectCodigo: codigo,
    activa: r.isActive,
    version: r.version,
    niveles,
  };
}

/** Error de la puerta de aprobación (409) con el detalle para el cliente. */
function errorPuerta(
  ev: EvaluacionAprobacion,
  doc: Documento,
  rolRequerido: RolAprobador | null,
  solicitudId: string | null,
): HttpException {
  return new ConflictException({
    code: ev.errorCode,
    message: `${doc.referencia}: ${ev.motivo}`,
    operacion: doc.operacion,
    entidadId: doc.id,
    importe: Number(doc.importe),
    rolRequerido,
    solicitudId,
  });
}

const sumarHoras = (d: Date, h: number | null) =>
  h ? new Date(d.getTime() + h * 3_600_000) : null;

/**
 * Flujos de aprobación por umbral (SAP Release Strategy / Flexible Workflow,
 * Oracle Approvals).
 *
 * - Reglas por empresa, operación y obra (opcional) con importe mínimo y nivel;
 *   desde la fase 7, con una cadena multinivel opcional (niveles desde un
 *   importe, con rol o aprobador concreto y plazo).
 * - Solicitudes con snapshot del documento y sus pasos (uno activo a la vez);
 *   una sola solicitud viva por documento.
 * - Decide el aprobador del paso o un delegado vigente; segregación de
 *   funciones con política (quien solicita, quien ya firmó otro nivel, quien
 *   creó el documento).
 * - Notificaciones dirigidas: a quien puede decidir el paso activo y, con la
 *   decisión, a quien solicitó, a quien firmó y a los jefes de la obra.
 * - `exigir()` es la puerta que llaman pedidos (al validar albaranes),
 *   facturas de compra y certificaciones de subcontrata (al aprobar).
 * - `invalidarSiProcede()` lo llaman las ediciones que suben el importe.
 * Sin reglas activas nada cambia: los flujos existentes siguen igual.
 */
@Injectable()
export class AprobacionesService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly notificaciones: NotificacionesService,
    private readonly grc: GrcService,
  ) {}

  /* ─────────────────────────── documentos ─────────────────────────── */

  /** Carga el documento de la empresa (404 si no existe o no es accesible). */
  private async documento(
    ex: DbOrTx,
    operacion: OperacionAprobacion,
    id: string,
  ): Promise<Documento> {
    const companyId = this.dbs.getCompanyId();
    let doc: Documento | null = null;
    if (operacion === 'pedido_compra') {
      const [p] = await ex
        .select({
          referencia: purchaseOrders.orderNumber,
          importe: purchaseOrders.amount,
          projectId: purchaseOrders.projectId,
        })
        .from(purchaseOrders)
        .where(
          and(
            eq(purchaseOrders.id, id),
            eq(purchaseOrders.companyId, companyId),
            isNull(purchaseOrders.deletedAt),
          ),
        )
        .limit(1);
      if (p) doc = { operacion, id, ...p };
    } else if (operacion === 'factura_compra') {
      const [f] = await ex
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.id, id),
            eq(invoices.companyId, companyId),
            isNull(invoices.deletedAt),
          ),
        )
        .limit(1);
      if (f) {
        if (
          f.kind !== 'compra' ||
          f.rectifiesInvoiceId ||
          f.certSubcontrataId
        ) {
          throw new UnprocessableEntityException({
            code: 'APPROVAL_NOT_APPLICABLE',
            message:
              'Solo las facturas de compra ordinarias pasan por aprobación (las rectificativas y las de subcontrata siguen a su documento de origen)',
          });
        }
        const obras = await ex
          .selectDistinct({ projectId: invoiceLines.projectId })
          .from(invoiceLines)
          .where(eq(invoiceLines.invoiceId, id));
        doc = {
          operacion,
          id,
          referencia: f.invoiceNumber,
          importe: f.totalAmount,
          // Una factura de una sola obra se rige también por sus reglas.
          projectId: obras.length === 1 ? obras[0].projectId : null,
        };
      }
    } else {
      const [c] = await ex
        .select({
          numero: certificacionesSubcontrata.numero,
          importe: certificacionesSubcontrata.importePeriodo,
          contrato: contratosSubcontrata.numeroContrato,
          projectId: contratosSubcontrata.proyectoId,
        })
        .from(certificacionesSubcontrata)
        .innerJoin(
          contratosSubcontrata,
          eq(contratosSubcontrata.id, certificacionesSubcontrata.contratoId),
        )
        .where(
          and(
            eq(certificacionesSubcontrata.id, id),
            eq(certificacionesSubcontrata.companyId, companyId),
            isNull(certificacionesSubcontrata.deletedAt),
          ),
        )
        .limit(1);
      if (c) {
        doc = {
          operacion,
          id,
          referencia: `${c.contrato} · cert. ${c.numero}`,
          importe: c.importe,
          projectId: c.projectId,
        };
      }
    }
    const obras = await this.dbs.getObrasAccesibles();
    if (
      !doc ||
      (obras !== null && (!doc.projectId || !obras.includes(doc.projectId)))
    ) {
      throw new NotFoundException({
        code: 'APPROVAL_ENTITY_NOT_FOUND',
        message: 'Documento no encontrado',
      });
    }
    return doc;
  }

  private async reglasActivas(
    ex: DbOrTx,
    operacion: OperacionAprobacion,
  ): Promise<ApprovalRule[]> {
    return ex
      .select()
      .from(approvalRules)
      .where(
        and(
          eq(approvalRules.companyId, this.dbs.getCompanyId()),
          eq(approvalRules.operation, operacion),
          eq(approvalRules.isActive, true),
        ),
      );
  }

  private reglaDe(reglas: ApprovalRule[], doc: Documento) {
    return reglaAplicable(
      reglas.map((r) => ({
        r,
        id: r.id,
        operacion: r.operation as OperacionAprobacion,
        importeMinimo: r.minAmount,
        projectId: r.projectId,
        rolRequerido: r.requiredRole as RolAprobador,
        activa: r.isActive,
      })),
      doc,
    )?.r;
  }

  /** Cadena configurada de una regla (vacía si es de un solo nivel). */
  private async nivelesDe(
    ex: DbOrTx,
    ruleId: string,
  ): Promise<NivelConfigurado[]> {
    const filas = await ex
      .select()
      .from(approvalRuleLevels)
      .where(eq(approvalRuleLevels.ruleId, ruleId))
      .orderBy(asc(approvalRuleLevels.level));
    return nivelesConfig(filas);
  }

  /** Rol más alto que la regla exige hoy para el importe (cadena incluida). */
  private async rolExigido(
    ex: DbOrTx,
    regla: ApprovalRule,
    importe: string,
  ): Promise<RolAprobador> {
    const niveles = nivelesAprobacion({
      rolRegla: regla.requiredRole as RolAprobador,
      niveles: await this.nivelesDe(ex, regla.id),
      importe,
    });
    return rolMaximo(niveles.map((n) => n.rolRequerido));
  }

  /** Última solicitud del documento (la viva si la hay). */
  private async ultimaSolicitud(
    ex: DbOrTx,
    operacion: OperacionAprobacion,
    entidadId: string,
  ): Promise<ApprovalRequest | undefined> {
    const [s] = await ex
      .select()
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.companyId, this.dbs.getCompanyId()),
          eq(approvalRequests.operation, operacion),
          eq(approvalRequests.entityId, entidadId),
        ),
      )
      .orderBy(
        sql`(${approvalRequests.status} in ('pendiente', 'aprobada')) desc`,
        desc(approvalRequests.requestedAt),
      )
      .limit(1);
    return s;
  }

  private evaluar(
    regla: ApprovalRule | undefined,
    rolExigido: RolAprobador | null,
    s: ApprovalRequest | undefined,
    doc: Documento,
  ): EvaluacionAprobacion {
    return evaluarAprobacion({
      regla: regla
        ? {
            rolRequerido: rolExigido ?? (regla.requiredRole as RolAprobador),
            importeMinimo: regla.minAmount,
          }
        : null,
      solicitud: s
        ? {
            estado: s.status as EstadoSolicitudAprobacion,
            importe: s.amount,
            rolRequerido: s.requiredRole as RolAprobador,
          }
        : null,
      importeActual: doc.importe,
    });
  }

  /* ──────────────────── decisión y destinatarios ──────────────────── */

  private async contextoDecision(
    ex: DbOrTx,
    solicitudes: ApprovalRequest[],
  ): Promise<ContextoDecision> {
    const ids = solicitudes.map((s) => s.id);
    const entidades = [...new Set(solicitudes.map((s) => s.entityId))];
    const [delegaciones, politica, pasos, creadores] = await Promise.all([
      this.grc.delegacionesVigentes(ex),
      this.grc.politica(ex),
      ids.length
        ? ex
            .select()
            .from(approvalSteps)
            .where(inArray(approvalSteps.requestId, ids))
            .orderBy(asc(approvalSteps.level))
        : Promise.resolve([] as ApprovalStep[]),
      entidades.length
        ? ex
            .selectDistinctOn([auditLog.entityId], {
              entityId: auditLog.entityId,
              userId: auditLog.userId,
            })
            .from(auditLog)
            .where(
              and(
                eq(auditLog.companyId, this.dbs.getCompanyId()),
                inArray(auditLog.entityId, entidades),
                eq(auditLog.action, 'create'),
              ),
            )
            .orderBy(auditLog.entityId, asc(auditLog.sequenceNumber))
        : Promise.resolve([] as { entityId: string; userId: string | null }[]),
    ]);
    const porSolicitud = new Map<string, ApprovalStep[]>();
    for (const p of pasos)
      porSolicitud.set(p.requestId, [
        ...(porSolicitud.get(p.requestId) ?? []),
        p,
      ]);
    const personas = new Set<string>();
    for (const p of pasos)
      for (const u of [p.approverUserId, p.decidedBy, p.onBehalfOf])
        if (u) personas.add(u);
    const nombres = personas.size
      ? await ex
          .select({ id: users.id, nombre: users.fullName })
          .from(users)
          .where(inArray(users.id, [...personas]))
      : [];
    return {
      delegaciones,
      politica,
      creadores: new Map(creadores.map((c) => [c.entityId, c.userId])),
      pasos: porSolicitud,
      nombres: new Map(nombres.map((n) => [n.id, n.nombre])),
    };
  }

  /** Decisión del usuario actual sobre el paso activo de una solicitud. */
  private decision(
    s: ApprovalRequest,
    activo: ApprovalStep,
    pasos: ApprovalStep[],
    c: ContextoDecision,
    justificacion?: string | null,
  ): DecisionPaso {
    const ctx = getRequestContext();
    return decidirPaso({
      paso: {
        rolRequerido: activo.requiredRole as RolAprobador,
        aprobadorId: activo.approverUserId,
      },
      usuario: { id: ctx?.userId ?? '', rol: ctx?.role ?? '' },
      solicitanteId: s.requestedBy,
      creadorId: c.creadores.get(s.entityId) ?? null,
      aprobadoresPrevios: pasos
        .filter((p) => p.status === 'aprobado')
        .flatMap((p) =>
          [p.decidedBy, p.onBehalfOf].filter((x): x is string => Boolean(x)),
        ),
      delegaciones: c.delegaciones,
      hoy: todayIso(),
      politica: c.politica,
      justificacion,
    });
  }

  private pasoDto(p: ApprovalStep, c: ContextoDecision): PasoAprobacionDto {
    return {
      id: p.id,
      nivel: p.level,
      rolRequerido: p.requiredRole as RolAprobador,
      aprobadorId: p.approverUserId,
      aprobadorNombre: p.approverUserId
        ? (c.nombres.get(p.approverUserId) ?? null)
        : null,
      estado: p.status as EstadoPasoAprobacion,
      activadoEn: p.activatedAt?.toISOString() ?? null,
      venceEl: p.dueAt?.toISOString() ?? null,
      escalado: p.escalated,
      decididoPor: p.decidedBy,
      decididoPorNombre: p.decidedBy
        ? (c.nombres.get(p.decidedBy) ?? null)
        : null,
      enNombreDe: p.onBehalfOf,
      decididoEn: p.decidedAt?.toISOString() ?? null,
      comentario: p.comment,
      version: p.version,
    };
  }

  private solicitudDto(
    s: ApprovalRequest,
    c: ContextoDecision,
  ): SolicitudAprobacionDto {
    const pasos = c.pasos.get(s.id) ?? [];
    const activo = pasos.find((p) => p.status === 'activo');
    let puedoDecidir = false;
    let avisoSod: string | null = null;
    if (s.status === 'pendiente' && activo && getRequestContext()) {
      const d = this.decision(s, activo, pasos, c);
      puedoDecidir =
        d.impedimento === null ||
        d.impedimento === 'SOD_JUSTIFICATION_REQUIRED';
      if (d.sod.conflictos.length > 0) {
        avisoSod = `${d.impedimento === 'SOD_CONFLICT' ? 'Bloqueado' : d.impedimento === 'SOD_JUSTIFICATION_REQUIRED' ? 'Requiere justificación' : 'Excepción auditada'}: ${d.sod.conflictos
          .map((x) => CONFLICTO_SOD_LABELS[x.conflicto])
          .join('; ')}`;
      }
    }
    return {
      id: s.id,
      operacion: s.operation as OperacionAprobacion,
      entidadId: s.entityId,
      referencia: s.reference,
      projectId: s.projectId,
      reglaId: s.ruleId,
      importe: Number(s.amount),
      rolRequerido: s.requiredRole as RolAprobador,
      estado: s.status as EstadoSolicitudAprobacion,
      comentario: s.comment,
      solicitadaPor: s.requestedBy,
      solicitadaEn: s.requestedAt.toISOString(),
      decididaPor: s.decidedBy,
      decididaEn: s.decidedAt?.toISOString() ?? null,
      motivoDecision: s.decisionReason,
      puedoDecidir,
      version: s.version,
      nivelActual: s.currentLevel,
      totalNiveles: s.totalLevels,
      pasos: pasos.map((p) => this.pasoDto(p, c)),
      avisoSod,
    };
  }

  /** Quienes pueden decidir el paso (o su delegado), sin el solicitante ni quien ya firmó. */
  private async destinatarios(
    ex: DbOrTx,
    s: ApprovalRequest,
    paso: ApprovalStep,
    pasos: ApprovalStep[],
  ): Promise<string[]> {
    const excluir = [
      ...(s.requestedBy ? [s.requestedBy] : []),
      ...pasos
        .filter((p) => p.status === 'aprobado')
        .flatMap((p) =>
          [p.decidedBy, p.onBehalfOf].filter((x): x is string => Boolean(x)),
        ),
    ];
    return destinatariosPaso({
      paso: {
        rolRequerido: paso.requiredRole as RolAprobador,
        aprobadorId: paso.approverUserId,
      },
      usuarios: await this.grc.usuariosActivos(ex),
      delegaciones: await this.grc.delegacionesVigentes(ex),
      hoy: todayIso(),
      excluir,
    });
  }

  /** Avisa del paso activo solo a quien puede decidirlo. */
  private async avisarPaso(
    tx: Tx,
    s: ApprovalRequest,
    paso: ApprovalStep,
    pasos: ApprovalStep[],
    clave: string,
  ) {
    await this.notificaciones.notificar(tx, {
      companyId: s.companyId,
      tipo: 'aprobacion',
      titulo: `Aprobación pendiente (nivel ${paso.level}/${s.totalLevels}): ${s.reference}`,
      cuerpo: `${OPERACION_APROBACION_LABELS[s.operation as OperacionAprobacion]} por ${s.amount} € · decide ${
        paso.approverUserId
          ? 'el aprobador asignado'
          : `${ROL_APROBADOR_LABELS[paso.requiredRole as RolAprobador]} o superior`
      }`,
      enlace: '/aprobaciones',
      clave,
      destinatarios: await this.destinatarios(tx, s, paso, pasos),
    });
  }

  /* ───────────────────────────── reglas ───────────────────────────── */

  async listarReglas(operacion?: OperacionAprobacion, id?: string) {
    const filtros: SQL[] = [
      eq(approvalRules.companyId, this.dbs.getCompanyId()),
    ];
    if (operacion) filtros.push(eq(approvalRules.operation, operacion));
    if (id) filtros.push(eq(approvalRules.id, id));
    const filas = await this.dbs.db
      .select({ r: approvalRules, codigo: projects.code })
      .from(approvalRules)
      .leftJoin(projects, eq(projects.id, approvalRules.projectId))
      .where(and(...filtros))
      .orderBy(asc(approvalRules.operation), asc(approvalRules.minAmount));
    const ids = filas.map((f) => f.r.id);
    const niveles = ids.length
      ? await this.dbs.db
          .select({ n: approvalRuleLevels, nombre: users.fullName })
          .from(approvalRuleLevels)
          .leftJoin(users, eq(users.id, approvalRuleLevels.approverUserId))
          .where(inArray(approvalRuleLevels.ruleId, ids))
          .orderBy(asc(approvalRuleLevels.level))
      : [];
    return filas.map((f) =>
      reglaDto(
        f.r,
        f.codigo,
        niveles
          .filter((n) => n.n.ruleId === f.r.id)
          .map(({ n, nombre }) => ({
            nivel: n.level,
            importeMinimo: Number(n.minAmount),
            rolRequerido: n.requiredRole as RolAprobador,
            aprobadorId: n.approverUserId,
            aprobadorNombre: nombre,
            plazoHoras: n.slaHours,
          })),
      ),
    );
  }

  private async reglaPorId(id: string): Promise<ReglaAprobacionDto> {
    const [r] = await this.listarReglas(undefined, id);
    if (!r) throw reglaNoEncontrada();
    return r;
  }

  private tramoDuplicado(e: unknown): never {
    const pg = (e as { cause?: { code?: string }; code?: string }) ?? {};
    if ((pg.cause?.code ?? pg.code) === '23505') {
      throw new ConflictException({
        code: 'APPROVAL_RULE_DUPLICATE',
        message:
          'Ya hay una regla activa con ese umbral para la misma operación y alcance',
      });
    }
    throw e;
  }

  /** Valida y guarda la cadena de una regla (sustituye la anterior). */
  private async guardarNiveles(
    tx: Tx,
    regla: ApprovalRule,
    niveles: NonNullable<
      ReturnType<typeof reglaAprobacionCreateSchema.parse>['niveles']
    >,
  ) {
    const config: NivelConfigurado[] = niveles.map((n, i) => ({
      nivel: i + 1,
      importeMinimo: n.importeMinimo,
      rolRequerido: n.rolRequerido,
      aprobadorId: n.aprobadorId ?? null,
      plazoHoras: n.plazoHoras ?? null,
    }));
    reglaGrc(() => validarNiveles(config));
    const asignados = config
      .map((n) => n.aprobadorId)
      .filter((x): x is string => Boolean(x));
    if (asignados.length) {
      const validos = await tx
        .select({ id: users.id, rol: users.role })
        .from(users)
        .where(
          and(
            eq(users.companyId, regla.companyId),
            inArray(users.id, asignados),
            eq(users.isActive, true),
            isNull(users.deletedAt),
          ),
        );
      for (const n of config) {
        if (!n.aprobadorId) continue;
        const u = validos.find((v) => v.id === n.aprobadorId);
        const rangos: Record<string, number> = {
          administracion: 1,
          gerente: 2,
          admin: 3,
        };
        if (!u || (rangos[u.rol] ?? 0) < rangos[n.rolRequerido]) {
          throw new UnprocessableEntityException({
            code: 'APPROVAL_USER_INVALID',
            message: `El aprobador del nivel ${n.nivel} no existe, no está activo o no tiene rol ${n.rolRequerido}`,
          });
        }
      }
    }
    const antes = await this.nivelesDe(tx, regla.id);
    await tx
      .delete(approvalRuleLevels)
      .where(eq(approvalRuleLevels.ruleId, regla.id));
    if (config.length) {
      await tx.insert(approvalRuleLevels).values(
        config.map((n) => ({
          companyId: regla.companyId,
          ruleId: regla.id,
          level: n.nivel,
          minAmount: centsToNumeric(toCents(n.importeMinimo)),
          requiredRole: n.rolRequerido,
          approverUserId: n.aprobadorId ?? null,
          slaHours: n.plazoHoras ?? null,
        })),
      );
    }
    await this.audit.registrar(tx, {
      entityType: 'approval_rule',
      entityId: regla.id,
      action: 'update',
      oldData: { niveles: antes },
      newData: { niveles: config },
    });
  }

  async crearRegla(input: ReglaAprobacionCreateInput) {
    const d = reglaAprobacionCreateSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    const id = await this.dbs.db.transaction(async (tx) => {
      if (d.projectId) {
        const [p] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.id, d.projectId),
              eq(projects.companyId, companyId),
            ),
          );
        if (!p) {
          throw new UnprocessableEntityException({
            code: 'PROJECT_NOT_FOUND',
            message: 'La obra no existe',
          });
        }
      }
      const [r] = await tx
        .insert(approvalRules)
        .values({
          companyId,
          name: d.nombre,
          operation: d.operacion,
          minAmount: d.importeMinimo.toFixed(2),
          requiredRole: d.rolRequerido,
          projectId: d.projectId ?? null,
          isActive: d.activa,
          createdBy: getRequestContext()?.userId ?? null,
        })
        .returning()
        .catch((e: unknown) => this.tramoDuplicado(e));
      await this.audit.registrar(tx, {
        entityType: 'approval_rule',
        entityId: r.id,
        action: 'create',
        newData: r,
      });
      if (d.niveles?.length) await this.guardarNiveles(tx, r, d.niveles);
      return r.id;
    });
    return this.reglaPorId(id);
  }

  async actualizarRegla(
    id: string,
    input: ReglaAprobacionUpdateInput,
    versionEsperada: number | undefined,
  ) {
    const d = reglaAprobacionUpdateSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    await this.dbs.db.transaction(async (tx) => {
      const [r] = await tx
        .select()
        .from(approvalRules)
        .where(
          and(eq(approvalRules.id, id), eq(approvalRules.companyId, companyId)),
        )
        .for('update');
      if (!r) throw reglaNoEncontrada();
      verificarVersion(r.version, versionEsperada);
      const [nueva] = await tx
        .update(approvalRules)
        .set({
          ...(d.nombre !== undefined && { name: d.nombre }),
          ...(d.importeMinimo !== undefined && {
            minAmount: d.importeMinimo.toFixed(2),
          }),
          ...(d.rolRequerido !== undefined && { requiredRole: d.rolRequerido }),
          ...(d.activa !== undefined && { isActive: d.activa }),
          version: r.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(approvalRules.id, id))
        .returning()
        .catch((e: unknown) => this.tramoDuplicado(e));
      await this.audit.registrar(tx, {
        entityType: 'approval_rule',
        entityId: id,
        action: 'update',
        oldData: r,
        newData: nueva,
      });
      if (d.niveles !== undefined)
        await this.guardarNiveles(tx, nueva, d.niveles);
    });
    return this.reglaPorId(id);
  }

  /* ─────────────────────────── solicitudes ─────────────────────────── */

  async listarSolicitudes(q: SolicitudesQuery) {
    const filtros: (SQL | undefined)[] = [
      eq(approvalRequests.companyId, this.dbs.getCompanyId()),
    ];
    const obras = await this.dbs.getObrasAccesibles();
    if (obras !== null) {
      if (obras.length === 0) return [];
      filtros.push(inArray(approvalRequests.projectId, obras));
    }
    if (q.estado) filtros.push(eq(approvalRequests.status, q.estado));
    if (q.operacion) filtros.push(eq(approvalRequests.operation, q.operacion));
    if (q.entidadId) filtros.push(eq(approvalRequests.entityId, q.entidadId));
    if (q.paraMi) filtros.push(eq(approvalRequests.status, 'pendiente'));
    const filas = await this.dbs.db
      .select()
      .from(approvalRequests)
      .where(and(...filtros))
      .orderBy(desc(approvalRequests.requestedAt))
      .limit(500);
    const c = await this.contextoDecision(this.dbs.db, filas);
    const dtos = filas.map((s) => this.solicitudDto(s, c));
    return q.paraMi ? dtos.filter((s) => s.puedoDecidir) : dtos;
  }

  private async solicitudPorId(id: string): Promise<SolicitudAprobacionDto> {
    const [s] = await this.dbs.db
      .select()
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.id, id),
          eq(approvalRequests.companyId, this.dbs.getCompanyId()),
        ),
      );
    if (!s) throw solicitudNoEncontrada();
    return this.solicitudDto(s, await this.contextoDecision(this.dbs.db, [s]));
  }

  /** Estado de aprobación de un documento (para la web y el MCP). */
  async estado(
    operacion: OperacionAprobacion,
    entidadId: string,
  ): Promise<EstadoAprobacionDto> {
    const doc = await this.documento(this.dbs.db, operacion, entidadId);
    const [reglas, s] = await Promise.all([
      this.reglasActivas(this.dbs.db, operacion),
      this.ultimaSolicitud(this.dbs.db, operacion, entidadId),
    ]);
    const regla = this.reglaDe(reglas, doc);
    const exigido = regla
      ? await this.rolExigido(this.dbs.db, regla, doc.importe)
      : null;
    return {
      operacion,
      entidadId,
      referencia: doc.referencia,
      importe: Number(doc.importe),
      regla: regla ? await this.reglaPorId(regla.id) : null,
      solicitud: s
        ? this.solicitudDto(s, await this.contextoDecision(this.dbs.db, [s]))
        : null,
      evaluacion: this.evaluar(regla, exigido, s, doc),
    };
  }

  async solicitar(input: SolicitudAprobacionCreateInput) {
    const d = solicitudAprobacionCreateSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    const id = await this.dbs.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`aprobacion:${d.operacion}:${d.entidadId}`}))`,
      );
      const doc = await this.documento(tx, d.operacion, d.entidadId);
      const regla = this.reglaDe(
        await this.reglasActivas(tx, d.operacion),
        doc,
      );
      if (!regla) {
        throw new UnprocessableEntityException({
          code: 'APPROVAL_NOT_REQUIRED',
          message: `${doc.referencia} no alcanza ningún umbral de aprobación`,
        });
      }
      const niveles = nivelesAprobacion({
        rolRegla: regla.requiredRole as RolAprobador,
        niveles: await this.nivelesDe(tx, regla.id),
        importe: doc.importe,
      });
      const exigido = rolMaximo(niveles.map((n) => n.rolRequerido));
      const previa = await this.ultimaSolicitud(tx, d.operacion, d.entidadId);
      if (
        previa &&
        (previa.status === 'pendiente' || previa.status === 'aprobada')
      ) {
        const ev = this.evaluar(regla, exigido, previa, doc);
        if (previa.status === 'pendiente' || ev.errorCode === null) {
          throw new ConflictException({
            code: 'APPROVAL_ALREADY_REQUESTED',
            message: `${doc.referencia} ya tiene una aprobación ${previa.status}`,
            solicitudId: previa.id,
          });
        }
        // Aprobada pero ya no cubre (importe o nivel): se invalida y se pide otra.
        await this.transicionar(tx, previa, 'invalidada', {
          motivo:
            'Sustituida por una nueva solicitud: la aprobada ya no cubre el documento',
        });
      }
      const [s] = await tx
        .insert(approvalRequests)
        .values({
          companyId,
          operation: d.operacion,
          entityId: d.entidadId,
          reference: doc.referencia.slice(0, 80),
          projectId: doc.projectId,
          ruleId: regla.id,
          amount: centsToNumeric(toCents(doc.importe)),
          requiredRole: exigido,
          comment: d.comentario ?? null,
          requestedBy: getRequestContext()?.userId ?? null,
          currentLevel: 1,
          totalLevels: niveles.length,
        })
        .returning();
      const ahora = new Date();
      const pasos = await tx
        .insert(approvalSteps)
        .values(
          niveles.map((n) => ({
            companyId,
            requestId: s.id,
            level: n.nivel,
            requiredRole: n.rolRequerido,
            approverUserId: n.aprobadorId,
            status: (n.nivel === 1
              ? 'activo'
              : 'en_espera') as EstadoPasoAprobacion,
            activatedAt: n.nivel === 1 ? ahora : null,
            dueAt: n.nivel === 1 ? sumarHoras(ahora, n.plazoHoras) : null,
          })),
        )
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'approval_request',
        entityId: s.id,
        action: 'create',
        newData: { ...s, niveles },
      });
      // Bandeja in-app dirigida: solo quien puede decidir el primer nivel.
      await this.avisarPaso(
        tx,
        s,
        pasos[0],
        pasos,
        `aprobacion:solicitud:${s.id}`,
      );
      return s.id;
    });
    return this.solicitudPorId(id);
  }

  /** Avisa de la decisión a quien solicitó, a quien firmó y a los jefes de la obra. */
  private async avisarDecision(
    tx: Tx,
    s: ApprovalRequest,
    a: EstadoSolicitudAprobacion,
    motivo: string | null,
  ) {
    const pasos = await tx
      .select()
      .from(approvalSteps)
      .where(eq(approvalSteps.requestId, s.id));
    const jefes = s.projectId
      ? await tx
          .select({ id: users.id })
          .from(userProjectAccess)
          .innerJoin(users, eq(users.id, userProjectAccess.userId))
          .where(
            and(
              eq(userProjectAccess.projectId, s.projectId),
              eq(users.role, 'obra'),
              eq(users.isActive, true),
            ),
          )
      : [];
    const actor = getRequestContext()?.userId ?? null;
    const destinatarios = [
      s.requestedBy,
      ...pasos.flatMap((p) => [p.decidedBy, p.onBehalfOf]),
      ...jefes.map((j) => j.id),
    ].filter((x): x is string => Boolean(x) && x !== actor);
    await this.notificaciones.notificar(tx, {
      companyId: s.companyId,
      tipo: 'aprobacion',
      titulo: `Aprobación ${ESTADO_SOLICITUD_LABELS[a].toLowerCase()}: ${s.reference}`,
      cuerpo: `${OPERACION_APROBACION_LABELS[s.operation as OperacionAprobacion]} por ${s.amount} €${motivo ? ` · ${motivo}` : ''}`,
      enlace: '/aprobaciones',
      clave: `aprobacion:${a}:${s.id}`,
      destinatarios,
    });
  }

  /** Cambio de estado auditado de una solicitud ya bloqueada; cancela los pasos vivos al caer. */
  private async transicionar(
    tx: Tx,
    s: ApprovalRequest,
    a: EstadoSolicitudAprobacion,
    p: { motivo?: string | null; version?: number },
  ): Promise<ApprovalRequest> {
    const nueva = await cambiarEstado(
      tx,
      approvalRequests,
      'approval_request',
      s.id,
      s.status as EstadoSolicitudAprobacion,
      a,
      {
        decidedBy: getRequestContext()?.userId ?? null,
        decidedAt: new Date(),
        decisionReason: p.motivo ?? null,
      },
      p.version,
    );
    if (a === 'rechazada' || a === 'invalidada' || a === 'anulada') {
      for (const de of ['activo', 'en_espera'] as const) {
        await cambiarEstadoMasivo(
          tx,
          approvalSteps,
          'approval_step',
          and(eq(approvalSteps.requestId, s.id), eq(approvalSteps.status, de))!,
          de,
          'cancelado',
        );
      }
    }
    await this.audit.registrar(tx, {
      entityType: 'approval_request',
      entityId: s.id,
      action: 'update',
      oldData: { status: s.status },
      newData: {
        status: a,
        motivo: p.motivo ?? null,
        operacion: s.operation,
        entidadId: s.entityId,
        importe: Number(s.amount),
      },
    });
    if (a !== 'anulada') await this.avisarDecision(tx, s, a, p.motivo ?? null);
    return nueva as ApprovalRequest;
  }

  private async bloquearSolicitud(tx: Tx, id: string) {
    const [s] = await tx
      .select()
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.id, id),
          eq(approvalRequests.companyId, this.dbs.getCompanyId()),
        ),
      )
      .for('update');
    if (!s) throw solicitudNoEncontrada();
    return s;
  }

  /**
   * Paso activo y decisión del usuario (rol, asignación, delegación y SoD).
   * Un conflicto que bloquea se audita aparte y lanza RFC 7807; quien
   * solicitó sigue recibiendo `SELF_APPROVAL_FORBIDDEN`.
   */
  private async exigirDecisor(
    tx: Tx,
    s: ApprovalRequest,
    justificacion: string | null | undefined,
    paraRechazar = false,
  ): Promise<{
    activo: ApprovalStep;
    pasos: ApprovalStep[];
    d: DecisionPaso;
    c: ContextoDecision;
  }> {
    const pasos = await tx
      .select()
      .from(approvalSteps)
      .where(eq(approvalSteps.requestId, s.id))
      .orderBy(asc(approvalSteps.level))
      .for('update');
    const activo = pasos.find((p) => p.status === 'activo');
    if (s.status !== 'pendiente' || !activo) {
      throw new ConflictException({
        code: 'APPROVAL_STEP_NOT_ACTIVE',
        message: `La solicitud está ${s.status}: no hay nivel pendiente de decidir`,
      });
    }
    const c = await this.contextoDecision(tx, [s]);
    c.pasos.set(s.id, pasos);
    const d = this.decision(s, activo, pasos, c, justificacion);
    if (
      d.impedimento === 'APPROVAL_ROLE_INSUFFICIENT' ||
      d.impedimento === 'APPROVAL_NOT_ASSIGNEE'
    ) {
      throw new ForbiddenException({
        code: d.impedimento,
        message:
          d.impedimento === 'APPROVAL_NOT_ASSIGNEE'
            ? `El nivel ${activo.level} está asignado a otro aprobador`
            : `Esta aprobación requiere nivel ${activo.requiredRole} o superior`,
      });
    }
    // Rechazar es conservador: solo lo impide ser quien solicitó.
    const bloquea =
      d.impedimento !== null &&
      (!paraRechazar ||
        d.sod.conflictos.some((x) => x.conflicto === 'solicitante_aprueba'));
    if (bloquea) {
      const autoaprobacion = d.sod.conflictos.some(
        (x) => x.conflicto === 'solicitante_aprueba',
      );
      await this.grc.bloquear(
        {
          operacion: s.operation,
          entidadId: s.entityId,
          referencia: s.reference,
        },
        d.sod,
        autoaprobacion ? 'SELF_APPROVAL_FORBIDDEN' : undefined,
      );
    }
    return { activo, pasos, d, c };
  }

  async aprobar(id: string, input: DecisionAprobarInput, version?: number) {
    const d = decisionAprobarSchema.parse(input);
    await this.dbs.db.transaction(async (tx) => {
      const s = await this.bloquearSolicitud(tx, id);
      verificarVersion(s.version, version);
      const {
        activo,
        pasos,
        d: dec,
      } = await this.exigirDecisor(tx, s, d.justificacionSod);
      // El documento no puede haber subido desde que se pidió.
      const doc = await this.documento(
        tx,
        s.operation as OperacionAprobacion,
        s.entityId,
      );
      if (exigeReaprobacion(s.amount, doc.importe)) {
        throw new ConflictException({
          code: 'APPROVAL_STALE',
          message: `${doc.referencia} ha subido de ${s.amount} € a ${doc.importe} € desde la solicitud: debe solicitarse de nuevo`,
        });
      }
      const userId = getRequestContext()?.userId ?? null;
      await cambiarEstado(
        tx,
        approvalSteps,
        'approval_step',
        activo.id,
        'activo',
        'aprobado',
        {
          decidedBy: userId,
          onBehalfOf: dec.enNombreDe,
          decidedAt: new Date(),
          comment: d.comentario ?? null,
        },
      );
      await this.audit.registrar(tx, {
        entityType: 'approval_step',
        entityId: activo.id,
        action: 'update',
        oldData: { status: 'activo', decidedBy: null },
        newData: {
          status: 'aprobado',
          decidedBy: userId,
          onBehalfOf: dec.enNombreDe,
          nivel: activo.level,
          comentario: d.comentario ?? null,
        },
      });
      await this.grc.registrarExcepciones(
        tx,
        {
          operacion: s.operation,
          entidadId: s.entityId,
          referencia: s.reference,
        },
        dec.sod,
        dec.enNombreDe,
      );
      const siguiente = pasos.find((p) => p.level === activo.level + 1);
      if (siguiente) {
        const ahora = new Date();
        const [config] = s.ruleId
          ? await tx
              .select({ sla: approvalRuleLevels.slaHours })
              .from(approvalRuleLevels)
              .where(
                and(
                  eq(approvalRuleLevels.ruleId, s.ruleId),
                  eq(approvalRuleLevels.level, siguiente.level),
                ),
              )
          : [];
        const activado = await cambiarEstado(
          tx,
          approvalSteps,
          'approval_step',
          siguiente.id,
          'en_espera',
          'activo',
          {
            activatedAt: ahora,
            dueAt: sumarHoras(ahora, config?.sla ?? null),
          },
        );
        const [act] = await tx
          .update(approvalRequests)
          .set({
            currentLevel: siguiente.level,
            version: s.version + 1,
            updatedAt: ahora,
          })
          .where(eq(approvalRequests.id, s.id))
          .returning();
        await this.audit.registrar(tx, {
          entityType: 'approval_request',
          entityId: s.id,
          action: 'update',
          oldData: { nivelActual: s.currentLevel },
          newData: { nivelActual: siguiente.level },
        });
        const pasosAhora = pasos.map((p) =>
          p.id === activo.id
            ? {
                ...p,
                status: 'aprobado' as const,
                decidedBy: userId,
                onBehalfOf: dec.enNombreDe,
              }
            : p,
        );
        await this.avisarPaso(
          tx,
          act,
          activado as ApprovalStep,
          pasosAhora,
          `aprobacion:nivel:${s.id}:${siguiente.level}`,
        );
      } else {
        await this.transicionar(tx, s, 'aprobada', {
          motivo: d.comentario ?? null,
          version,
        });
      }
    });
    return this.solicitudPorId(id);
  }

  async rechazar(id: string, input: DecisionMotivoInput, version?: number) {
    const d = decisionMotivoSchema.parse(input);
    await this.dbs.db.transaction(async (tx) => {
      const s = await this.bloquearSolicitud(tx, id);
      verificarVersion(s.version, version);
      const { activo, d: dec } = await this.exigirDecisor(tx, s, null, true);
      const userId = getRequestContext()?.userId ?? null;
      await cambiarEstado(
        tx,
        approvalSteps,
        'approval_step',
        activo.id,
        'activo',
        'rechazado',
        {
          decidedBy: userId,
          onBehalfOf: dec.enNombreDe,
          decidedAt: new Date(),
          comment: d.motivo,
        },
      );
      await this.audit.registrar(tx, {
        entityType: 'approval_step',
        entityId: activo.id,
        action: 'update',
        oldData: { status: 'activo' },
        newData: {
          status: 'rechazado',
          decidedBy: userId,
          onBehalfOf: dec.enNombreDe,
          nivel: activo.level,
          motivo: d.motivo,
        },
      });
      await this.transicionar(tx, s, 'rechazada', {
        motivo: d.motivo,
        version,
      });
    });
    return this.solicitudPorId(id);
  }

  /** Retirar una solicitud pendiente: quien la pidió o un admin. */
  async anular(id: string, input: DecisionMotivoInput, version?: number) {
    const d = decisionMotivoSchema.parse(input);
    await this.dbs.db.transaction(async (tx) => {
      const s = await this.bloquearSolicitud(tx, id);
      verificarVersion(s.version, version);
      const ctx = getRequestContext();
      if (ctx?.role !== 'admin' && ctx?.userId !== s.requestedBy) {
        throw new ForbiddenException({
          code: 'PERMISSION_DENIED',
          message: 'Solo quien la solicitó o un administrador puede anularla',
        });
      }
      await this.transicionar(tx, s, 'anulada', { motivo: d.motivo, version });
    });
    return this.solicitudPorId(id);
  }

  /**
   * Reasigna el paso activo a otro aprobador (admin o gerente): debe estar
   * activo, tener el rol del paso y no ser quien solicitó.
   */
  async reasignar(id: string, input: ReasignarPasoInput, version?: number) {
    const d = reasignarPasoSchema.parse(input);
    await this.dbs.db.transaction(async (tx) => {
      const s = await this.bloquearSolicitud(tx, id);
      verificarVersion(s.version, version);
      const pasos = await tx
        .select()
        .from(approvalSteps)
        .where(eq(approvalSteps.requestId, s.id))
        .for('update');
      const activo = pasos.find((p) => p.status === 'activo');
      if (s.status !== 'pendiente' || !activo) {
        throw new ConflictException({
          code: 'APPROVAL_STEP_NOT_ACTIVE',
          message: 'No hay nivel pendiente que reasignar',
        });
      }
      const [u] = await tx
        .select({ id: users.id, rol: users.role })
        .from(users)
        .where(
          and(
            eq(users.id, d.aprobadorId),
            eq(users.companyId, s.companyId),
            eq(users.isActive, true),
            isNull(users.deletedAt),
          ),
        );
      const rangos: Record<string, number> = {
        administracion: 1,
        gerente: 2,
        admin: 3,
      };
      if (
        !u ||
        (rangos[u.rol] ?? 0) < rangos[activo.requiredRole] ||
        u.id === s.requestedBy
      ) {
        throw new UnprocessableEntityException({
          code: 'APPROVAL_USER_INVALID',
          message:
            'El nuevo aprobador debe estar activo, tener el rol del nivel y no ser quien solicitó',
        });
      }
      const [paso] = await tx
        .update(approvalSteps)
        .set({
          approverUserId: u.id,
          version: activo.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(approvalSteps.id, activo.id))
        .returning();
      const [act] = await tx
        .update(approvalRequests)
        .set({ version: s.version + 1, updatedAt: new Date() })
        .where(eq(approvalRequests.id, s.id))
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'approval_step',
        entityId: activo.id,
        action: 'update',
        oldData: { aprobadorId: activo.approverUserId },
        newData: { aprobadorId: u.id, motivo: d.motivo },
      });
      await this.avisarPaso(
        tx,
        act,
        paso,
        pasos,
        `aprobacion:reasignada:${activo.id}:${paso.version}`,
      );
    });
    return this.solicitudPorId(id);
  }

  /**
   * Escalado de los pasos activos vencidos (plazo del nivel superado): pasan
   * al rol inmediatamente superior, sin aprobador asignado, y se avisa a los
   * nuevos destinatarios. `referencia` es el instante de evaluación (por
   * defecto, ahora).
   */
  async escalarVencidos(
    referencia?: string,
  ): Promise<SolicitudAprobacionDto[]> {
    const ahora = referencia ? new Date(referencia) : new Date();
    const companyId = this.dbs.getCompanyId();
    const ids = await this.dbs.db.transaction(async (tx) => {
      const vencidos = await tx
        .select()
        .from(approvalSteps)
        .where(
          and(
            eq(approvalSteps.companyId, companyId),
            eq(approvalSteps.status, 'activo'),
            eq(approvalSteps.escalated, false),
            lt(approvalSteps.dueAt, ahora),
          ),
        )
        .for('update');
      const tocadas: string[] = [];
      for (const p of vencidos) {
        const s = await this.bloquearSolicitud(tx, p.requestId);
        const nuevoRol =
          escalarRol(p.requiredRole as RolAprobador) ??
          (p.requiredRole as RolAprobador);
        const plazo =
          p.activatedAt && p.dueAt
            ? p.dueAt.getTime() - p.activatedAt.getTime()
            : 0;
        const [paso] = await tx
          .update(approvalSteps)
          .set({
            requiredRole: nuevoRol,
            approverUserId: null,
            escalated: true,
            dueAt: plazo > 0 ? new Date(ahora.getTime() + plazo) : null,
            version: p.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(approvalSteps.id, p.id))
          .returning();
        const exigido = rolMaximo([s.requiredRole as RolAprobador, nuevoRol]);
        const [act] = await tx
          .update(approvalRequests)
          .set({
            requiredRole: exigido,
            version: s.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(approvalRequests.id, s.id))
          .returning();
        await this.audit.registrar(tx, {
          entityType: 'approval_step',
          entityId: p.id,
          action: 'update',
          oldData: {
            rolRequerido: p.requiredRole,
            aprobadorId: p.approverUserId,
            venceEl: p.dueAt?.toISOString() ?? null,
          },
          newData: {
            rolRequerido: nuevoRol,
            aprobadorId: null,
            escalado: true,
            venceEl: paso.dueAt?.toISOString() ?? null,
          },
        });
        const pasos = await tx
          .select()
          .from(approvalSteps)
          .where(eq(approvalSteps.requestId, s.id));
        await this.avisarPaso(
          tx,
          act,
          paso,
          pasos,
          `aprobacion:escalada:${p.id}`,
        );
        tocadas.push(s.id);
      }
      return tocadas;
    });
    return Promise.all(ids.map((i) => this.solicitudPorId(i)));
  }

  /* ─────────────────────── puerta e invalidación ─────────────────────── */

  /**
   * Puerta de aprobación: si el documento alcanza un umbral y su última
   * solicitud no lo cubre, audita el bloqueo (en una transacción aparte: la
   * del llamador se deshará) y lanza 409 `APPROVAL_REQUIRED` /
   * `APPROVAL_PENDING` / `APPROVAL_REJECTED`. Debe llamarse antes de que la
   * operación escriba en `audit_log`.
   */
  async exigir(
    ex: DbOrTx,
    operacion: OperacionAprobacion,
    entidadId: string,
  ): Promise<void> {
    const reglas = await this.reglasActivas(ex, operacion);
    if (reglas.length === 0) return;
    const doc = await this.documento(ex, operacion, entidadId);
    const regla = this.reglaDe(reglas, doc);
    if (!regla) return;
    const exigido = await this.rolExigido(ex, regla, doc.importe);
    const s = await this.ultimaSolicitud(ex, operacion, entidadId);
    const ev = this.evaluar(regla, exigido, s, doc);
    if (!ev.errorCode) return;
    const companyId = this.dbs.getCompanyId();
    await this.dbs.db.transaction((trx) =>
      this.audit.registrar(
        trx,
        {
          entityType: 'approval_gate',
          entityId: entidadId,
          action: 'create',
          newData: {
            evento: 'bloqueo',
            operacion,
            referencia: doc.referencia,
            errorCode: ev.errorCode,
            importe: Number(doc.importe),
            rolRequerido: exigido,
            solicitudId: s?.id ?? null,
            nivelActual: s?.currentLevel ?? null,
            totalNiveles: s?.totalLevels ?? null,
          },
        },
        { companyId },
      ),
    );
    throw errorPuerta(ev, doc, exigido, s?.id ?? null);
  }

  /**
   * Tras editar un documento: si su solicitud viva (pendiente o aprobada) ya
   * no cubre el nuevo importe —o `forzar` porque cambió algo relevante, como
   * el proveedor—, pasa a `invalidada` con motivo, de forma auditada.
   */
  async invalidarSiProcede(
    tx: Tx,
    p: {
      operacion: OperacionAprobacion;
      entidadId: string;
      importeNuevo: string | number;
      motivo: string;
      forzar?: boolean;
    },
  ): Promise<boolean> {
    const [s] = await tx
      .select()
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.companyId, this.dbs.getCompanyId()),
          eq(approvalRequests.operation, p.operacion),
          eq(approvalRequests.entityId, p.entidadId),
          or(
            eq(approvalRequests.status, 'pendiente'),
            eq(approvalRequests.status, 'aprobada'),
          ),
        ),
      )
      .for('update');
    if (!s) return false;
    if (!p.forzar && !exigeReaprobacion(s.amount, p.importeNuevo)) return false;
    await this.transicionar(tx, s, 'invalidada', {
      motivo: `${p.motivo} (aprobado ${s.amount} €, ahora ${centsToNumeric(toCents(p.importeNuevo))} €)`,
    });
    return true;
  }
}
