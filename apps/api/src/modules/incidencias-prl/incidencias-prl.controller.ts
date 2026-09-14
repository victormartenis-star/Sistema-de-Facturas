import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  IncidenciaPRLCreateInput,
  IncidenciaPRLEstado,
  IncidenciaPRLUpdateInput,
  incidenciaPRLCreateSchema,
  incidenciaPRLUpdateSchema,
} from '@erp/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { IncidenciasPRLService } from './incidencias-prl.service';

@Controller('incidencias-prl')
export class IncidenciasPRLController {
  constructor(private readonly service: IncidenciasPRLService) {}

  @Get()
  list(
    @Query('projectId') projectId?: string,
    @Query('estado') estado?: IncidenciaPRLEstado,
  ) {
    return this.service.list(projectId, estado);
  }

  /** Incidencias abiertas o en subsanación cuyo plazo ya venció. */
  @Get('fuera-de-plazo')
  fueraDePlazo(@Query('projectId') projectId?: string) {
    return this.service.fueraDePlazo(projectId);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(incidenciaPRLCreateSchema))
    body: IncidenciaPRLCreateInput,
  ) {
    return this.service.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(incidenciaPRLUpdateSchema))
    body: IncidenciaPRLUpdateInput,
  ) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
