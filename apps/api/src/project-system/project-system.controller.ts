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
  anularLiberacionSchema,
  liberacionRetencionSchema,
  modificadoSubcontrataSchema,
  type AnularLiberacionInput,
  type LiberacionRetencionInput,
  type ModificadoSubcontrataInput,
} from '@erp/shared';
import { Roles } from '../auth/roles';
import { Idempotente } from '../common/idempotencia/idempotente.decorator';
import { VersionEsperada } from '../common/version';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ProjectSystemService } from './project-system.service';

const ADMINISTRACION = ['admin', 'gerente', 'administracion'] as const;

/**
 * Project System: retenciones de garantía por obra, su liberación por hito o
 * sustitución con aval, y modificados del contrato de subcontrata. Lectura:
 * también el jefe de obra (sus obras) y el lector; operaciones: admin,
 * gerente y administración.
 */
@Controller('project-system')
@Roles('admin', 'gerente', 'administracion', 'obra', 'lector')
export class ProjectSystemController {
  constructor(private readonly service: ProjectSystemService) {}

  @Get('obras/:projectId/retenciones')
  retenciones(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('fecha') fecha?: string,
  ) {
    return this.service.retenciones(
      projectId,
      fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : undefined,
    );
  }

  @Get('obras/:projectId/liberaciones')
  liberaciones(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.service.liberaciones(projectId);
  }

  @Post('obras/:projectId/liberaciones')
  @Roles(...ADMINISTRACION)
  @Idempotente()
  liberar(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(new ZodValidationPipe(liberacionRetencionSchema))
    body: LiberacionRetencionInput,
  ) {
    return this.service.liberar(projectId, body);
  }

  @Post('liberaciones/:id/anular')
  @Roles(...ADMINISTRACION)
  @HttpCode(200)
  anular(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(anularLiberacionSchema))
    body: AnularLiberacionInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.anularLiberacion(id, body, version);
  }

  @Get('subcontratas/:contratoId/modificados')
  modificados(@Param('contratoId', ParseUUIDPipe) contratoId: string) {
    return this.service.modificados(contratoId);
  }

  @Post('subcontratas/:contratoId/modificados')
  @Roles(...ADMINISTRACION)
  @Idempotente()
  crearModificado(
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
    @Body(new ZodValidationPipe(modificadoSubcontrataSchema))
    body: ModificadoSubcontrataInput,
  ) {
    return this.service.crearModificado(contratoId, body);
  }
}
