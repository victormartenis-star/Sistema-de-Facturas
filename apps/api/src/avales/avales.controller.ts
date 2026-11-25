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
  devengoAnularSchema,
  devengoAutomaticoSchema,
  type DevengoAutomaticoInput,
  devengoAvalesQuerySchema,
  devengoAvalesSchema,
  lineaAvalCreateSchema,
  lineaAvalUpdateSchema,
  type DevengoAnularInput,
  type DevengoAvalesInput,
  type DevengoAvalesQuery,
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
import { DevengoAvalesService } from './devengo-avales.service';

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
  constructor(
    private readonly service: AvalesService,
    private readonly devengo: DevengoAvalesService,
  ) {}

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

  /** Devengos mensuales de comisiones (por periodo o aval). */
  @Get('devengos')
  devengos(
    @Query(new ZodValidationPipe(devengoAvalesQuerySchema))
    q: DevengoAvalesQuery,
  ) {
    return this.devengo.listar(q);
  }

  /** Ejecuciones del devengo (manuales y programadas), más recientes primero. */
  @Get('devengos/ejecuciones')
  ejecucionesDevengo() {
    return this.devengo.ejecuciones();
  }

  /**
   * Lotes del devengo automático (endpoint y tarea programada) con los avisos
   * de los meses omitidos o saltados y su motivo, más recientes primero.
   */
  @Get('devengos/lotes')
  lotesDevengo() {
    return this.devengo.lotes();
  }

  /**
   * Devengo automático de todos los meses terminados pendientes hasta
   * `hasta` (por defecto, el mes anterior). Idempotente; lo ejecuta también
   * la tarea programada del día 1.
   */
  @Post('devengos/automatico')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  devengoAutomatico(
    @Body(new ZodValidationPipe(devengoAutomaticoSchema))
    body: DevengoAutomaticoInput,
  ) {
    return this.devengo.automatico(body, 'manual');
  }

  /** Devenga un mes: un aval o todos los emitidos vivos con tasa. */
  @Post('devengos')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  devengar(
    @Body(new ZodValidationPipe(devengoAvalesSchema)) body: DevengoAvalesInput,
  ) {
    return this.devengo.devengar(body);
  }

  @Post('devengos/:id/anular')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  anularDevengo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(devengoAnularSchema)) body: DevengoAnularInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.devengo.anular(id, body, version);
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
