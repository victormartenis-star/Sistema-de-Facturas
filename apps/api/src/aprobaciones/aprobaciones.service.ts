import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, or, sql, SQL } from 'drizzle-orm';
import {
  approvalRequests,
  approvalRules,
  certificacionesSubcontrata,
  contratosSubcontrata,
  invoiceLines,
  invoices,
  projects,
  purchaseOrders,
  type ApprovalRequest,
  type ApprovalRule,
  type DbOrTx,
  type Tx,
} from '@erp/db';
import {
  centsToNumeric,
  decisionAprobarSchema,
  decisionMotivoSchema,
  evaluarAprobacion,
  exigeReaprobacion,
  impedimentoAprobador,
  reglaAplicable,
  reglaAprobacionCreateSchema,
  reglaAprobacionUpdateSchema,
  solicitudAprobacionCreateSchema,
  toCents,
  type DecisionAprobarInput,
  type DecisionMotivoInput,
  type EstadoAprobacionDto,
  type EstadoSolicitudAprobacion,
  type EvaluacionAprobacion,
  type OperacionAprobacion,
  type ReglaAprobacionCreateInput,
  type ReglaAprobacionDto,
  type ReglaAprobacionUpdateInput,
  type RolAprobador,
  type SolicitudAprobacionCreateInput,
  type SolicitudAprobacionDto,
  type SolicitudesQuery,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { cambiarEstado } from '../common/cambiar-estado';
import { getRequestContext } from '../common/request-context';
import { verificarVersion } from '../common/version';
import { DbService } from '../db/db.service';

/** Documento sujeto a aprobación, ya resuelto. */
interface Documento {
  operacion: OperacionAprobacion;
  id: string;
  referencia: string;
  /** Importe que se compara con los umbrales. */
  importe: string;
  projectId: string | null;
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

function reglaDto(r: ApprovalRule, codigo: string | null): ReglaAprobacionDto {
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

/**
 * Flujos de aprobación por umbral (SAP Release Strategy / Oracle Approvals).
 *
 * - Reglas por empresa, operación y obra (opcional) con importe mínimo y nivel.
 * - Solicitudes con snapshot del documento; una sola viva por documento.
 * - Segregación de funciones: quien solicita no decide.
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
    s: ApprovalRequest | undefined,
    doc: Documento,
  ): EvaluacionAprobacion {
    return evaluarAprobacion({
      regla: regla
        ? {
            rolRequerido: regla.requiredRole as RolAprobador,
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

  private solicitudDto(s: ApprovalRequest): SolicitudAprobacionDto {
    const ctx = getRequestContext();
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
      puedoDecidir:
        s.status === 'pendiente' &&
        ctx !== undefined &&
        impedimentoAprobador({
          aprobadorId: ctx.userId,
          solicitanteId: s.requestedBy,
          rolAprobador: ctx.role,
          rolRequerido: s.requiredRole as RolAprobador,
        }) === null,
      version: s.version,
    };
  }

  /* ───────────────────────────── reglas ───────────────────────────── */

  async listarReglas(operacion?: OperacionAprobacion) {
    const filtros: SQL[] = [
      eq(approvalRules.companyId, this.dbs.getCompanyId()),
    ];
    if (operacion) filtros.push(eq(approvalRules.operation, operacion));
    const filas = await this.dbs.db
      .select({ r: approvalRules, codigo: projects.code })
      .from(approvalRules)
      .leftJoin(projects, eq(projects.id, approvalRules.projectId))
      .where(and(...filtros))
      .orderBy(asc(approvalRules.operation), asc(approvalRules.minAmount));
    return filas.map((f) => reglaDto(f.r, f.codigo));
  }

  private async reglaPorId(id: string): Promise<ReglaAprobacionDto> {
    const r = (await this.listarReglas()).find((x) => x.id === id);
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
    const dtos = filas.map((s) => this.solicitudDto(s));
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
    return this.solicitudDto(s);
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
    return {
      operacion,
      entidadId,
      referencia: doc.referencia,
      importe: Number(doc.importe),
      regla: regla ? reglaDto(regla, null) : null,
      solicitud: s ? this.solicitudDto(s) : null,
      evaluacion: this.evaluar(regla, s, doc),
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
      const previa = await this.ultimaSolicitud(tx, d.operacion, d.entidadId);
      if (
        previa &&
        (previa.status === 'pendiente' || previa.status === 'aprobada')
      ) {
        const ev = this.evaluar(regla, previa, doc);
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
          requiredRole: regla.requiredRole,
          comment: d.comentario ?? null,
          requestedBy: getRequestContext()?.userId ?? null,
        })
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'approval_request',
        entityId: s.id,
        action: 'create',
        newData: s,
      });
      return s.id;
    });
    return this.solicitudPorId(id);
  }

  /** Cambio de estado auditado de una solicitud ya bloqueada. */
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

  private exigirDecisor(s: ApprovalRequest): void {
    const ctx = getRequestContext();
    const impedimento = impedimentoAprobador({
      aprobadorId: ctx?.userId ?? '',
      solicitanteId: s.requestedBy,
      rolAprobador: ctx?.role ?? '',
      rolRequerido: s.requiredRole as RolAprobador,
    });
    if (impedimento === 'SELF_APPROVAL_FORBIDDEN') {
      throw new ForbiddenException({
        code: impedimento,
        message:
          'Quien solicita la aprobación no puede decidirla (segregación de funciones)',
      });
    }
    if (impedimento) {
      throw new ForbiddenException({
        code: impedimento,
        message: `Esta aprobación requiere nivel ${s.requiredRole} o superior`,
      });
    }
  }

  async aprobar(id: string, input: DecisionAprobarInput, version?: number) {
    const d = decisionAprobarSchema.parse(input);
    await this.dbs.db.transaction(async (tx) => {
      const s = await this.bloquearSolicitud(tx, id);
      verificarVersion(s.version, version);
      this.exigirDecisor(s);
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
      await this.transicionar(tx, s, 'aprobada', {
        motivo: d.comentario ?? null,
        version,
      });
    });
    return this.solicitudPorId(id);
  }

  async rechazar(id: string, input: DecisionMotivoInput, version?: number) {
    const d = decisionMotivoSchema.parse(input);
    await this.dbs.db.transaction(async (tx) => {
      const s = await this.bloquearSolicitud(tx, id);
      verificarVersion(s.version, version);
      this.exigirDecisor(s);
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
    const s = await this.ultimaSolicitud(ex, operacion, entidadId);
    const ev = this.evaluar(regla, s, doc);
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
            rolRequerido: regla.requiredRole,
            solicitudId: s?.id ?? null,
          },
        },
        { companyId },
      ),
    );
    throw errorPuerta(
      ev,
      doc,
      regla.requiredRole as RolAprobador,
      s?.id ?? null,
    );
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
