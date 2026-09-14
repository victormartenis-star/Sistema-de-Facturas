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
  ParteMaquinariaCreateInput,
  ParteMaquinariaUpdateInput,
  PartePersonalCreateInput,
  PartePersonalUpdateInput,
  parteMaquinariaCreateSchema,
  parteMaquinariaUpdateSchema,
  partePersonalCreateSchema,
  partePersonalUpdateSchema,
} from '@erp/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentUser } from '../../auth/roles';
import type { AccessTokenPayload } from '@erp/shared';
import { PartesDiariosService } from './partes-diarios.service';

@Controller('partes-diarios')
export class PartesDiariosController {
  constructor(private readonly service: PartesDiariosService) {}

  @Get('personal')
  listPersonal(
    @Query('projectId') projectId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.listPersonal({ projectId, from, to });
  }

  @Post('personal')
  createPersonal(
    @Body(new ZodValidationPipe(partePersonalCreateSchema))
    body: PartePersonalCreateInput,
  ) {
    return this.service.createPersonal(body);
  }

  @Patch('personal/:id')
  updatePersonal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(partePersonalUpdateSchema))
    body: PartePersonalUpdateInput,
  ) {
    return this.service.updatePersonal(id, body);
  }

  @Delete('personal/:id')
  @HttpCode(204)
  async removePersonal(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.removePersonal(id);
  }

  /** Aprobación del encargado/jefe de obra (quién y cuándo, sin firma digital). */
  @Post('personal/:id/aprobar')
  approvePersonal(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.service.approvePersonal(id, user.sub);
  }

  @Get('maquinaria')
  listMaquinaria(
    @Query('projectId') projectId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.listMaquinaria({ projectId, from, to });
  }

  @Post('maquinaria')
  createMaquinaria(
    @Body(new ZodValidationPipe(parteMaquinariaCreateSchema))
    body: ParteMaquinariaCreateInput,
  ) {
    return this.service.createMaquinaria(body);
  }

  @Patch('maquinaria/:id')
  updateMaquinaria(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(parteMaquinariaUpdateSchema))
    body: ParteMaquinariaUpdateInput,
  ) {
    return this.service.updateMaquinaria(id, body);
  }

  @Delete('maquinaria/:id')
  @HttpCode(204)
  async removeMaquinaria(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.removeMaquinaria(id);
  }

  @Post('maquinaria/:id/aprobar')
  approveMaquinaria(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.service.approveMaquinaria(id, user.sub);
  }
}
