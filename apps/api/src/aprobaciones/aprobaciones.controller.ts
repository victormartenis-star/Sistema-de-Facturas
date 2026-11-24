import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  OPERACIONES_APROBACION,
  decisionAprobarSchema,
  decisionMotivoSchema,
  estadoAprobacionQuerySchema,
  reglaAprobacionCreateSchema,
  reglaAprobacionUpdateSchema,
  solicitudAprobacionCreateSchema,
  solicitudesQuerySchema,
  type DecisionAprobarInput,
  type DecisionMotivoInput,
  type EstadoAprobacionQuery,
  type OperacionAprobacion,
  type ReglaAprobacionCreateInput,
  type ReglaAprobacionUpdateInput,
  type SolicitudAprobacionCreateInput,
  type SolicitudesQuery,
} from '@erp/shared';
import { Roles } from '../auth/roles';
import { Idempotente } from '../common/idempotencia/idempotente.decorator';
import { VersionEsperada } from '../common/version';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AprobacionesService } from './aprobaciones.service';

/**
 * Flujos de aprobación por umbral. Lectura: internos, obra (sus obras) y
 * lector. Reglas: admin y gerente. Solicitar: quien opera los documentos.
 * Decidir: administración, gerencia o admin, según el nivel de la regla y
 * nunca quien solicitó (segregación de funciones, en el servicio).
 */
@Controller('aprobaciones')
@Roles('admin', 'gerente', 'administracion', 'obra', 'lector')
export class AprobacionesController {
  constructor(private readonly service: AprobacionesService) {}

  @Get('reglas')
  reglas(@Query('operacion') operacion?: string) {
    return this.service.listarReglas(
      OPERACIONES_APROBACION.includes(operacion as OperacionAprobacion)
        ? (operacion as OperacionAprobacion)
        : undefined,
    );
  }

  @Post('reglas')
  @Roles('admin', 'gerente')
  @Idempotente()
  crearRegla(
    @Body(new ZodValidationPipe(reglaAprobacionCreateSchema))
    body: ReglaAprobacionCreateInput,
  ) {
    return this.service.crearRegla(body);
  }

  @Patch('reglas/:id')
  @Roles('admin', 'gerente')
  actualizarRegla(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reglaAprobacionUpdateSchema))
    body: ReglaAprobacionUpdateInput,
    @VersionEsperada({ exigible: true }) version: number | undefined,
  ) {
    return this.service.actualizarRegla(id, body, version);
  }

  /** Estado de aprobación de un documento: regla, solicitud y evaluación. */
  @Get('estado')
  estado(
    @Query(new ZodValidationPipe(estadoAprobacionQuerySchema))
    q: EstadoAprobacionQuery,
  ) {
    return this.service.estado(q.operacion, q.entidadId);
  }

  @Get('solicitudes')
  solicitudes(
    @Query(new ZodValidationPipe(solicitudesQuerySchema)) q: SolicitudesQuery,
  ) {
    return this.service.listarSolicitudes(q);
  }

  @Post('solicitudes')
  @Roles('admin', 'gerente', 'administracion', 'obra')
  @Idempotente()
  solicitar(
    @Body(new ZodValidationPipe(solicitudAprobacionCreateSchema))
    body: SolicitudAprobacionCreateInput,
  ) {
    return this.service.solicitar(body);
  }

  @Post('solicitudes/:id/aprobar')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  aprobar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(decisionAprobarSchema))
    body: DecisionAprobarInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.aprobar(id, body, version);
  }

  @Post('solicitudes/:id/rechazar')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  rechazar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(decisionMotivoSchema))
    body: DecisionMotivoInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.rechazar(id, body, version);
  }

  @Post('solicitudes/:id/anular')
  @Roles('admin', 'gerente', 'administracion', 'obra')
  @Idempotente()
  @HttpCode(200)
  anular(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(decisionMotivoSchema))
    body: DecisionMotivoInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.anular(id, body, version);
  }
}
