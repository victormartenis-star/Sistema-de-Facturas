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
  CATEGORIAS_ACTIVO,
  ESTADOS_ACTIVO,
  activoBajaSchema,
  activoCreateSchema,
  activoUpdateSchema,
  amortizarSchema,
  type ActivoBajaInput,
  type ActivoCreateInput,
  type ActivoUpdateInput,
  type AmortizarInput,
  type CategoriaActivo,
  type EstadoActivo,
} from '@erp/shared';
import { Roles } from '../auth/roles';
import { Idempotente } from '../common/idempotencia/idempotente.decorator';
import { VersionEsperada } from '../common/version';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ActivosService } from './activos.service';

/**
 * Activos fijos y amortización. Lectura: administración, gerencia y lector;
 * mutaciones: admin, gerente y administración (como la contabilidad).
 */
@Controller('activos')
@Roles('admin', 'gerente', 'administracion', 'lector')
export class ActivosController {
  constructor(private readonly service: ActivosService) {}

  @Get()
  listar(
    @Query('estado') estado?: string,
    @Query('categoria') categoria?: string,
    @Query('q') q?: string,
  ) {
    return this.service.listar({
      estado: ESTADOS_ACTIVO.includes(estado as EstadoActivo)
        ? (estado as EstadoActivo)
        : undefined,
      categoria: CATEGORIAS_ACTIVO.includes(categoria as CategoriaActivo)
        ? (categoria as CategoriaActivo)
        : undefined,
      q: q?.trim().slice(0, 80) || undefined,
    });
  }

  @Get(':id')
  detalle(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.detalle(id);
  }

  @Post()
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  crear(
    @Body(new ZodValidationPipe(activoCreateSchema)) body: ActivoCreateInput,
  ) {
    return this.service.crear(body);
  }

  @Patch(':id')
  @Roles('admin', 'gerente', 'administracion')
  actualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(activoUpdateSchema)) body: ActivoUpdateInput,
    @VersionEsperada({ exigible: true }) version: number | undefined,
  ) {
    return this.service.actualizar(id, body, version);
  }

  /** Contabiliza las cuotas pendientes de todos los activos hasta un mes (idempotente). */
  @Post('amortizar')
  @Roles('admin', 'gerente', 'administracion')
  @HttpCode(200)
  amortizar(
    @Body(new ZodValidationPipe(amortizarSchema)) body: AmortizarInput,
  ) {
    return this.service.amortizar(body);
  }

  /** Baja (venta o desguace) con su asiento de resultado. */
  @Post(':id/baja')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  baja(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(activoBajaSchema)) body: ActivoBajaInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.baja(id, body, version);
  }
}
