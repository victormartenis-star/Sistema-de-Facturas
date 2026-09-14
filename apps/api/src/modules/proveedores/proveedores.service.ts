import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, isNull, SQL } from 'drizzle-orm';
import {
  ContratoSubcontrata,
  DocumentoPRL,
  Proveedor,
  contratosSubcontrata,
  documentosPRL,
  proveedores,
} from '@erp/db';
import {
  ContratoSubcontrataCreateInput,
  ContratoSubcontrataUpdateInput,
  DocumentoPRLUploadInput,
  ProveedorCreateInput,
  ProveedorUpdateInput,
  computeDocumentoPRLStatus,
  todayIso,
  validarAptoParaPago as validarAptoParaPagoPuro,
} from '@erp/shared';
import { DbService } from '../../db/db.service';

@Injectable()
export class ProveedoresService {
  constructor(private readonly dbs: DbService) {}

  private get db() {
    return this.dbs.db;
  }

  private async getCompanyId(): Promise<string> {
    return this.dbs.getCompanyId();
  }

  /** Lista proveedores con filtro opcional por activo/inactivo. */
  async list(activo?: boolean): Promise<Proveedor[]> {
    const companyId = await this.getCompanyId();
    const filters: SQL[] = [
      eq(proveedores.companyId, companyId),
      isNull(proveedores.deletedAt),
    ];
    if (activo !== undefined) {
      filters.push(eq(proveedores.activo, activo));
    }

    return this.db
      .select()
      .from(proveedores)
      .where(and(...filters))
      .orderBy(asc(proveedores.razonSocial));
  }

  /** Obtiene un proveedor por ID. */
  async get(id: string): Promise<Proveedor> {
    const companyId = await this.getCompanyId();
    const [row] = await this.db
      .select()
      .from(proveedores)
      .where(
        and(
          eq(proveedores.id, id),
          eq(proveedores.companyId, companyId),
          isNull(proveedores.deletedAt),
        ),
      )
      .limit(1);
    if (!row) {
      throw new NotFoundException('Proveedor no encontrado');
    }
    return row;
  }

  /** Crea un nuevo proveedor/subcontrata. */
  async create(body: ProveedorCreateInput): Promise<Proveedor> {
    const companyId = await this.getCompanyId();

    const [existing] = await this.db
      .select()
      .from(proveedores)
      .where(
        and(
          eq(proveedores.cifNif, body.cifNif),
          eq(proveedores.companyId, companyId),
          isNull(proveedores.deletedAt),
        ),
      )
      .limit(1);

    if (existing) {
      throw new ConflictException(
        `Ya existe un proveedor con el CIF/NIF ${body.cifNif} en esta empresa`,
      );
    }

    const [row] = await this.db
      .insert(proveedores)
      .values({
        companyId,
        contactId: body.contactId ?? null,
        razonSocial: body.razonSocial,
        cifNif: body.cifNif,
        tipo: body.tipo,
        categoriaPrincipal: body.categoriaPrincipal,
        pais: body.pais,
        paisEjecucion: body.paisEjecucion,
        paisOrigenMateriales: body.paisOrigenMateriales,
        codigoExterno: body.codigoExterno,
        sedeCentral: body.sedeCentral,
        contactoComercial: body.contactoComercial,
        telefonoContacto: body.telefonoContacto,
        emailContacto: body.emailContacto || null,
        condicionesPagoDias: body.condicionesPagoDias,
        retencionGarantiaPct: body.retencionGarantiaPct?.toFixed(2),
        activo: body.activo,
        notas: body.notas,
      })
      .returning();
    return row;
  }

  /** Actualiza un proveedor existente. */
  async update(id: string, body: ProveedorUpdateInput): Promise<Proveedor> {
    await this.get(id); // Verifica que existe y pertenece a la empresa

    const [row] = await this.db
      .update(proveedores)
      .set({
        ...(body.contactId !== undefined && { contactId: body.contactId }),
        ...(body.razonSocial !== undefined && {
          razonSocial: body.razonSocial,
        }),
        ...(body.cifNif !== undefined && { cifNif: body.cifNif }),
        ...(body.tipo !== undefined && { tipo: body.tipo }),
        ...(body.categoriaPrincipal !== undefined && {
          categoriaPrincipal: body.categoriaPrincipal,
        }),
        ...(body.pais !== undefined && { pais: body.pais }),
        ...(body.paisEjecucion !== undefined && {
          paisEjecucion: body.paisEjecucion,
        }),
        ...(body.paisOrigenMateriales !== undefined && {
          paisOrigenMateriales: body.paisOrigenMateriales,
        }),
        ...(body.codigoExterno !== undefined && {
          codigoExterno: body.codigoExterno,
        }),
        ...(body.sedeCentral !== undefined && {
          sedeCentral: body.sedeCentral,
        }),
        ...(body.contactoComercial !== undefined && {
          contactoComercial: body.contactoComercial,
        }),
        ...(body.telefonoContacto !== undefined && {
          telefonoContacto: body.telefonoContacto,
        }),
        ...(body.emailContacto !== undefined && {
          emailContacto: body.emailContacto || null,
        }),
        ...(body.condicionesPagoDias !== undefined && {
          condicionesPagoDias: body.condicionesPagoDias,
        }),
        ...(body.retencionGarantiaPct !== undefined && {
          retencionGarantiaPct: body.retencionGarantiaPct.toFixed(2),
        }),
        ...(body.activo !== undefined && { activo: body.activo }),
        ...(body.notas !== undefined && { notas: body.notas }),
        updatedAt: new Date(),
      })
      .where(eq(proveedores.id, id))
      .returning();
    return row;
  }

  /** Elimina lógicamente un proveedor (si no tiene contratos activos). */
  async remove(id: string): Promise<void> {
    await this.get(id);

    const [contrato] = await this.db
      .select()
      .from(contratosSubcontrata)
      .where(
        and(
          eq(contratosSubcontrata.proveedorId, id),
          eq(contratosSubcontrata.status, 'activo'),
          isNull(contratosSubcontrata.deletedAt),
        ),
      )
      .limit(1);

    if (contrato) {
      throw new ConflictException(
        'No se puede eliminar el proveedor: tiene contratos activos. Cierra o anula los contratos primero.',
      );
    }

    await this.db
      .update(proveedores)
      .set({ activo: false, deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(proveedores.id, id));
  }

  /** Lista los contratos de subcontrata de un proveedor. */
  async listContratosProveedor(
    proveedorId: string,
  ): Promise<ContratoSubcontrata[]> {
    await this.get(proveedorId);
    return this.db
      .select()
      .from(contratosSubcontrata)
      .where(
        and(
          eq(contratosSubcontrata.proveedorId, proveedorId),
          isNull(contratosSubcontrata.deletedAt),
        ),
      )
      .orderBy(desc(contratosSubcontrata.fechaInicio));
  }

  /** Crea un contrato de subcontrata para un proveedor. */
  async createContrato(
    proveedorId: string,
    body: ContratoSubcontrataCreateInput,
  ): Promise<ContratoSubcontrata> {
    const companyId = await this.getCompanyId();
    await this.get(proveedorId);

    const [existing] = await this.db
      .select()
      .from(contratosSubcontrata)
      .where(
        and(
          eq(contratosSubcontrata.companyId, companyId),
          eq(contratosSubcontrata.numeroContrato, body.numeroContrato),
          isNull(contratosSubcontrata.deletedAt),
        ),
      )
      .limit(1);
    if (existing) {
      throw new ConflictException(
        `Ya existe un contrato con el número ${body.numeroContrato} en esta empresa`,
      );
    }

    const [row] = await this.db
      .insert(contratosSubcontrata)
      .values({
        companyId,
        proveedorId,
        proyectoId: body.proyectoId,
        numeroContrato: body.numeroContrato,
        fechaInicio: body.fechaInicio,
        fechaFinPrevista: body.fechaFinPrevista,
        importeTotal: body.importeTotal.toFixed(2),
        retencionGarantiaPct: body.retencionGarantiaPct?.toFixed(2),
        condicionesEspeciales: body.condicionesEspeciales,
        notas: body.notas,
      })
      .returning();
    return row;
  }

  /** Actualiza un contrato de subcontrata. */
  async updateContrato(
    contratoId: string,
    body: ContratoSubcontrataUpdateInput,
  ): Promise<ContratoSubcontrata> {
    const [row] = await this.db
      .update(contratosSubcontrata)
      .set({
        ...(body.fechaInicio !== undefined && {
          fechaInicio: body.fechaInicio,
        }),
        ...(body.fechaFinPrevista !== undefined && {
          fechaFinPrevista: body.fechaFinPrevista,
        }),
        ...(body.fechaFinReal !== undefined && {
          fechaFinReal: body.fechaFinReal,
        }),
        ...(body.firmaFecha !== undefined && { firmaFecha: body.firmaFecha }),
        ...(body.importeTotal !== undefined && {
          importeTotal: body.importeTotal.toFixed(2),
        }),
        ...(body.importeEjecutado !== undefined && {
          importeEjecutado: body.importeEjecutado.toFixed(2),
        }),
        ...(body.retencionGarantiaPct !== undefined && {
          retencionGarantiaPct: body.retencionGarantiaPct.toFixed(2),
        }),
        ...(body.status !== undefined && { status: body.status }),
        ...(body.condicionesEspeciales !== undefined && {
          condicionesEspeciales: body.condicionesEspeciales,
        }),
        ...(body.notas !== undefined && { notas: body.notas }),
        updatedAt: new Date(),
      })
      .where(eq(contratosSubcontrata.id, contratoId))
      .returning();
    if (!row) {
      throw new NotFoundException('Contrato no encontrado');
    }
    return row;
  }

  /** Lista los documentos PRL de un proveedor. */
  async listDocumentosPRL(proveedorId: string): Promise<DocumentoPRL[]> {
    await this.get(proveedorId);
    return this.db
      .select()
      .from(documentosPRL)
      .where(
        and(
          eq(documentosPRL.proveedorId, proveedorId),
          isNull(documentosPRL.deletedAt),
        ),
      )
      .orderBy(desc(documentosPRL.fechaEmision));
  }

  /** Sube un documento PRL para un proveedor, con su estado de vigencia calculado. */
  async uploadDocumentoPRL(
    proveedorId: string,
    body: DocumentoPRLUploadInput,
  ): Promise<DocumentoPRL> {
    const companyId = await this.getCompanyId();
    await this.get(proveedorId);

    const status = computeDocumentoPRLStatus(body.fechaVencimiento, todayIso());

    const [row] = await this.db
      .insert(documentosPRL)
      .values({
        companyId,
        proveedorId,
        docType: body.docType,
        numeroExpediente: body.numeroExpediente,
        fechaEmision: body.fechaEmision,
        fechaVencimiento: body.fechaVencimiento,
        status,
        notas: body.notas,
      })
      .returning();
    return row;
  }

  /**
   * Valida si un proveedor está apto para recibir pagos: ningún documento
   * PRL bloqueante puede estar vencido ni próximo a vencer (30 días).
   */
  async validarAptoParaPago(
    proveedorId: string,
  ): Promise<{ apto: boolean; razones: string[] }> {
    const docs = await this.listDocumentosPRL(proveedorId);
    return validarAptoParaPagoPuro(docs, todayIso());
  }

  /** Busca la ficha extendida de proveedor enlazada a un `contacts.id`, si existe. */
  async findByContactId(contactId: string): Promise<Proveedor | null> {
    const companyId = await this.getCompanyId();
    const [row] = await this.db
      .select()
      .from(proveedores)
      .where(
        and(
          eq(proveedores.contactId, contactId),
          eq(proveedores.companyId, companyId),
          isNull(proveedores.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Guard de compliance PRL (Fase 11): lanza 409 si el contacto tiene ficha
   * de proveedor/subcontrata con algún documento PRL bloqueante vencido o
   * próximo a vencer. Mismo patrón que `ComplianceService.assertCanTransact`
   * (homologación general vía `contacts`), pero para la documentación PRL
   * específica de obra que vive en `documentos_prl`.
   *
   * Sin ficha de proveedor (la mayoría de contactos con `kind: 'proveedor'`
   * de `contacts` no tienen una ficha extendida en `proveedores` — es
   * opcional, ver la cabecera de la tabla): no hay nada que validar, no
   * bloquea. El guard es aditivo, nunca más laxo que `assertCanTransact`.
   */
  async assertAptoParaPago(contactId: string, action: string): Promise<void> {
    const proveedor = await this.findByContactId(contactId);
    if (!proveedor) return;
    const { apto, razones } = await this.validarAptoParaPago(proveedor.id);
    if (apto) return;
    throw new ConflictException(
      `No se puede ${action}: ${proveedor.razonSocial} no está apto por PRL. ` +
        `${razones.join('; ')}.`,
    );
  }
}
