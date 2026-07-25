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
} from '@nestjs/common';
import {
  PhaseCreateInput,
  PhaseUpdateInput,
  phaseCreateSchema,
  phaseUpdateSchema,
} from '@erp/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PhasesService } from './phases.service';

@Controller()
export class PhasesController {
  constructor(private readonly service: PhasesService) {}

  @Get('projects/:projectId/phases')
  list(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.service.list(projectId);
  }

  @Post('projects/:projectId/phases')
  create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(new ZodValidationPipe(phaseCreateSchema)) body: PhaseCreateInput,
  ) {
    return this.service.create(projectId, body);
  }

  /** Desvío presupuestario: presupuesto teórico vs. gasto imputado real. */
  @Get('projects/:projectId/desvio')
  deviation(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.service.deviation(projectId);
  }

  @Patch('phases/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(phaseUpdateSchema)) body: PhaseUpdateInput,
  ) {
    return this.service.update(id, body);
  }

  @Delete('phases/:id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.remove(id);
  }
}
