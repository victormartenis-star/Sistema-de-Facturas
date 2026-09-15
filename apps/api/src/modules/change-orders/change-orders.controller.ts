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
  ChangeOrderCreateInput,
  ChangeOrderEnviarInput,
  ChangeOrderResolverInput,
  ChangeOrderUpdateInput,
  changeOrderCreateSchema,
  changeOrderEnviarSchema,
  changeOrderResolverSchema,
  changeOrderUpdateSchema,
} from '@erp/shared';
import { Roles } from '../../auth/roles';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ChangeOrdersService } from './change-orders.service';

@Controller('change-orders')
export class ChangeOrdersController {
  constructor(private readonly service: ChangeOrdersService) {}

  @Get()
  list(
    @Query('projectId') projectId?: string,
    @Query('estado') estado?: string,
  ) {
    return this.service.list({ projectId, estado });
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Post()
  @Roles('admin', 'gerente', 'administracion', 'obra')
  create(
    @Body(new ZodValidationPipe(changeOrderCreateSchema))
    body: ChangeOrderCreateInput,
  ) {
    return this.service.create(body);
  }

  @Patch(':id')
  @Roles('admin', 'gerente', 'administracion', 'obra')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(changeOrderUpdateSchema))
    body: ChangeOrderUpdateInput,
  ) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @Roles('admin', 'gerente', 'administracion', 'obra')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.remove(id);
  }

  /** Envía el borrador a la Dirección Facultativa. */
  @Post(':id/enviar')
  @Roles('admin', 'gerente', 'administracion', 'obra')
  enviar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(changeOrderEnviarSchema))
    body: ChangeOrderEnviarInput,
  ) {
    return this.service.enviar(id, body);
  }

  /** Resolución de la Dirección Facultativa: aprueba o rechaza — la registra el staff interno, no la DF directamente. */
  @Post(':id/resolver')
  @Roles('admin', 'gerente', 'administracion')
  resolver(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(changeOrderResolverSchema))
    body: ChangeOrderResolverInput,
  ) {
    return this.service.resolver(id, body);
  }
}
