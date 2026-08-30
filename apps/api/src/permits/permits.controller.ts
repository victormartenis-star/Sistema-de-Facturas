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
  PermitCreateInput,
  PermitUpdateInput,
  permitCreateSchema,
  permitUpdateSchema,
} from '@erp/shared';
import { RequireCapability } from '../auth/auth.decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PermitsService } from './permits.service';

@RequireCapability('tramites.gestionar')
@Controller('permits')
export class PermitsController {
  constructor(private readonly service: PermitsService) {}

  @Get()
  list(@Query('projectId') projectId?: string) {
    return this.service.list(projectId || undefined);
  }

  /** Trámites en ámbar o rojo de todas las obras, para la reunión mensual. */
  @Get('avisos')
  alerts() {
    return this.service.alerts();
  }

  /** Semáforo de una obra, tal y como se lleva a la ficha mensual. */
  @Get('semaforo/:projectId')
  board(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.service.board(projectId);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(permitCreateSchema)) body: PermitCreateInput,
  ) {
    return this.service.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(permitUpdateSchema)) body: PermitUpdateInput,
  ) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.remove(id);
  }
}
