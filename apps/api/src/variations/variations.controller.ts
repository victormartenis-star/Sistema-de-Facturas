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
  VariationApproveInput,
  VariationCreateInput,
  VariationRejectInput,
  VariationUpdateInput,
  variationApproveSchema,
  variationCreateSchema,
  variationRejectSchema,
  variationUpdateSchema,
} from '@erp/shared';
import { RequireCapability } from '../auth/auth.decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { VariationsService } from './variations.service';

@Controller('variations')
export class VariationsController {
  constructor(private readonly service: VariationsService) {}

  @Get()
  list(@Query('projectId') projectId?: string) {
    return this.service.list(projectId || undefined);
  }

  /** Informe de modificaciones de una obra (anexo D). */
  @Get('informe/:projectId')
  report(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.service.report(projectId);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @RequireCapability('modificados.registrar')
  @Post()
  create(
    @Body(new ZodValidationPipe(variationCreateSchema))
    body: VariationCreateInput,
  ) {
    return this.service.create(body);
  }

  @RequireCapability('modificados.registrar')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(variationUpdateSchema))
    body: VariationUpdateInput,
  ) {
    return this.service.update(id, body);
  }

  /** Registra la firma de la Dirección Facultativa o de la Propiedad. */
  @RequireCapability('modificados.aprobar')
  @Post(':id/aprobar')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(variationApproveSchema))
    body: VariationApproveInput,
  ) {
    return this.service.approve(id, body);
  }

  @RequireCapability('modificados.aprobar')
  @Post(':id/rechazar')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(variationRejectSchema))
    body: VariationRejectInput,
  ) {
    return this.service.reject(id, body);
  }

  @RequireCapability('modificados.aprobar')
  @Post(':id/reabrir')
  reopen(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.reopen(id);
  }

  @RequireCapability('modificados.registrar')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.remove(id);
  }
}
