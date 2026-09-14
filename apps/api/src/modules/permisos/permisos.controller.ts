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
  PermisoCreateInput,
  PermisoStatus,
  PermisoUpdateInput,
  permisoCreateSchema,
  permisoUpdateSchema,
} from '@erp/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { PermisosService } from './permisos.service';

@Controller('permisos')
export class PermisosController {
  constructor(private readonly service: PermisosService) {}

  /** Lista permisos, opcionalmente filtrados por obra y/o estado. */
  @Get()
  list(
    @Query('projectId') projectId?: string,
    @Query('status') status?: PermisoStatus,
  ) {
    return this.service.list(projectId, status);
  }

  /** Permisos concedidos vencidos o próximos a caducar. */
  @Get('alertas')
  alertas(@Query('projectId') projectId?: string) {
    return this.service.alertas(projectId);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(permisoCreateSchema))
    body: PermisoCreateInput,
  ) {
    return this.service.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(permisoUpdateSchema))
    body: PermisoUpdateInput,
  ) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
