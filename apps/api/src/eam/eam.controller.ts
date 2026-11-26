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
import { z } from 'zod';
import {
  asignacionCerrarSchema,
  asignacionCreateSchema,
  explotacionQuerySchema,
  fichaEquipoSchema,
  lecturaContadorSchema,
  ordenAccionSchema,
  ordenCreateSchema,
  ordenesQuerySchema,
  planCreateSchema,
  planUpdateSchema,
  type AsignacionCreateInput,
  type ExplotacionQuery,
  type FichaEquipoInput,
  type LecturaContadorInput,
  type OrdenAccionInput,
  type OrdenCreateInput,
  type OrdenesQuery,
  type PlanCreateInput,
  type PlanUpdateInput,
} from '@erp/shared';
import { Roles } from '../auth/roles';
import { Idempotente } from '../common/idempotencia/idempotente.decorator';
import { VersionEsperada } from '../common/version';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { EquiposEamService } from './equipos-eam.service';
import { ExplotacionService } from './explotacion.service';
import { OrdenesService } from './ordenes.service';

const generarSchema = z.object({
  fecha: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/**
 * Enterprise Asset Management de maquinaria. Lectura: admin, gerente,
 * administración, lector y obra (solo equipos y órdenes de sus obras).
 * Ficha, asignaciones, planes y transiciones de órdenes: admin, gerente y
 * administración. Lecturas de contador y avisos de avería: también obra.
 */
@Controller('eam')
@Roles('admin', 'gerente', 'administracion', 'lector', 'obra')
export class EamController {
  constructor(
    private readonly equipos: EquiposEamService,
    private readonly ordenes: OrdenesService,
    private readonly explotacionService: ExplotacionService,
  ) {}

  @Get('equipos')
  listar(@Query('projectId') projectId?: string) {
    return this.equipos.listar(projectId || undefined);
  }

  @Get('equipos/:id')
  detalle(@Param('id', ParseUUIDPipe) id: string) {
    return this.equipos.detalle(id);
  }

  @Patch('equipos/:id/ficha')
  @Roles('admin', 'gerente', 'administracion')
  ficha(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(fichaEquipoSchema)) body: FichaEquipoInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.equipos.ficha(id, body, version);
  }

  @Get('equipos/:id/lecturas')
  lecturas(@Param('id', ParseUUIDPipe) id: string) {
    return this.equipos.lecturas(id);
  }

  @Post('equipos/:id/lecturas')
  @Roles('admin', 'gerente', 'administracion', 'obra')
  @Idempotente()
  registrarLectura(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(lecturaContadorSchema))
    body: LecturaContadorInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.equipos.registrarLectura(id, body, version);
  }

  @Get('equipos/:id/asignaciones')
  asignaciones(@Param('id', ParseUUIDPipe) id: string) {
    return this.equipos.asignaciones(id);
  }

  @Post('equipos/:id/asignaciones')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  asignar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(asignacionCreateSchema))
    body: AsignacionCreateInput,
  ) {
    return this.equipos.asignar(id, body);
  }

  @Post('asignaciones/:id/cerrar')
  @Roles('admin', 'gerente', 'administracion')
  @HttpCode(200)
  cerrarAsignacion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(asignacionCerrarSchema))
    body: { hasta: string },
    @VersionEsperada() version: number | undefined,
  ) {
    return this.equipos.cerrarAsignacion(id, body.hasta, version);
  }

  @Get('equipos/:id/planes')
  planes(@Param('id', ParseUUIDPipe) id: string) {
    return this.equipos.planes(id);
  }

  @Post('equipos/:id/planes')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  crearPlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(planCreateSchema)) body: PlanCreateInput,
  ) {
    return this.equipos.crearPlan(id, body);
  }

  @Patch('planes/:id')
  @Roles('admin', 'gerente', 'administracion')
  actualizarPlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(planUpdateSchema)) body: PlanUpdateInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.equipos.actualizarPlan(id, body, version);
  }

  /** Órdenes preventivas de los planes vencidos o próximos sin orden viva. */
  @Post('planes/generar-ordenes')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  generar(
    @Body(new ZodValidationPipe(generarSchema)) body: { fecha?: string },
  ) {
    return this.ordenes.generarDesdePlanes(body.fecha);
  }

  @Get('ordenes')
  listarOrdenes(
    @Query(new ZodValidationPipe(ordenesQuerySchema)) q: OrdenesQuery,
  ) {
    return this.ordenes.listar(q);
  }

  @Get('ordenes/:id')
  orden(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordenes.detalle(id);
  }

  @Post('ordenes')
  @Roles('admin', 'gerente', 'administracion', 'obra')
  @Idempotente()
  crearOrden(
    @Body(new ZodValidationPipe(ordenCreateSchema)) body: OrdenCreateInput,
  ) {
    return this.ordenes.crear(body);
  }

  @Post('ordenes/:id/acciones')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  accion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ordenAccionSchema)) body: OrdenAccionInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.ordenes.accion(id, body, version);
  }

  /** Disponibilidad y coste de explotación por equipo y obra. */
  @Get('explotacion')
  explotacion(
    @Query(new ZodValidationPipe(explotacionQuerySchema)) q: ExplotacionQuery,
  ) {
    return this.explotacionService.explotacion(q);
  }
}
