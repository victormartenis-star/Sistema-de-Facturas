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
  WorkerAssignmentInput,
  WorkerCreateInput,
  WorkerDocInput,
  WorkerUpdateInput,
  workerAssignmentSchema,
  workerCreateSchema,
  workerDocSchema,
  workerUpdateSchema,
} from '@erp/shared';
import { RequireCapability } from '../auth/auth.decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { WorkersService } from './workers.service';

@Controller('workers')
export class WorkersController {
  constructor(private readonly service: WorkersService) {}

  /**
   * El listado de valla lo consulta el encargado, que no gestiona la
   * homologación: le basta con `albaranes.validar`, la capacidad que define su
   * papel en obra. Negarle esta pantalla dejaría el control sin quien lo
   * ejerce.
   */
  @RequireCapability('albaranes.validar')
  @Get('valla/:projectId')
  gateList(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.service.gateList(projectId);
  }

  @RequireCapability('homologacion.gestionar')
  @Get()
  list(
    @Query('contactId') contactId?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.service.list({
      contactId: contactId || undefined,
      projectId: projectId || undefined,
    });
  }

  @RequireCapability('homologacion.gestionar')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @RequireCapability('homologacion.gestionar')
  @Post()
  create(
    @Body(new ZodValidationPipe(workerCreateSchema)) body: WorkerCreateInput,
  ) {
    return this.service.create(body);
  }

  @RequireCapability('homologacion.gestionar')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(workerUpdateSchema)) body: WorkerUpdateInput,
  ) {
    return this.service.update(id, body);
  }

  @RequireCapability('homologacion.gestionar')
  @Post(':id/documentos')
  saveDoc(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(workerDocSchema)) body: WorkerDocInput,
  ) {
    return this.service.saveDoc(id, body);
  }

  /** Alta o baja del trabajador en una obra. */
  @RequireCapability('homologacion.gestionar')
  @Post(':id/obras')
  setAssignment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(workerAssignmentSchema))
    body: WorkerAssignmentInput,
  ) {
    return this.service.setAssignment(id, body);
  }

  @RequireCapability('homologacion.gestionar')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.remove(id);
  }
}
