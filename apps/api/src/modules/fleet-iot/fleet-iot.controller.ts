import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { TelemetriaIngestInput, telemetriaIngestSchema } from '@erp/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { FleetIotService } from './fleet-iot.service';

@Controller('fleet-iot')
export class FleetIotController {
  constructor(private readonly service: FleetIotService) {}

  /** Ingesta de telemetría del dispositivo IoT instalado en el equipo. */
  @Post('telemetria')
  ingest(
    @Body(new ZodValidationPipe(telemetriaIngestSchema))
    body: TelemetriaIngestInput,
  ) {
    return this.service.ingestTelemetria(body);
  }

  @Get('equipos/:equipoId/telemetria')
  listLecturas(@Param('equipoId', ParseUUIDPipe) equipoId: string) {
    return this.service.listLecturas(equipoId);
  }

  @Get('alertas')
  listAlertas(
    @Query('estado') estado?: string,
    @Query('equipoId') equipoId?: string,
  ) {
    return this.service.listAlertas({ estado, equipoId });
  }

  /** Recalcula alertas de mantenimiento vencido sobre el maestro de equipos. */
  @Get('alertas/revisar-vencimientos')
  revisarVencimientos() {
    return this.service.revisarVencimientos();
  }

  @Patch('alertas/:id/reconocer')
  reconocer(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.reconocerAlerta(id);
  }

  @Patch('alertas/:id/cerrar')
  cerrar(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.cerrarAlerta(id);
  }
}
