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
  ajusteConsolidacionCreateSchema,
  anularAjusteSchema,
  grupoCreateSchema,
  grupoUpdateSchema,
  miembroCreateSchema,
  miembroUpdateSchema,
  periodoConsolidacionSchema,
  permisoConsolidacionSchema,
  type AjusteConsolidacionCreateInput,
  type AnularAjusteInput,
  type GrupoCreateInput,
  type GrupoUpdateInput,
  type MiembroCreateInput,
  type MiembroUpdateInput,
  type PeriodoConsolidacion,
  type PermisoConsolidacionInput,
} from '@erp/shared';
import { Roles } from '../auth/roles';
import { Idempotente } from '../common/idempotencia/idempotente.decorator';
import { VersionEsperada } from '../common/version';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { HoldingService } from './holding.service';

const cierreSchema = periodoConsolidacionSchema.and(
  z.object({ forzar: z.boolean().optional() }),
);
const fechaQuery = z.object({
  hasta: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: AAAA-MM-DD'),
});

/**
 * Consolidación de grupo / holding. Lectura: admin, gerente, administración y
 * lector (información financiera de grupo, nunca el rol obra). Grupos,
 * miembros, ajustes y cierres: admin y gerente. Permisos de consolidación
 * de la propia sociedad: solo su admin. El acceso a cada sociedad integrada
 * se comprueba en el servicio (`HOLDING_COMPANY_ACCESS_DENIED`).
 */
@Controller('holding')
@Roles('admin', 'gerente', 'administracion', 'lector')
export class HoldingController {
  constructor(private readonly service: HoldingService) {}

  @Get('sociedades')
  sociedades() {
    return this.service.sociedadesAccesibles();
  }

  @Get('permisos')
  @Roles('admin')
  permisos() {
    return this.service.permisos();
  }

  @Post('permisos')
  @Roles('admin')
  @Idempotente()
  conceder(
    @Body(new ZodValidationPipe(permisoConsolidacionSchema))
    body: PermisoConsolidacionInput,
  ) {
    return this.service.conceder(body);
  }

  @Post('permisos/:id/revocar')
  @Roles('admin')
  @HttpCode(200)
  revocar(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.revocar(id);
  }

  @Get('grupos')
  grupos() {
    return this.service.grupos();
  }

  @Post('grupos')
  @Roles('admin', 'gerente')
  @Idempotente()
  crearGrupo(
    @Body(new ZodValidationPipe(grupoCreateSchema)) body: GrupoCreateInput,
  ) {
    return this.service.crearGrupo(body);
  }

  @Get('grupos/:id')
  grupo(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.grupo(id);
  }

  @Patch('grupos/:id')
  @Roles('admin', 'gerente')
  actualizarGrupo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(grupoUpdateSchema)) body: GrupoUpdateInput,
    @VersionEsperada({ exigible: true }) version: number | undefined,
  ) {
    return this.service.actualizarGrupo(id, body, version);
  }

  @Post('grupos/:id/miembros')
  @Roles('admin', 'gerente')
  @Idempotente()
  integrar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(miembroCreateSchema)) body: MiembroCreateInput,
  ) {
    return this.service.integrarSociedad(id, body);
  }

  @Patch('grupos/:id/miembros/:miembroId')
  @Roles('admin', 'gerente')
  actualizarMiembro(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('miembroId', ParseUUIDPipe) miembroId: string,
    @Body(new ZodValidationPipe(miembroUpdateSchema)) body: MiembroUpdateInput,
    @VersionEsperada({ exigible: true }) version: number | undefined,
  ) {
    return this.service.actualizarMiembro(id, miembroId, body, version);
  }

  /** Balance y PyG consolidados del periodo (`desde`–`hasta`). */
  @Get('grupos/:id/estados')
  estados(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(periodoConsolidacionSchema))
    q: PeriodoConsolidacion,
  ) {
    return this.service.estados(id, q);
  }

  @Get('grupos/:id/intercompania')
  intercompania(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(periodoConsolidacionSchema))
    q: PeriodoConsolidacion,
  ) {
    return this.service.intercompania(id, q);
  }

  /** Liquidez, cartera de cobros y pagos externos y obras del grupo a una fecha. */
  @Get('grupos/:id/tesoreria')
  tesoreria(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(fechaQuery)) q: { hasta: string },
  ) {
    return this.service.tesoreria(id, q.hasta);
  }

  @Get('grupos/:id/ajustes')
  ajustes(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.ajustes(id);
  }

  @Post('grupos/:id/ajustes')
  @Roles('admin', 'gerente')
  @Idempotente()
  crearAjuste(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ajusteConsolidacionCreateSchema))
    body: AjusteConsolidacionCreateInput,
  ) {
    return this.service.crearAjuste(id, body);
  }

  @Post('grupos/:id/ajustes/:ajusteId/anular')
  @Roles('admin', 'gerente')
  @Idempotente()
  @HttpCode(200)
  anularAjuste(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ajusteId', ParseUUIDPipe) ajusteId: string,
    @Body(new ZodValidationPipe(anularAjusteSchema)) body: AnularAjusteInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.anularAjuste(id, ajusteId, body, version);
  }

  @Get('grupos/:id/cierres')
  cierres(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.cierres(id);
  }

  @Post('grupos/:id/cierres')
  @Roles('admin', 'gerente')
  @Idempotente()
  cerrar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cierreSchema))
    body: PeriodoConsolidacion & { forzar?: boolean },
  ) {
    return this.service.cerrar(id, body);
  }
}
