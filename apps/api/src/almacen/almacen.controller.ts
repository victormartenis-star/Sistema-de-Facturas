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
import {
  almacenCreateSchema,
  almacenUpdateSchema,
  articuloCreateSchema,
  articuloUpdateSchema,
  consumoObraSchema,
  devolucionObraSchema,
  entradaStockSchema,
  existenciaUpdateSchema,
  existenciasQuerySchema,
  movimientosQuerySchema,
  regularizacionStockSchema,
  traspasoStockSchema,
  type AlmacenCreateInput,
  type AlmacenUpdateInput,
  type ArticuloCreateInput,
  type ArticuloUpdateInput,
  type ConsumoObraInput,
  type DevolucionObraInput,
  type EntradaStockInput,
  type ExistenciasQuery,
  type ExistenciaUpdateInput,
  type MovimientosQuery,
  type RegularizacionStockInput,
  type TraspasoStockInput,
} from '@erp/shared';
import { Roles } from '../auth/roles';
import { Idempotente } from '../common/idempotencia/idempotente.decorator';
import { VersionEsperada } from '../common/version';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AlmacenService } from './almacen.service';

function booleano(v?: string): boolean | undefined {
  return v === 'true' ? true : v === 'false' ? false : undefined;
}

/**
 * Almacén y stock. Lectura: internos y lector (el rol obra, limitado a los
 * centrales y a los acopios de sus obras). Maestros, entradas y
 * regularizaciones: admin, gerente y administración. Consumos, devoluciones y
 * traspasos: además el jefe de obra, sobre sus obras.
 */
@Controller('almacen')
@Roles('admin', 'gerente', 'administracion', 'obra', 'lector')
export class AlmacenController {
  constructor(private readonly service: AlmacenService) {}

  @Get('resumen')
  resumen() {
    return this.service.resumen();
  }

  /* ─── almacenes ─── */

  @Get('almacenes')
  listarAlmacenes(@Query('activo') activo?: string) {
    return this.service.listarAlmacenes({ activo: booleano(activo) });
  }

  @Post('almacenes')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  crearAlmacen(
    @Body(new ZodValidationPipe(almacenCreateSchema)) body: AlmacenCreateInput,
  ) {
    return this.service.crearAlmacen(body);
  }

  @Patch('almacenes/:id')
  @Roles('admin', 'gerente', 'administracion')
  actualizarAlmacen(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(almacenUpdateSchema)) body: AlmacenUpdateInput,
    @VersionEsperada({ exigible: true }) version: number | undefined,
  ) {
    return this.service.actualizarAlmacen(id, body, version);
  }

  /* ─── artículos ─── */

  @Get('articulos')
  listarArticulos(@Query('q') q?: string, @Query('activo') activo?: string) {
    return this.service.listarArticulos({
      q: q?.trim().slice(0, 80) || undefined,
      activo: booleano(activo),
    });
  }

  @Post('articulos')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  crearArticulo(
    @Body(new ZodValidationPipe(articuloCreateSchema))
    body: ArticuloCreateInput,
  ) {
    return this.service.crearArticulo(body);
  }

  @Patch('articulos/:id')
  @Roles('admin', 'gerente', 'administracion')
  actualizarArticulo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(articuloUpdateSchema))
    body: ArticuloUpdateInput,
    @VersionEsperada({ exigible: true }) version: number | undefined,
  ) {
    return this.service.actualizarArticulo(id, body, version);
  }

  /* ─── existencias ─── */

  @Get('existencias')
  existencias(
    @Query(new ZodValidationPipe(existenciasQuerySchema)) q: ExistenciasQuery,
  ) {
    return this.service.existencias(q);
  }

  /** Stock mínimo (alerta de reposición) de un saldo. */
  @Patch('existencias/:id')
  @Roles('admin', 'gerente', 'administracion')
  actualizarExistencia(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(existenciaUpdateSchema))
    body: ExistenciaUpdateInput,
    @VersionEsperada({ exigible: true }) version: number | undefined,
  ) {
    return this.service.actualizarExistencia(id, body, version);
  }

  /* ─── movimientos ─── */

  @Get('movimientos')
  movimientos(
    @Query(new ZodValidationPipe(movimientosQuerySchema)) q: MovimientosQuery,
  ) {
    return this.service.movimientos(q);
  }

  @Post('entradas')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  entrada(
    @Body(new ZodValidationPipe(entradaStockSchema)) body: EntradaStockInput,
  ) {
    return this.service.entrada(body);
  }

  @Post('consumos')
  @Roles('admin', 'gerente', 'administracion', 'obra')
  @Idempotente()
  consumo(
    @Body(new ZodValidationPipe(consumoObraSchema)) body: ConsumoObraInput,
  ) {
    return this.service.consumo(body);
  }

  @Post('devoluciones')
  @Roles('admin', 'gerente', 'administracion', 'obra')
  @Idempotente()
  devolucion(
    @Body(new ZodValidationPipe(devolucionObraSchema))
    body: DevolucionObraInput,
  ) {
    return this.service.devolucion(body);
  }

  /** `If-Match` (opcional): versión del saldo de origen. */
  @Post('traspasos')
  @Roles('admin', 'gerente', 'administracion', 'obra')
  @Idempotente()
  traspaso(
    @Body(new ZodValidationPipe(traspasoStockSchema)) body: TraspasoStockInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.traspaso(body, version);
  }

  /** `If-Match` (opcional): versión del saldo leída al contar. */
  @Post('regularizaciones')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  regularizacion(
    @Body(new ZodValidationPipe(regularizacionStockSchema))
    body: RegularizacionStockInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.regularizacion(body, version);
  }

  /** Coste de material imputado a una obra (consumos − devoluciones). */
  @Get('obras/:projectId/consumos')
  consumosObra(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.service.consumosObra(projectId);
  }
}
