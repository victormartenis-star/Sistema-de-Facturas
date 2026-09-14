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
  ComparativoAdjudicarInput,
  ComparativoCreateInput,
  ComparativoOfertaCreateInput,
  ComparativoOfertaUpdateInput,
  ComparativoUpdateInput,
  comparativoAdjudicarSchema,
  comparativoCreateSchema,
  comparativoOfertaCreateSchema,
  comparativoOfertaUpdateSchema,
  comparativoUpdateSchema,
} from '@erp/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ComparativosService } from './comparativos.service';

@Controller('comparativos')
export class ComparativosController {
  constructor(private readonly service: ComparativosService) {}

  @Get()
  list(@Query('projectId') projectId?: string) {
    return this.service.list(projectId || undefined);
  }

  @Get(':id/matriz')
  matriz(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.matriz(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(comparativoCreateSchema))
    body: ComparativoCreateInput,
  ) {
    return this.service.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(comparativoUpdateSchema))
    body: ComparativoUpdateInput,
  ) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.remove(id);
  }

  @Post(':id/ofertas')
  addOferta(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(comparativoOfertaCreateSchema))
    body: ComparativoOfertaCreateInput,
  ) {
    return this.service.addOferta(id, body);
  }

  @Patch(':id/ofertas/:ofertaId')
  updateOferta(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ofertaId', ParseUUIDPipe) ofertaId: string,
    @Body(new ZodValidationPipe(comparativoOfertaUpdateSchema))
    body: ComparativoOfertaUpdateInput,
  ) {
    return this.service.updateOferta(id, ofertaId, body);
  }

  @Delete(':id/ofertas/:ofertaId')
  @HttpCode(204)
  async removeOferta(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ofertaId', ParseUUIDPipe) ofertaId: string,
  ) {
    await this.service.removeOferta(id, ofertaId);
  }

  /** Formaliza la adjudicación y genera el borrador de subcontrata (pedido). */
  @Post(':id/adjudicar')
  adjudicar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(comparativoAdjudicarSchema))
    body: ComparativoAdjudicarInput,
  ) {
    return this.service.adjudicar(id, body);
  }
}
