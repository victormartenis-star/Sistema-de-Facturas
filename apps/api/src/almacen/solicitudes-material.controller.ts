import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  cancelarSolicitudSchema,
  pedidoFaltanteSchema,
  servirSolicitudSchema,
  solicitudMaterialCreateSchema,
  solicitudesMaterialQuerySchema,
  type CancelarSolicitudInput,
  type PedidoFaltanteInput,
  type ServirSolicitudInput,
  type SolicitudMaterialCreateInput,
  type SolicitudesMaterialQuery,
} from '@erp/shared';
import { Roles } from '../auth/roles';
import { Idempotente } from '../common/idempotencia/idempotente.decorator';
import { VersionEsperada } from '../common/version';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SolicitudesMaterialService } from './solicitudes-material.service';

/**
 * Solicitudes de material de obra. Lectura: internos, obra (sus obras) y
 * lector. Pedir, reservar, servir y cancelar: también el jefe de obra.
 * Convertir el faltante en pedido de compra: admin, gerente y administración.
 */
@Controller('almacen/solicitudes')
@Roles('admin', 'gerente', 'administracion', 'obra', 'lector')
export class SolicitudesMaterialController {
  constructor(private readonly service: SolicitudesMaterialService) {}

  @Get()
  listar(
    @Query(new ZodValidationPipe(solicitudesMaterialQuerySchema))
    q: SolicitudesMaterialQuery,
  ) {
    return this.service.listar(q);
  }

  @Get(':id')
  detalle(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.detalle(id);
  }

  @Post()
  @Roles('admin', 'gerente', 'administracion', 'obra')
  @Idempotente()
  crear(
    @Body(new ZodValidationPipe(solicitudMaterialCreateSchema))
    body: SolicitudMaterialCreateInput,
  ) {
    return this.service.crear(body);
  }

  /** Reserva el faltante con el stock libre actual. `If-Match` opcional. */
  @Post(':id/reservar')
  @Roles('admin', 'gerente', 'administracion', 'obra')
  @HttpCode(200)
  reservar(
    @Param('id', ParseUUIDPipe) id: string,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.reservar(id, version);
  }

  @Post(':id/servir')
  @Roles('admin', 'gerente', 'administracion', 'obra')
  @Idempotente()
  @HttpCode(200)
  servir(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(servirSolicitudSchema))
    body: ServirSolicitudInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.servir(id, body, version);
  }

  @Post(':id/cancelar')
  @Roles('admin', 'gerente', 'administracion', 'obra')
  @Idempotente()
  @HttpCode(200)
  cancelar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cancelarSolicitudSchema))
    body: CancelarSolicitudInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.cancelar(id, body, version);
  }

  @Post(':id/pedido')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  pedido(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(pedidoFaltanteSchema))
    body: PedidoFaltanteInput,
  ) {
    return this.service.pedidoFaltante(id, body);
  }
}
