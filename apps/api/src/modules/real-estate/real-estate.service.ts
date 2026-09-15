import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  Contact,
  PostventaIncident,
  RealEstateKeyHandover,
  RealEstatePaymentMilestone,
  RealEstateReservation,
  RealEstateUnit,
  contacts,
  postventaIncidents,
  projects,
  realEstateKeyHandovers,
  realEstatePaymentMilestones,
  realEstateReservations,
  realEstateUnits,
} from '@erp/db';
import {
  PostventaIncidentCreateInput,
  PostventaIncidentDto,
  PostventaIncidentUpdateStatusInput,
  RealEstateKeyHandoverCreateInput,
  RealEstateKeyHandoverDto,
  RealEstatePaymentMilestoneCreateInput,
  RealEstatePaymentMilestoneDto,
  RealEstateReservationCancelInput,
  RealEstateReservationContractInput,
  RealEstateReservationCreateInput,
  RealEstateReservationDeedInput,
  RealEstateReservationDto,
  RealEstateUnitCreateInput,
  RealEstateUnitDto,
  RealEstateUnitUpdateInput,
  computeCommercializationPct,
  postventaIncidentCreateSchema,
  postventaIncidentUpdateStatusSchema,
  realEstateKeyHandoverCreateSchema,
  realEstatePaymentMilestoneCreateSchema,
  realEstateReservationCancelSchema,
  realEstateReservationContractSchema,
  realEstateReservationCreateSchema,
  realEstateReservationDeedSchema,
  realEstateUnitCreateSchema,
  realEstateUnitUpdateSchema,
  todayIso,
} from '@erp/shared';
import { AuditService } from '../../audit/audit.service';
import { DbService } from '../../db/db.service';

function unitToDto(
  row: RealEstateUnit,
  projectCode: string,
): RealEstateUnitDto {
  return {
    id: row.id,
    projectId: row.projectId,
    projectCode,
    code: row.code,
    kind: row.kind,
    surfaceM2: row.surfaceM2 ? Number(row.surfaceM2) : null,
    salePrice: Number(row.salePrice),
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function reservationToDto(
  row: RealEstateReservation,
  unitCode: string,
  buyerName: string,
): RealEstateReservationDto {
  return {
    id: row.id,
    unitId: row.unitId,
    unitCode,
    buyerContactId: row.buyerContactId,
    buyerName,
    status: row.status,
    reservationDate: row.reservationDate,
    agreedPrice: Number(row.agreedPrice),
    signalAmount: Number(row.signalAmount),
    contractDate: row.contractDate,
    deedDate: row.deedDate,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function paymentToDto(
  row: RealEstatePaymentMilestone,
): RealEstatePaymentMilestoneDto {
  return {
    id: row.id,
    reservationId: row.reservationId,
    concept: row.concept,
    dueDate: row.dueDate,
    amount: Number(row.amount),
    status: row.status,
    paidAt: row.paidAt,
  };
}

function handoverToDto(row: RealEstateKeyHandover): RealEstateKeyHandoverDto {
  return {
    id: row.id,
    reservationId: row.reservationId,
    handoverDate: row.handoverDate,
    documentId: row.documentId,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

function incidentToDto(
  row: PostventaIncident,
  unitCode: string,
  reportedByName: string | null,
): PostventaIncidentDto {
  return {
    id: row.id,
    unitId: row.unitId,
    unitCode,
    reportedByContactId: row.reportedByContactId,
    reportedByName,
    category: row.category,
    description: row.description,
    status: row.status,
    reportedAt: row.reportedAt,
    resolvedAt: row.resolvedAt,
    warrantyDeadline: row.warrantyDeadline,
    warrantyExpired:
      row.status !== 'cerrada' &&
      !!row.warrantyDeadline &&
      row.warrantyDeadline < todayIso(),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class RealEstateService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  /* ────────────────────── unidades ────────────────────── */

  async listUnits(projectId?: string): Promise<RealEstateUnitDto[]> {
    const companyId = await this.dbs.getCompanyId();
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null) {
      if (allowed.length === 0) return [];
      if (projectId && !allowed.includes(projectId)) return [];
    }

    const conditions = [
      eq(realEstateUnits.companyId, companyId),
      isNull(realEstateUnits.deletedAt),
    ];
    if (projectId) conditions.push(eq(realEstateUnits.projectId, projectId));

    const rows = await this.dbs.db
      .select({ unit: realEstateUnits, projectCode: projects.code })
      .from(realEstateUnits)
      .innerJoin(projects, eq(realEstateUnits.projectId, projects.id))
      .where(and(...conditions))
      .orderBy(asc(realEstateUnits.code));
    const visible =
      allowed === null
        ? rows
        : rows.filter((r) => allowed.includes(r.unit.projectId));
    return visible.map((r) => unitToDto(r.unit, r.projectCode));
  }

  async getUnit(id: string): Promise<RealEstateUnitDto> {
    const { unit, projectCode } = await this.findUnit(id);
    return unitToDto(unit, projectCode);
  }

  async createUnit(
    input: RealEstateUnitCreateInput,
  ): Promise<RealEstateUnitDto> {
    const companyId = await this.dbs.getCompanyId();
    const data = realEstateUnitCreateSchema.parse(input);
    await this.assertProjectAccessible(data.projectId);
    const project = await this.projectCode(data.projectId);

    const [row] = await this.dbs.db
      .insert(realEstateUnits)
      .values({
        companyId,
        projectId: data.projectId,
        code: data.code,
        kind: data.kind,
        surfaceM2: data.surfaceM2 != null ? data.surfaceM2.toFixed(2) : null,
        salePrice: data.salePrice.toFixed(2),
        notes: data.notes ?? null,
      })
      .returning();
    void this.audit.log({
      entityType: 'real_estate_unit',
      entityId: row.id,
      action: 'create',
      newData: row,
    });
    return unitToDto(row, project);
  }

  async updateUnit(
    id: string,
    input: RealEstateUnitUpdateInput,
  ): Promise<RealEstateUnitDto> {
    const { projectCode } = await this.findUnit(id);
    const data = realEstateUnitUpdateSchema.parse(input);
    const [row] = await this.dbs.db
      .update(realEstateUnits)
      .set({
        ...(data.code !== undefined && { code: data.code }),
        ...(data.kind !== undefined && { kind: data.kind }),
        ...(data.surfaceM2 !== undefined && {
          surfaceM2: data.surfaceM2 != null ? data.surfaceM2.toFixed(2) : null,
        }),
        ...(data.salePrice !== undefined && {
          salePrice: data.salePrice.toFixed(2),
        }),
        ...(data.notes !== undefined && { notes: data.notes ?? null }),
        updatedAt: new Date(),
      })
      .where(eq(realEstateUnits.id, id))
      .returning();
    return unitToDto(row, projectCode);
  }

  async removeUnit(id: string): Promise<void> {
    const { unit } = await this.findUnit(id);
    if (unit.status !== 'disponible') {
      throw new BadRequestException(
        'Solo se pueden eliminar unidades disponibles (sin reserva/venta)',
      );
    }
    await this.dbs.db
      .update(realEstateUnits)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(realEstateUnits.id, id));
  }

  /** Panel de comercialización: % vendido/entregado de una promoción. */
  async commercialization(projectId: string) {
    await this.assertProjectAccessible(projectId);
    const units = await this.listUnits(projectId);
    return {
      projectId,
      ...computeCommercializationPct(units),
      total: units.length,
    };
  }

  /* ────────────────────── reservas ────────────────────── */

  async listReservations(unitId?: string): Promise<RealEstateReservationDto[]> {
    const companyId = await this.dbs.getCompanyId();
    const conditions = [eq(realEstateReservations.companyId, companyId)];
    if (unitId) conditions.push(eq(realEstateReservations.unitId, unitId));

    const rows = await this.dbs.db
      .select({
        reservation: realEstateReservations,
        unitCode: realEstateUnits.code,
        unitProjectId: realEstateUnits.projectId,
        buyerName: contacts.legalName,
      })
      .from(realEstateReservations)
      .innerJoin(
        realEstateUnits,
        eq(realEstateReservations.unitId, realEstateUnits.id),
      )
      .innerJoin(
        contacts,
        eq(realEstateReservations.buyerContactId, contacts.id),
      )
      .where(and(...conditions))
      .orderBy(asc(realEstateReservations.reservationDate));

    const allowed = await this.dbs.getObrasAccesibles();
    const visible =
      allowed === null
        ? rows
        : rows.filter((r) => allowed.includes(r.unitProjectId));
    return visible.map((r) =>
      reservationToDto(r.reservation, r.unitCode, r.buyerName),
    );
  }

  async createReservation(
    input: RealEstateReservationCreateInput,
  ): Promise<RealEstateReservationDto> {
    const companyId = await this.dbs.getCompanyId();
    const data = realEstateReservationCreateSchema.parse(input);
    const { unit } = await this.findUnit(data.unitId);
    if (unit.status !== 'disponible') {
      throw new BadRequestException(
        `La unidad "${unit.code}" no está disponible (estado actual: ${unit.status})`,
      );
    }
    const buyer = await this.findContact(data.buyerContactId);

    const [row] = await this.dbs.db.transaction(async (tx) => {
      const [reservation] = await tx
        .insert(realEstateReservations)
        .values({
          companyId,
          unitId: data.unitId,
          buyerContactId: data.buyerContactId,
          reservationDate: data.reservationDate,
          agreedPrice: data.agreedPrice.toFixed(2),
          signalAmount: data.signalAmount.toFixed(2),
          notes: data.notes ?? null,
        })
        .returning();
      await tx
        .update(realEstateUnits)
        .set({ status: 'reservada', updatedAt: new Date() })
        .where(eq(realEstateUnits.id, data.unitId));
      return [reservation];
    });

    void this.audit.log({
      entityType: 'real_estate_reservation',
      entityId: row.id,
      action: 'create',
      newData: row,
    });
    return reservationToDto(row, unit.code, buyer.legalName);
  }

  async cancelReservation(
    id: string,
    input: RealEstateReservationCancelInput,
  ): Promise<RealEstateReservationDto> {
    const { reservation, unit, buyerName } = await this.findReservation(id);
    if (
      reservation.status === 'escriturada' ||
      reservation.status === 'cancelada'
    ) {
      throw new BadRequestException(
        'No se puede cancelar una reserva ya escriturada o ya cancelada',
      );
    }
    const data = realEstateReservationCancelSchema.parse(input);

    const [row] = await this.dbs.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(realEstateReservations)
        .set({
          status: 'cancelada',
          notes: data.reason
            ? `${reservation.notes ?? ''}\nCancelada: ${data.reason}`.trim()
            : reservation.notes,
          updatedAt: new Date(),
        })
        .where(eq(realEstateReservations.id, id))
        .returning();
      await tx
        .update(realEstateUnits)
        .set({ status: 'disponible', updatedAt: new Date() })
        .where(eq(realEstateUnits.id, reservation.unitId));
      return [updated];
    });
    return reservationToDto(row, unit.code, buyerName);
  }

  async signContract(
    id: string,
    input: RealEstateReservationContractInput,
  ): Promise<RealEstateReservationDto> {
    const { reservation, unit, buyerName } = await this.findReservation(id);
    if (reservation.status !== 'reservada') {
      throw new BadRequestException(
        'Solo se puede firmar el contrato de una reserva en estado "reservada"',
      );
    }
    const data = realEstateReservationContractSchema.parse(input);
    const [row] = await this.dbs.db
      .update(realEstateReservations)
      .set({
        status: 'contrato_firmado',
        contractDate: data.contractDate,
        updatedAt: new Date(),
      })
      .where(eq(realEstateReservations.id, id))
      .returning();
    return reservationToDto(row, unit.code, buyerName);
  }

  async signDeed(
    id: string,
    input: RealEstateReservationDeedInput,
  ): Promise<RealEstateReservationDto> {
    const { reservation, unit, buyerName } = await this.findReservation(id);
    if (reservation.status !== 'contrato_firmado') {
      throw new BadRequestException(
        'Solo se puede escriturar una reserva con el contrato privado ya firmado',
      );
    }
    const data = realEstateReservationDeedSchema.parse(input);

    const [row] = await this.dbs.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(realEstateReservations)
        .set({
          status: 'escriturada',
          deedDate: data.deedDate,
          updatedAt: new Date(),
        })
        .where(eq(realEstateReservations.id, id))
        .returning();
      await tx
        .update(realEstateUnits)
        .set({ status: 'vendida', updatedAt: new Date() })
        .where(eq(realEstateUnits.id, reservation.unitId));
      return [updated];
    });
    return reservationToDto(row, unit.code, buyerName);
  }

  /* ────────────────────── plan de cobros ────────────────────── */

  async listPayments(
    reservationId: string,
  ): Promise<RealEstatePaymentMilestoneDto[]> {
    await this.findReservation(reservationId);
    const rows = await this.dbs.db
      .select()
      .from(realEstatePaymentMilestones)
      .where(eq(realEstatePaymentMilestones.reservationId, reservationId))
      .orderBy(asc(realEstatePaymentMilestones.dueDate));
    return rows.map(paymentToDto);
  }

  async createPayment(
    reservationId: string,
    input: RealEstatePaymentMilestoneCreateInput,
  ): Promise<RealEstatePaymentMilestoneDto> {
    const { reservation } = await this.findReservation(reservationId);
    const companyId = await this.dbs.getCompanyId();
    const data = realEstatePaymentMilestoneCreateSchema.parse(input);
    const [row] = await this.dbs.db
      .insert(realEstatePaymentMilestones)
      .values({
        companyId,
        reservationId: reservation.id,
        concept: data.concept,
        dueDate: data.dueDate,
        amount: data.amount.toFixed(2),
      })
      .returning();
    return paymentToDto(row);
  }

  async payPayment(id: string): Promise<void> {
    const [row] = await this.dbs.db
      .update(realEstatePaymentMilestones)
      .set({ status: 'cobrado', paidAt: todayIso(), updatedAt: new Date() })
      .where(eq(realEstatePaymentMilestones.id, id))
      .returning({ id: realEstatePaymentMilestones.id });
    if (!row) throw new NotFoundException('Vencimiento no encontrado');
  }

  /* ────────────────────── entrega de llaves ────────────────────── */

  async createKeyHandover(
    reservationId: string,
    input: RealEstateKeyHandoverCreateInput,
  ): Promise<RealEstateKeyHandoverDto> {
    const { reservation } = await this.findReservation(reservationId);
    if (reservation.status !== 'escriturada') {
      throw new BadRequestException(
        'Solo se puede entregar llaves de una reserva ya escriturada',
      );
    }
    const companyId = await this.dbs.getCompanyId();
    const data = realEstateKeyHandoverCreateSchema.parse(input);

    const [row] = await this.dbs.db.transaction(async (tx) => {
      const [handover] = await tx
        .insert(realEstateKeyHandovers)
        .values({
          companyId,
          reservationId: reservation.id,
          handoverDate: data.handoverDate,
          documentId: data.documentId ?? null,
          notes: data.notes ?? null,
        })
        .returning();
      await tx
        .update(realEstateUnits)
        .set({ status: 'entregada', updatedAt: new Date() })
        .where(eq(realEstateUnits.id, reservation.unitId));
      return [handover];
    });

    void this.audit.log({
      entityType: 'real_estate_key_handover',
      entityId: row.id,
      action: 'create',
      newData: row,
    });
    return handoverToDto(row);
  }

  async getKeyHandover(
    reservationId: string,
  ): Promise<RealEstateKeyHandoverDto | null> {
    const [row] = await this.dbs.db
      .select()
      .from(realEstateKeyHandovers)
      .where(eq(realEstateKeyHandovers.reservationId, reservationId))
      .limit(1);
    return row ? handoverToDto(row) : null;
  }

  /* ────────────────────── postventa ────────────────────── */

  async listIncidents(unitId?: string): Promise<PostventaIncidentDto[]> {
    const companyId = await this.dbs.getCompanyId();
    const conditions = [
      eq(postventaIncidents.companyId, companyId),
      isNull(postventaIncidents.deletedAt),
    ];
    if (unitId) conditions.push(eq(postventaIncidents.unitId, unitId));

    const rows = await this.dbs.db
      .select({
        incident: postventaIncidents,
        unitCode: realEstateUnits.code,
        unitProjectId: realEstateUnits.projectId,
        reportedByName: contacts.legalName,
      })
      .from(postventaIncidents)
      .innerJoin(
        realEstateUnits,
        eq(postventaIncidents.unitId, realEstateUnits.id),
      )
      .leftJoin(
        contacts,
        eq(postventaIncidents.reportedByContactId, contacts.id),
      )
      .where(and(...conditions));

    const allowed = await this.dbs.getObrasAccesibles();
    const visible =
      allowed === null
        ? rows
        : rows.filter((r) => allowed.includes(r.unitProjectId));
    return visible.map((r) =>
      incidentToDto(r.incident, r.unitCode, r.reportedByName ?? null),
    );
  }

  async createIncident(
    input: PostventaIncidentCreateInput,
  ): Promise<PostventaIncidentDto> {
    const companyId = await this.dbs.getCompanyId();
    const data = postventaIncidentCreateSchema.parse(input);
    const { unit } = await this.findUnit(data.unitId);
    const reportedBy = data.reportedByContactId
      ? await this.findContact(data.reportedByContactId)
      : null;

    const [row] = await this.dbs.db
      .insert(postventaIncidents)
      .values({
        companyId,
        unitId: data.unitId,
        reportedByContactId: data.reportedByContactId ?? null,
        category: data.category,
        description: data.description,
        reportedAt: data.reportedAt,
        warrantyDeadline: data.warrantyDeadline ?? null,
        notes: data.notes ?? null,
      })
      .returning();
    void this.audit.log({
      entityType: 'postventa_incident',
      entityId: row.id,
      action: 'create',
      newData: row,
    });
    return incidentToDto(row, unit.code, reportedBy?.legalName ?? null);
  }

  async updateIncidentStatus(
    id: string,
    input: PostventaIncidentUpdateStatusInput,
  ): Promise<PostventaIncidentDto> {
    const { incident, unitCode, reportedByName } = await this.findIncident(id);
    const data = postventaIncidentUpdateStatusSchema.parse(input);
    const [row] = await this.dbs.db
      .update(postventaIncidents)
      .set({
        status: data.status,
        resolvedAt:
          data.status === 'cerrada' ? todayIso() : incident.resolvedAt,
        ...(data.notes !== undefined && { notes: data.notes ?? null }),
        updatedAt: new Date(),
      })
      .where(eq(postventaIncidents.id, id))
      .returning();
    return incidentToDto(row, unitCode, reportedByName);
  }

  /* ────────────────────── privados ────────────────────── */

  private async findUnit(
    id: string,
  ): Promise<{ unit: RealEstateUnit; projectCode: string }> {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select({ unit: realEstateUnits, projectCode: projects.code })
      .from(realEstateUnits)
      .innerJoin(projects, eq(realEstateUnits.projectId, projects.id))
      .where(
        and(
          eq(realEstateUnits.id, id),
          eq(realEstateUnits.companyId, companyId),
          isNull(realEstateUnits.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Unidad no encontrada');
    await this.assertProjectAccessible(row.unit.projectId);
    return row;
  }

  private async findReservation(id: string): Promise<{
    reservation: RealEstateReservation;
    unit: RealEstateUnit;
    buyerName: string;
  }> {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select({
        reservation: realEstateReservations,
        unit: realEstateUnits,
        buyerName: contacts.legalName,
      })
      .from(realEstateReservations)
      .innerJoin(
        realEstateUnits,
        eq(realEstateReservations.unitId, realEstateUnits.id),
      )
      .innerJoin(
        contacts,
        eq(realEstateReservations.buyerContactId, contacts.id),
      )
      .where(
        and(
          eq(realEstateReservations.id, id),
          eq(realEstateReservations.companyId, companyId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Reserva no encontrada');
    await this.assertProjectAccessible(row.unit.projectId);
    return row;
  }

  private async findIncident(id: string): Promise<{
    incident: PostventaIncident;
    unitCode: string;
    reportedByName: string | null;
  }> {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select({
        incident: postventaIncidents,
        unitCode: realEstateUnits.code,
        reportedByName: contacts.legalName,
      })
      .from(postventaIncidents)
      .innerJoin(
        realEstateUnits,
        eq(postventaIncidents.unitId, realEstateUnits.id),
      )
      .leftJoin(
        contacts,
        eq(postventaIncidents.reportedByContactId, contacts.id),
      )
      .where(
        and(
          eq(postventaIncidents.id, id),
          eq(postventaIncidents.companyId, companyId),
          isNull(postventaIncidents.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Incidencia no encontrada');
    return { ...row, reportedByName: row.reportedByName ?? null };
  }

  private async findContact(id: string): Promise<Contact> {
    const [row] = await this.dbs.db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, id), isNull(contacts.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Contacto no encontrado');
    return row;
  }

  private async projectCode(projectId: string): Promise<string> {
    const [row] = await this.dbs.db
      .select({ code: projects.code })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!row) throw new BadRequestException('La obra indicada no existe');
    return row.code;
  }

  private async assertProjectAccessible(projectId: string): Promise<void> {
    const allowed = await this.dbs.getObrasAccesibles();
    if (allowed !== null && !allowed.includes(projectId)) {
      throw new NotFoundException('Obra no encontrada');
    }
  }
}
