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
  avalAnularSchema,
  avalComisionSchema,
  avalCreateSchema,
  avalEjecutarSchema,
  avalLiberarSchema,
  avalProrrogaSchema,
  avalUpdateSchema,
  avalVencerSchema,
  avalesAvisosSchema,
  avalesQuerySchema,
  avalesResumenQuerySchema,
  lineaAvalCreateSchema,
  lineaAvalUpdateSchema,
  type LineaAvalCreateInput,
  type LineaAvalUpdateInput,
  type AvalAnularInput,
  type AvalComisionInput,
  type AvalCreateInput,
  type AvalEjecutarInput,
  type AvalesAvisosInput,
  type AvalesQuery,
  type AvalesResumenQuery,
  type AvalLiberarInput,
  type AvalProrrogaInput,
  type AvalUpdateInput,
  type AvalVencerInput,
} from '@erp/shared';
import { Roles } from '../auth/roles';
import { Idempotente } from '../common/idempotencia/idempotente.decorator';
import { VersionEsperada } from '../common/version';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AvalesService } from './avales.service';

/**
 * Avales bancarios y garantías. Lectura: admin, gerente, administración,
 * lector y obra (este, solo los avales de sus obras). Alta, edición y
 * movimientos (liberar, ejecutar, prorrogar, comisión, vencer, anular):
 * admin, gerente y administración. Las acciones POST admiten
 * `Idempotency-Key` e `If-Match` (opcional); el PATCH exige `If-Match`.
 */
@Controller('avales')
@Roles('admin', 'gerente', 'administracion', 'lector', 'obra')
export class AvalesController {
  constructor(private readonly service: AvalesService) {}

  @Get()
  listar(@Query(new ZodValidationPipe(avalesQuerySchema)) q: AvalesQuery) {
    return this.service.listar(q);
  }

  /** Exposición viva por dirección y próximos vencimientos. */
  @Get('resumen')
  resumen(
    @Query(new ZodValidationPipe(avalesResumenQuerySchema))
    q: AvalesResumenQuery,
  ) {
    return this.service.resumen(q);
  }

  /** Líneas de avales por entidad con dispuesto, disponible y % de uso. */
  @Get('lineas')
  lineas() {
    return this.service.listarLineas();
  }

  @Post('lineas')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  crearLinea(
    @Body(new ZodValidationPipe(lineaAvalCreateSchema))
    body: LineaAvalCreateInput,
  ) {
    return this.service.crearLinea(body);
  }

  @Patch('lineas/:id')
  @Roles('admin', 'gerente', 'administracion')
  actualizarLinea(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(lineaAvalUpdateSchema))
    body: LineaAvalUpdateInput,
    @VersionEsperada({ exigible: true }) version: number | undefined,
  ) {
    return this.service.actualizarLinea(id, body, version);
  }

  @Get(':id')
  detalle(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.detalle(id);
  }

  @Post()
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  crear(@Body(new ZodValidationPipe(avalCreateSchema)) body: AvalCreateInput) {
    return this.service.crear(body);
  }

  /** Avisos de vencimiento en la bandeja (deduplicados por aval y fecha). */
  @Post('avisos-vencimiento')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  avisos(
    @Body(new ZodValidationPipe(avalesAvisosSchema)) body: AvalesAvisosInput,
  ) {
    return this.service.avisosVencimiento(body);
  }

  @Patch(':id')
  @Roles('admin', 'gerente', 'administracion')
  actualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(avalUpdateSchema)) body: AvalUpdateInput,
    @VersionEsperada({ exigible: true }) version: number | undefined,
  ) {
    return this.service.actualizar(id, body, version);
  }

  @Post(':id/liberar')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  liberar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(avalLiberarSchema)) body: AvalLiberarInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.liberar(id, body, version);
  }

  @Post(':id/ejecutar')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  ejecutar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(avalEjecutarSchema)) body: AvalEjecutarInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.ejecutar(id, body, version);
  }

  @Post(':id/prorrogar')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  prorrogar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(avalProrrogaSchema)) body: AvalProrrogaInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.prorrogar(id, body, version);
  }

  @Post(':id/comision')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  comision(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(avalComisionSchema)) body: AvalComisionInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.comision(id, body, version);
  }

  @Post(':id/vencer')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  vencer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(avalVencerSchema)) body: AvalVencerInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.vencer(id, body, version);
  }

  @Post(':id/anular')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  anular(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(avalAnularSchema)) body: AvalAnularInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.anular(id, body, version);
  }
}
