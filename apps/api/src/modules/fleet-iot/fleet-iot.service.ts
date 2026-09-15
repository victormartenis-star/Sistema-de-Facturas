import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import {
  Equipo,
  IotAlerta,
  IotLecturaTelemetria,
  equipos,
  iotAlertas,
  iotLecturasTelemetria,
  mantenimientosEquipo,
} from '@erp/db';
import {
  IotAlertaDto,
  TelemetriaIngestInput,
  TelemetriaLecturaDto,
  evaluateTelemetriaAlertas,
  isMantenimientoVencido,
  telemetriaIngestSchema,
  todayIso,
} from '@erp/shared';
import { AuditService } from '../../audit/audit.service';
import { DbService } from '../../db/db.service';

function lecturaToDto(row: IotLecturaTelemetria): TelemetriaLecturaDto {
  return {
    id: row.id,
    equipoId: row.equipoId,
    projectId: row.projectId,
    capturadoEn: row.capturadoEn.toISOString(),
    horasUso: row.horasUso === null ? null : Number(row.horasUso),
    kmRecorridos: row.kmRecorridos === null ? null : Number(row.kmRecorridos),
    combustibleNivelPct:
      row.combustibleNivelPct === null ? null : Number(row.combustibleNivelPct),
    temperaturaMotor:
      row.temperaturaMotor === null ? null : Number(row.temperaturaMotor),
    ubicacionLat: row.ubicacionLat === null ? null : Number(row.ubicacionLat),
    ubicacionLng: row.ubicacionLng === null ? null : Number(row.ubicacionLng),
    codigoError: row.codigoError,
    createdAt: row.createdAt.toISOString(),
  };
}

function alertaToDto(row: IotAlerta, equipoNombre: string): IotAlertaDto {
  return {
    id: row.id,
    equipoId: row.equipoId,
    equipoNombre,
    lecturaId: row.lecturaId,
    tipo: row.tipo,
    gravedad: row.gravedad,
    estado: row.estado,
    mensaje: row.mensaje,
    reconocidaPorUserId: row.reconocidaPorUserId,
    cerradaAt: row.cerradaAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class FleetIotService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  /* ────────────────────── ingesta de telemetría ────────────────────── */

  async ingestTelemetria(
    input: TelemetriaIngestInput,
  ): Promise<{ lectura: TelemetriaLecturaDto; alertas: IotAlertaDto[] }> {
    const companyId = await this.dbs.getCompanyId();
    const data = telemetriaIngestSchema.parse(input);
    const equipo = await this.findEquipo(data.equipoId);

    const [lectura] = await this.dbs.db
      .insert(iotLecturasTelemetria)
      .values({
        companyId,
        equipoId: data.equipoId,
        projectId: data.projectId ?? null,
        capturadoEn: data.capturadoEn ? new Date(data.capturadoEn) : new Date(),
        horasUso: data.horasUso?.toFixed(2) ?? null,
        kmRecorridos: data.kmRecorridos?.toFixed(2) ?? null,
        combustibleNivelPct: data.combustibleNivelPct?.toFixed(2) ?? null,
        temperaturaMotor: data.temperaturaMotor?.toFixed(2) ?? null,
        ubicacionLat: data.ubicacionLat?.toFixed(6) ?? null,
        ubicacionLng: data.ubicacionLng?.toFixed(6) ?? null,
        codigoError: data.codigoError ?? null,
        payload: data.payload,
      })
      .returning();

    const candidatas = evaluateTelemetriaAlertas({
      codigoError: data.codigoError,
      temperaturaMotor: data.temperaturaMotor,
      combustibleNivelPct: data.combustibleNivelPct,
    });

    const alertas: IotAlertaDto[] = [];
    for (const candidata of candidatas) {
      const [row] = await this.dbs.db
        .insert(iotAlertas)
        .values({
          companyId,
          equipoId: data.equipoId,
          lecturaId: lectura.id,
          tipo: candidata.tipo,
          gravedad: candidata.gravedad,
          mensaje: candidata.mensaje,
        })
        .returning();
      void this.audit.log({
        entityType: 'iot_alerta',
        entityId: row.id,
        action: 'create',
        newData: row,
      });
      alertas.push(alertaToDto(row, equipo.nombre));
    }

    void this.audit.log({
      entityType: 'iot_lectura_telemetria',
      entityId: lectura.id,
      action: 'create',
      newData: lectura,
    });
    return { lectura: lecturaToDto(lectura), alertas };
  }

  async listLecturas(equipoId: string): Promise<TelemetriaLecturaDto[]> {
    await this.findEquipo(equipoId);
    const rows = await this.dbs.db
      .select()
      .from(iotLecturasTelemetria)
      .where(eq(iotLecturasTelemetria.equipoId, equipoId))
      .orderBy(desc(iotLecturasTelemetria.capturadoEn))
      .limit(200);
    return rows.map(lecturaToDto);
  }

  /* ────────────────────── alertas ────────────────────── */

  async listAlertas(filter: {
    estado?: string;
    equipoId?: string;
  }): Promise<IotAlertaDto[]> {
    const companyId = await this.dbs.getCompanyId();
    const conditions = [eq(iotAlertas.companyId, companyId)];
    if (filter.estado)
      conditions.push(
        eq(iotAlertas.estado, filter.estado as IotAlerta['estado']),
      );
    if (filter.equipoId)
      conditions.push(eq(iotAlertas.equipoId, filter.equipoId));

    const rows = await this.dbs.db
      .select({ alerta: iotAlertas, equipoNombre: equipos.nombre })
      .from(iotAlertas)
      .innerJoin(equipos, eq(iotAlertas.equipoId, equipos.id))
      .where(and(...conditions))
      .orderBy(desc(iotAlertas.createdAt));
    return rows.map((r) => alertaToDto(r.alerta, r.equipoNombre));
  }

  async reconocerAlerta(id: string): Promise<IotAlertaDto> {
    const ctx = this.dbs.getContext();
    const { alerta, equipoNombre } = await this.findAlerta(id);
    if (alerta.estado !== 'abierta') return alertaToDto(alerta, equipoNombre);
    const [row] = await this.dbs.db
      .update(iotAlertas)
      .set({ estado: 'reconocida', reconocidaPorUserId: ctx.userId })
      .where(eq(iotAlertas.id, id))
      .returning();
    return alertaToDto(row, equipoNombre);
  }

  async cerrarAlerta(id: string): Promise<IotAlertaDto> {
    const { alerta, equipoNombre } = await this.findAlerta(id);
    if (alerta.estado === 'cerrada') return alertaToDto(alerta, equipoNombre);
    const [row] = await this.dbs.db
      .update(iotAlertas)
      .set({ estado: 'cerrada', cerradaAt: new Date() })
      .where(eq(iotAlertas.id, id))
      .returning();
    return alertaToDto(row, equipoNombre);
  }

  /**
   * Revisa el maestro de equipos en busca de mantenimientos vencidos y abre
   * la alerta `mantenimiento_vencido` que falte (sin duplicar si ya hay una
   * abierta o reconocida para ese equipo). Se calcula al vuelo porque no
   * hay cron en este ERP; se invoca desde `GET /fleet-iot/alertas/revisar-vencimientos`.
   */
  async revisarVencimientos(): Promise<IotAlertaDto[]> {
    const companyId = await this.dbs.getCompanyId();
    const hoy = todayIso();
    const equiposActivos = await this.dbs.db
      .select()
      .from(equipos)
      .where(and(eq(equipos.companyId, companyId), isNull(equipos.deletedAt)));

    const creadas: IotAlertaDto[] = [];
    for (const equipo of equiposActivos) {
      const proxima = await this.proximaRevision(equipo.id);
      if (!isMantenimientoVencido(proxima, hoy)) continue;

      const [yaAbierta] = await this.dbs.db
        .select()
        .from(iotAlertas)
        .where(
          and(
            eq(iotAlertas.equipoId, equipo.id),
            eq(iotAlertas.tipo, 'mantenimiento_vencido'),
          ),
        )
        .orderBy(desc(iotAlertas.createdAt))
        .limit(1);
      if (yaAbierta && yaAbierta.estado !== 'cerrada') continue;

      const [row] = await this.dbs.db
        .insert(iotAlertas)
        .values({
          companyId,
          equipoId: equipo.id,
          tipo: 'mantenimiento_vencido',
          gravedad: 'grave',
          mensaje: `Revisión prevista para ${proxima}, sin registrar a día de hoy`,
        })
        .returning();
      creadas.push(alertaToDto(row, equipo.nombre));
    }
    return creadas;
  }

  /* ────────────────────── privados ────────────────────── */

  private async proximaRevision(equipoId: string): Promise<string | null> {
    const rows = await this.dbs.db
      .select({
        proximaRevisionFecha: mantenimientosEquipo.proximaRevisionFecha,
      })
      .from(mantenimientosEquipo)
      .where(
        and(
          eq(mantenimientosEquipo.equipoId, equipoId),
          isNull(mantenimientosEquipo.deletedAt),
        ),
      )
      .orderBy(asc(mantenimientosEquipo.proximaRevisionFecha));
    const proximas = rows
      .map((r) => r.proximaRevisionFecha)
      .filter((f): f is string => f !== null)
      .sort();
    return proximas[0] ?? null;
  }

  private async findEquipo(id: string): Promise<Equipo> {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select()
      .from(equipos)
      .where(
        and(
          eq(equipos.id, id),
          eq(equipos.companyId, companyId),
          isNull(equipos.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Equipo no encontrado');
    return row;
  }

  private async findAlerta(
    id: string,
  ): Promise<{ alerta: IotAlerta; equipoNombre: string }> {
    const companyId = await this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select({ alerta: iotAlertas, equipoNombre: equipos.nombre })
      .from(iotAlertas)
      .innerJoin(equipos, eq(iotAlertas.equipoId, equipos.id))
      .where(and(eq(iotAlertas.id, id), eq(iotAlertas.companyId, companyId)))
      .limit(1);
    if (!row) throw new NotFoundException('Alerta no encontrada');
    return { alerta: row.alerta, equipoNombre: row.equipoNombre };
  }
}
