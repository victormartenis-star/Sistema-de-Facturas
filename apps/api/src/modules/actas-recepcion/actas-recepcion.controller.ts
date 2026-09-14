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
  ActaRecepcionCreateInput,
  ActaRecepcionTipo,
  ActaRecepcionUpdateInput,
  RepasoCreateInput,
  RepasoUpdateInput,
  actaRecepcionCreateSchema,
  actaRecepcionUpdateSchema,
  repasoCreateSchema,
  repasoUpdateSchema,
} from '@erp/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ActasRecepcionService } from './actas-recepcion.service';

@Controller('actas-recepcion')
export class ActasRecepcionController {
  constructor(private readonly service: ActasRecepcionService) {}

  @Get()
  list(
    @Query('projectId') projectId?: string,
    @Query('tipo') tipo?: ActaRecepcionTipo,
  ) {
    return this.service.list(projectId, tipo);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(actaRecepcionCreateSchema))
    body: ActaRecepcionCreateInput,
  ) {
    return this.service.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(actaRecepcionUpdateSchema))
    body: ActaRecepcionUpdateInput,
  ) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }

  @Get(':id/repasos')
  listRepasos(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.listRepasos(id);
  }

  @Get(':id/progreso')
  progreso(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.progresoRepasos(id);
  }

  @Post(':id/repasos')
  addRepaso(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(repasoCreateSchema)) body: RepasoCreateInput,
  ) {
    return this.service.addRepaso(id, body);
  }

  @Patch('repasos/:repasoId')
  updateRepaso(
    @Param('repasoId', ParseUUIDPipe) repasoId: string,
    @Body(new ZodValidationPipe(repasoUpdateSchema)) body: RepasoUpdateInput,
  ) {
    return this.service.updateRepaso(repasoId, body);
  }

  /** Firma el acta: sin reservas si no quedan repasos pendientes. */
  @Post(':id/firmar')
  firmar(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.firmar(id);
  }
}
