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
  EquipoCreateInput,
  EquipoUpdateInput,
  MantenimientoCreateInput,
  MantenimientoUpdateInput,
  equipoCreateSchema,
  equipoUpdateSchema,
  mantenimientoCreateSchema,
  mantenimientoUpdateSchema,
} from '@erp/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { EquiposService } from './equipos.service';

@Controller('equipos')
export class EquiposController {
  constructor(private readonly service: EquiposService) {}

  @Get()
  list(
    @Query('estado') estado?: string,
    @Query('ownership') ownership?: string,
  ) {
    return this.service.list({ estado, ownership });
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(equipoCreateSchema)) body: EquipoCreateInput,
  ) {
    return this.service.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(equipoUpdateSchema)) body: EquipoUpdateInput,
  ) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.remove(id);
  }

  @Get(':id/mantenimientos')
  listMantenimientos(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.listMantenimientos(id);
  }

  @Post('mantenimientos')
  createMantenimiento(
    @Body(new ZodValidationPipe(mantenimientoCreateSchema))
    body: MantenimientoCreateInput,
  ) {
    return this.service.createMantenimiento(body);
  }

  @Patch('mantenimientos/:id')
  updateMantenimiento(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(mantenimientoUpdateSchema))
    body: MantenimientoUpdateInput,
  ) {
    return this.service.updateMantenimiento(id, body);
  }

  @Delete('mantenimientos/:id')
  @HttpCode(204)
  async removeMantenimiento(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.removeMantenimiento(id);
  }
}
