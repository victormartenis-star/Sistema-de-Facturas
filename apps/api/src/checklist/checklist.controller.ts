import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ChecklistMarkInput, checklistMarkSchema } from '@erp/shared';
import { RequireCapability } from '../auth/auth.decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ChecklistService } from './checklist.service';

@Controller('checklist')
export class ChecklistController {
  constructor(private readonly service: ChecklistService) {}

  @Get(':projectId')
  get(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.service.get(projectId);
  }

  /** Marca o desmarca un punto que ocurre fuera del ERP. */
  @RequireCapability('obras.gestionar')
  @Post(':projectId')
  mark(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(new ZodValidationPipe(checklistMarkSchema)) body: ChecklistMarkInput,
  ) {
    return this.service.mark(projectId, body);
  }
}
