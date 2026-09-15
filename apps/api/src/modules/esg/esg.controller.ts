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
  EsgFactorCreateInput,
  EsgFactorUpdateInput,
  EsgRegistroCreateInput,
  EsgRegistroUpdateInput,
  esgFactorCreateSchema,
  esgFactorUpdateSchema,
  esgRegistroCreateSchema,
  esgRegistroUpdateSchema,
} from '@erp/shared';
import { Roles } from '../../auth/roles';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { EsgService } from './esg.service';

@Controller('esg')
export class EsgController {
  constructor(private readonly service: EsgService) {}

  @Get('factores')
  listFactores(@Query('activo') activo?: string) {
    return this.service.listFactores(
      activo === undefined ? undefined : activo === 'true',
    );
  }

  @Post('factores')
  @Roles('admin', 'gerente')
  createFactor(
    @Body(new ZodValidationPipe(esgFactorCreateSchema))
    body: EsgFactorCreateInput,
  ) {
    return this.service.createFactor(body);
  }

  @Patch('factores/:id')
  @Roles('admin', 'gerente')
  updateFactor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(esgFactorUpdateSchema))
    body: EsgFactorUpdateInput,
  ) {
    return this.service.updateFactor(id, body);
  }

  @Get('registros')
  listRegistros(
    @Query('projectId') projectId?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    return this.service.listRegistros({ projectId, desde, hasta });
  }

  @Post('registros')
  createRegistro(
    @Body(new ZodValidationPipe(esgRegistroCreateSchema))
    body: EsgRegistroCreateInput,
  ) {
    return this.service.createRegistro(body);
  }

  @Patch('registros/:id')
  updateRegistro(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(esgRegistroUpdateSchema))
    body: EsgRegistroUpdateInput,
  ) {
    return this.service.updateRegistro(id, body);
  }

  @Delete('registros/:id')
  @HttpCode(204)
  async removeRegistro(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.removeRegistro(id);
  }

  /** Informe agregado de emisiones por obra, para BREEAM/LEED. */
  @Get('informe')
  informe(
    @Query('projectId', ParseUUIDPipe) projectId: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    return this.service.informe(projectId, desde, hasta);
  }
}
