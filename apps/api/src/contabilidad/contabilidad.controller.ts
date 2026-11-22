import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ORIGENES_ASIENTO,
  OrigenAsiento,
  asientoAnularSchema,
  asientoCreateSchema,
  cuentaCreateSchema,
  cuentaUpdateSchema,
  type AsientoAnularInput,
  type AsientoCreateInput,
  type CuentaCreateInput,
  type CuentaUpdateInput,
} from '@erp/shared';
import { Roles } from '../auth/roles';
import { Idempotente } from '../common/idempotencia/idempotente.decorator';
import { VersionEsperada } from '../common/version';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ContabilidadService } from './contabilidad.service';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fecha = (v?: string) => (ISO_DATE.test(v ?? '') ? v : undefined);
const uuid = (v?: string) => (UUID.test(v ?? '') ? v : undefined);

/**
 * Contabilidad general. Lectura: administración, gerencia y lector; las
 * mutaciones, solo admin/gerente/administración (cerrar y reabrir períodos,
 * admin/gerente). El rol obra no ve la contabilidad de la empresa.
 */
@Controller('contabilidad')
@Roles('admin', 'gerente', 'administracion', 'lector')
export class ContabilidadController {
  constructor(private readonly service: ContabilidadService) {}

  /* plan de cuentas */

  @Get('cuentas')
  cuentas(@Query('q') q?: string, @Query('imputables') imputables?: string) {
    return this.service.listarCuentas({
      q: q?.trim().slice(0, 80) || undefined,
      soloImputables: imputables === 'true',
    });
  }

  @Post('cuentas/inicializar')
  @Roles('admin', 'gerente', 'administracion')
  @HttpCode(200)
  inicializar() {
    return this.service.inicializarPlan();
  }

  @Post('cuentas')
  @Roles('admin', 'gerente', 'administracion')
  crearCuenta(
    @Body(new ZodValidationPipe(cuentaCreateSchema)) body: CuentaCreateInput,
  ) {
    return this.service.crearCuenta(body);
  }

  @Patch('cuentas/:id')
  @Roles('admin', 'gerente', 'administracion')
  actualizarCuenta(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cuentaUpdateSchema)) body: CuentaUpdateInput,
    @VersionEsperada({ exigible: true }) version: number | undefined,
  ) {
    return this.service.actualizarCuenta(id, body, version);
  }

  /* asientos (libro diario) */

  @Get('asientos')
  asientos(
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('origen') origen?: string,
    @Query('projectId') projectId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.listarAsientos({
      desde: fecha(desde),
      hasta: fecha(hasta),
      origen: ORIGENES_ASIENTO.includes(origen as OrigenAsiento)
        ? (origen as OrigenAsiento)
        : undefined,
      projectId: uuid(projectId),
      limit: Math.min(Math.max(Number(limit) || 50, 1), 200),
      offset: Math.max(Number(offset) || 0, 0),
    });
  }

  @Get('asientos/:id')
  asiento(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.obtenerAsiento(id);
  }

  @Post('asientos')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  crearAsiento(
    @Body(new ZodValidationPipe(asientoCreateSchema)) body: AsientoCreateInput,
  ) {
    return this.service.crearAsientoManual(body);
  }

  @Post('asientos/:id/anular')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  anular(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(asientoAnularSchema)) body: AsientoAnularInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.anularAsiento(id, body, version);
  }

  /** Interfaz contable: contabiliza facturas y cobros/pagos pendientes. */
  @Post('interfaz/contabilizar')
  @Roles('admin', 'gerente', 'administracion')
  @HttpCode(200)
  contabilizarPendientes() {
    return this.service.contabilizarPendientes();
  }

  /* informes */

  @Get('mayor/:cuenta')
  mayor(
    @Param('cuenta') cuenta: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.service.libroMayor({
      cuenta: cuenta.trim(),
      desde: fecha(desde),
      hasta: fecha(hasta),
      projectId: uuid(projectId),
    });
  }

  @Get('sumas-saldos')
  sumasSaldos(
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.service.sumasSaldos({
      desde: fecha(desde),
      hasta: fecha(hasta),
      projectId: uuid(projectId),
    });
  }

  /* períodos */

  @Get('periodos/:ejercicio')
  periodos(@Param('ejercicio', ParseIntPipe) ejercicio: number) {
    return this.service.periodos(ejercicio);
  }

  @Post('periodos/:ejercicio/:mes/cerrar')
  @Roles('admin', 'gerente')
  @HttpCode(200)
  cerrar(
    @Param('ejercicio', ParseIntPipe) ejercicio: number,
    @Param('mes', ParseIntPipe) mes: number,
  ) {
    return this.service.cambiarEstadoPeriodo(ejercicio, mes, 'cerrado');
  }

  @Post('periodos/:ejercicio/:mes/reabrir')
  @Roles('admin', 'gerente')
  @HttpCode(200)
  reabrir(
    @Param('ejercicio', ParseIntPipe) ejercicio: number,
    @Param('mes', ParseIntPipe) mes: number,
  ) {
    return this.service.cambiarEstadoPeriodo(ejercicio, mes, 'abierto');
  }
}
