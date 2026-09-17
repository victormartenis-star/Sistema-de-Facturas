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
  TrabajadorCreateInput,
  TrabajadorUpdateInput,
  trabajadorCreateSchema,
  trabajadorUpdateSchema,
} from '@erp/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { TrabajadoresService } from './trabajadores.service';

@Controller('trabajadores')
export class TrabajadoresController {
  constructor(private readonly service: TrabajadoresService) {}

  @Get()
  list(@Query('activo') activo?: string, @Query('tipo') tipo?: string) {
    return this.service.list({
      activo: activo === undefined ? undefined : activo === 'true',
      tipo,
    });
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(trabajadorCreateSchema))
    body: TrabajadorCreateInput,
  ) {
    return this.service.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(trabajadorUpdateSchema))
    body: TrabajadorUpdateInput,
  ) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.remove(id);
  }
}
