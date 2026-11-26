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
  adjudicarPeticionSchema,
  convertirEnPedidoSchema,
  convertirEnPeticionSchema,
  facturaPedidoCreateSchema,
  ofertaRegistrarSchema,
  pedidoLineasCreateSchema,
  recepcionCreateSchema,
  rechazoSchema,
  solicitudCompraCreateSchema,
  solicitudesCompraQuerySchema,
  type AdjudicarPeticionInput,
  type ConvertirEnPedidoInput,
  type ConvertirEnPeticionInput,
  type FacturaPedidoCreateInput,
  type OfertaRegistrarInput,
  type PedidoLineasCreateInput,
  type RecepcionCreateInput,
  type RechazoInput,
  type SolicitudCompraCreateInput,
  type SolicitudesCompraQuery,
} from '@erp/shared';
import { Roles } from '../auth/roles';
import { Idempotente } from '../common/idempotencia/idempotente.decorator';
import { VersionEsperada } from '../common/version';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ComprasService } from './compras.service';

const ADMINISTRACION = ['admin', 'gerente', 'administracion'] as const;
const uuidOpcional = (v?: string) =>
  v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined;

/**
 * Procure-to-Pay. Lectura: admin, gerente, administración, obra (sus obras)
 * y lector. Solicitudes y recepciones: también el jefe de obra. Aprobar,
 * convertir, pedir ofertas, adjudicar, emitir pedidos y verificar facturas:
 * admin, gerente y administración.
 */
@Controller('compras')
@Roles('admin', 'gerente', 'administracion', 'obra', 'lector')
export class ComprasController {
  constructor(private readonly service: ComprasService) {}

  /* ─────────── solicitudes de compra ─────────── */

  @Get('solicitudes')
  solicitudes(
    @Query(new ZodValidationPipe(solicitudesCompraQuerySchema))
    q: SolicitudesCompraQuery,
  ) {
    return this.service.solicitudes(q);
  }

  @Get('solicitudes/:id')
  solicitud(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.solicitud(id);
  }

  @Post('solicitudes')
  @Roles('admin', 'gerente', 'administracion', 'obra')
  @Idempotente()
  crearSolicitud(
    @Body(new ZodValidationPipe(solicitudCompraCreateSchema))
    body: SolicitudCompraCreateInput,
  ) {
    return this.service.crearSolicitud(body);
  }

  @Post('solicitudes/:id/enviar')
  @Roles('admin', 'gerente', 'administracion', 'obra')
  @HttpCode(200)
  enviar(
    @Param('id', ParseUUIDPipe) id: string,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.enviarSolicitud(id, version);
  }

  @Post('solicitudes/:id/aprobar')
  @Roles(...ADMINISTRACION)
  @HttpCode(200)
  aprobar(
    @Param('id', ParseUUIDPipe) id: string,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.aprobarSolicitud(id, version);
  }

  @Post('solicitudes/:id/rechazar')
  @Roles(...ADMINISTRACION)
  @HttpCode(200)
  rechazar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(rechazoSchema)) body: RechazoInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.rechazarSolicitud(id, body, version);
  }

  @Post('solicitudes/:id/pedido')
  @Roles(...ADMINISTRACION)
  @Idempotente()
  convertirEnPedido(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(convertirEnPedidoSchema))
    body: ConvertirEnPedidoInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.convertirEnPedido(id, body, version);
  }

  @Post('solicitudes/:id/peticion')
  @Roles(...ADMINISTRACION)
  @Idempotente()
  convertirEnPeticion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(convertirEnPeticionSchema))
    body: ConvertirEnPeticionInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.convertirEnPeticion(id, body, version);
  }

  /* ─────────── peticiones de ofertas ─────────── */

  @Get('peticiones')
  peticiones(@Query('projectId') projectId?: string) {
    return this.service.peticiones(uuidOpcional(projectId));
  }

  @Get('peticiones/:id')
  peticion(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.peticion(id);
  }

  @Post('peticiones/:id/ofertas')
  @Roles(...ADMINISTRACION)
  @HttpCode(200)
  registrarOferta(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ofertaRegistrarSchema))
    body: OfertaRegistrarInput,
  ) {
    return this.service.registrarOferta(id, body);
  }

  @Post('peticiones/:id/adjudicar')
  @Roles(...ADMINISTRACION)
  @Idempotente()
  @HttpCode(200)
  adjudicar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(adjudicarPeticionSchema))
    body: AdjudicarPeticionInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.adjudicar(id, body, version);
  }

  /* ─────────── pedidos con líneas, recepciones y facturas ─────────── */

  @Get('pedidos')
  pedidos(@Query('projectId') projectId?: string) {
    return this.service.pedidosConLineas(uuidOpcional(projectId));
  }

  @Get('pedidos/:id')
  pedido(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.pedido(id);
  }

  @Post('pedidos')
  @Roles(...ADMINISTRACION)
  @Idempotente()
  crearPedido(
    @Body(new ZodValidationPipe(pedidoLineasCreateSchema))
    body: PedidoLineasCreateInput,
  ) {
    return this.service.crearPedido(body);
  }

  @Post('pedidos/:id/recepciones')
  @Roles('admin', 'gerente', 'administracion', 'obra')
  @Idempotente()
  recibir(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(recepcionCreateSchema))
    body: RecepcionCreateInput,
  ) {
    return this.service.recibir(id, body);
  }

  @Post('pedidos/:id/factura')
  @Roles(...ADMINISTRACION)
  @Idempotente()
  factura(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(facturaPedidoCreateSchema))
    body: FacturaPedidoCreateInput,
  ) {
    return this.service.facturaDePedido(id, body);
  }

  @Get('facturas/:id/cuadre')
  cuadre(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.cuadre(id);
  }
}
