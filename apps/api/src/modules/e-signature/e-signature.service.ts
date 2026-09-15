import { createHash } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import {
  SignatureRequest,
  SignatureSigner,
  signatureRequests,
  signatureSigners,
} from '@erp/db';
import {
  SignatureRequestCreateInput,
  SignatureRequestDto,
  SignerFirmarInput,
  SignerRechazarInput,
  isRequestComplete,
  nextRequestEstado,
  signatureRequestCreateSchema,
  signerFirmarSchema,
  signerRechazarSchema,
} from '@erp/shared';
import { AuditService } from '../../audit/audit.service';
import { DbService } from '../../db/db.service';

function toDto(
  row: SignatureRequest,
  firmantes: SignatureSigner[],
): SignatureRequestDto {
  return {
    id: row.id,
    projectId: row.projectId,
    entityTipo: row.entityTipo,
    entityId: row.entityId,
    titulo: row.titulo,
    documentId: row.documentId,
    estado: row.estado,
    fechaLimite: row.fechaLimite,
    completedAt: row.completedAt?.toISOString() ?? null,
    firmantes: firmantes
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((f) => ({
        id: f.id,
        nombre: f.nombre,
        email: f.email,
        rol: f.rol,
        estado: f.estado,
        firmadoAt: f.firmadoAt?.toISOString() ?? null,
        motivoRechazo: f.motivoRechazo,
      })),
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class ESignatureService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(filter: {
    projectId?: string;
    entityTipo?: string;
    estado?: string;
  }): Promise<SignatureRequestDto[]> {
    const companyId = await this.dbs.getCompanyId();
    const conditions = [
      eq(signatureRequests.companyId, companyId),
      isNull(signatureRequests.deletedAt),
    ];
    if (filter.projectId)
      conditions.push(eq(signatureRequests.projectId, filter.projectId));
    if (filter.entityTipo)
      conditions.push(
        eq(
          signatureRequests.entityTipo,
          filter.entityTipo as SignatureRequest['entityTipo'],
        ),
      );
    if (filter.estado)
      conditions.push(
        eq(
          signatureRequests.estado,
          filter.estado as SignatureRequest['estado'],
        ),
      );

    const rows = await this.dbs.db
      .select()
      .from(signatureRequests)
      .where(and(...conditions))
      .orderBy(desc(signatureRequests.createdAt));
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  async get(id: string): Promise<SignatureRequestDto> {
    const row = await this.find(id);
    return this.hydrate(row);
  }

  async create(
    input: SignatureRequestCreateInput,
  ): Promise<SignatureRequestDto> {
    const companyId = await this.dbs.getCompanyId();
    const ctx = this.dbs.getContext();
    const data = signatureRequestCreateSchema.parse(input);

    const { row, firmantes } = await this.dbs.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(signatureRequests)
        .values({
          companyId,
          projectId: data.projectId ?? null,
          entityTipo: data.entityTipo,
          entityId: data.entityId,
          titulo: data.titulo,
          documentId: data.documentId ?? null,
          createdByUserId: ctx.userId,
          fechaLimite: data.fechaLimite ?? null,
        })
        .returning();

      const insertedFirmantes = await tx
        .insert(signatureSigners)
        .values(
          data.firmantes.map((f, i) => ({
            signatureRequestId: inserted.id,
            nombre: f.nombre,
            email: f.email ?? null,
            rol: f.rol ?? null,
            sortOrder: i,
          })),
        )
        .returning();
      return { row: inserted, firmantes: insertedFirmantes };
    });

    void this.audit.log({
      entityType: 'signature_request',
      entityId: row.id,
      action: 'create',
      newData: { ...row, firmantes: data.firmantes },
    });
    return toDto(row, firmantes);
  }

  /** Firma remota de un firmante: guarda solo el hash de los datos de firma recibidos. */
  async firmar(
    requestId: string,
    signerId: string,
    input: SignerFirmarInput,
    ip: string | null,
  ): Promise<SignatureRequestDto> {
    const row = await this.find(requestId);
    if (row.estado !== 'pendiente') {
      throw new ConflictException(
        'Esta solicitud de firma ya no admite más firmas',
      );
    }
    const data = signerFirmarSchema.parse(input);
    const signer = await this.findSigner(requestId, signerId);
    if (signer.estado !== 'pendiente') {
      throw new ConflictException('Este firmante ya ha firmado o rechazado');
    }
    const hashFirma = createHash('sha256').update(data.firmaData).digest('hex');

    const [updatedRow, firmantes] = await this.dbs.db.transaction(
      async (tx) => {
        await tx
          .update(signatureSigners)
          .set({
            estado: 'firmado',
            firmadoAt: new Date(),
            ipFirma: ip,
            hashFirma,
          })
          .where(eq(signatureSigners.id, signerId));

        const all = await tx
          .select()
          .from(signatureSigners)
          .where(eq(signatureSigners.signatureRequestId, requestId));

        const nuevoEstado = nextRequestEstado(all, row.estado);
        const [updated] = await tx
          .update(signatureRequests)
          .set({
            estado: nuevoEstado,
            ...(nuevoEstado === 'completada' && { completedAt: new Date() }),
            updatedAt: new Date(),
          })
          .where(eq(signatureRequests.id, requestId))
          .returning();
        return [updated, all] as const;
      },
    );

    void this.audit.log({
      entityType: 'signature_signer',
      entityId: signerId,
      action: 'update',
      newData: { estado: 'firmado', hashFirma },
    });
    if (isRequestComplete(firmantes)) {
      void this.audit.log({
        entityType: 'signature_request',
        entityId: requestId,
        action: 'update',
        newData: { estado: 'completada' },
      });
    }
    return toDto(updatedRow, firmantes);
  }

  async rechazar(
    requestId: string,
    signerId: string,
    input: SignerRechazarInput,
  ): Promise<SignatureRequestDto> {
    const row = await this.find(requestId);
    if (row.estado !== 'pendiente') {
      throw new ConflictException(
        'Esta solicitud de firma ya no admite cambios',
      );
    }
    const data = signerRechazarSchema.parse(input);
    const signer = await this.findSigner(requestId, signerId);
    if (signer.estado !== 'pendiente') {
      throw new ConflictException('Este firmante ya ha firmado o rechazado');
    }

    const [updatedRow, firmantes] = await this.dbs.db.transaction(
      async (tx) => {
        await tx
          .update(signatureSigners)
          .set({ estado: 'rechazado', motivoRechazo: data.motivo })
          .where(eq(signatureSigners.id, signerId));

        const all = await tx
          .select()
          .from(signatureSigners)
          .where(eq(signatureSigners.signatureRequestId, requestId));

        const nuevoEstado = nextRequestEstado(all, row.estado);
        const [updated] = await tx
          .update(signatureRequests)
          .set({ estado: nuevoEstado, updatedAt: new Date() })
          .where(eq(signatureRequests.id, requestId))
          .returning();
        return [updated, all] as const;
      },
    );

    void this.audit.log({
      entityType: 'signature_signer',
      entityId: signerId,
      action: 'update',
      newData: { estado: 'rechazado', motivo: data.motivo },
    });
    return toDto(updatedRow, firmantes);
  }

  async cancelar(id: string): Promise<SignatureRequestDto> {
    const row = await this.find(id);
    if (row.estado !== 'pendiente') {
      throw new ConflictException('Esta solicitud ya está cerrada');
    }
    const [updated] = await this.dbs.db
      .update(signatureRequests)
      .set({ estado: 'cancelada', updatedAt: new Date() })
      .where(eq(signatureRequests.id, id))
      .returning();
    return this.hydrate(updated);
  }

  /* ────────────────────── privados ────────────────────── */

  private async hydrate(row: SignatureRequest): Promise<SignatureRequestDto> {
    const firmantes = await this.dbs.db
      .select()
      .from(signatureSigners)
      .where(eq(signatureSigners.signatureRequestId, row.id))
      .orderBy(asc(signatureSigners.sortOrder));
    return toDto(row, firmantes);
  }

  private async find(id: string): Promise<SignatureRequest> {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select()
      .from(signatureRequests)
      .where(
        and(
          eq(signatureRequests.id, id),
          eq(signatureRequests.companyId, companyId),
          isNull(signatureRequests.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Solicitud de firma no encontrada');
    return row;
  }

  private async findSigner(
    requestId: string,
    signerId: string,
  ): Promise<SignatureSigner> {
    const [row] = await this.dbs.db
      .select()
      .from(signatureSigners)
      .where(
        and(
          eq(signatureSigners.id, signerId),
          eq(signatureSigners.signatureRequestId, requestId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Firmante no encontrado');
    return row;
  }
}
