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
  StoppageCreateInput,
  StoppageUpdateInput,
  stoppageCreateSchema,
  stoppageUpdateSchema,
} from '@erp/shared';
import { RequireCapability } from '../auth/auth.decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { StoppagesService } from './stoppages.service';

@Controller('stoppages')
export class StoppagesController {
  constructor(private readonly service: StoppagesService) {}

  @Get()
  list(@Query('projectId') projectId?: string) {
    return this.service.list(projectId || undefined);
  }

  /** Todas las paradas de una obra, como van a la ficha mensual. */
  @Get('informe/:projectId')
  report(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.service.report(projectId);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @RequireCapability('paradas.gestionar')
  @Post()
  create(
    @Body(new ZodValidationPipe(stoppageCreateSchema))
    body: StoppageCreateInput,
  ) {
    return this.service.create(body);
  }

  @RequireCapability('paradas.gestionar')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(stoppageUpdateSchema))
    body: StoppageUpdateInput,
  ) {
    return this.service.update(id, body);
  }

  @RequireCapability('paradas.gestionar')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.remove(id);
  }
}
