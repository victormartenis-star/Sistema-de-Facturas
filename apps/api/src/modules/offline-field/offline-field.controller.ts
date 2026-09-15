import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  FichajeCreateInput,
  PrlChecklistCreateInput,
  fichajeCreateSchema,
  prlChecklistCreateSchema,
} from '@erp/shared';
import { Roles } from '../../auth/roles';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { OfflineFieldService } from './offline-field.service';

@Controller()
export class OfflineFieldController {
  constructor(private readonly service: OfflineFieldService) {}

  @Get('fichajes')
  listFichajes(@Query('projectId') projectId?: string) {
    return this.service.listFichajes(projectId);
  }

  @Post('fichajes')
  @Roles('admin', 'gerente', 'administracion', 'obra')
  createFichaje(
    @Body(new ZodValidationPipe(fichajeCreateSchema)) body: FichajeCreateInput,
  ) {
    return this.service.createFichaje(body);
  }

  @Get('checklist-prl')
  listChecklists(@Query('projectId') projectId?: string) {
    return this.service.listChecklists(projectId);
  }

  @Post('checklist-prl')
  @Roles('admin', 'gerente', 'administracion', 'obra')
  createChecklist(
    @Body(new ZodValidationPipe(prlChecklistCreateSchema))
    body: PrlChecklistCreateInput,
  ) {
    return this.service.createChecklist(body);
  }
}
