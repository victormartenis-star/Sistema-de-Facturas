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
  PROJECT_STATUSES,
  can,
  isProjectScoped,
  ProjectStaffInput,
  projectStaffSchema,
  ProjectCreateInput,
  ProjectStatus,
  ProjectUpdateInput,
  projectCreateSchema,
  projectUpdateSchema,
} from '@erp/shared';
import {
  CurrentUser,
  RequireCapability,
  type AuthUser,
} from '../auth/auth.decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    const validStatus = PROJECT_STATUSES.includes(status as ProjectStatus)
      ? (status as ProjectStatus)
      : undefined;
    return this.service.list(
      search,
      validStatus,
      isProjectScoped(user.role) ? user.projectIds : undefined,
      can(user.role, 'economico.ver'),
    );
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id, can(user.role, 'economico.ver'));
  }

  @RequireCapability('obras.gestionar')
  @Post()
  create(
    @Body(new ZodValidationPipe(projectCreateSchema))
    body: ProjectCreateInput,
  ) {
    return this.service.create(body);
  }

  @RequireCapability('obras.gestionar')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(projectUpdateSchema))
    body: ProjectUpdateInput,
  ) {
    return this.service.update(id, body);
  }

  /** Asignación de Jefe de Grupo, Jefe de Obra y Encargado. */
  @RequireCapability('obras.gestionar')
  @Patch(':id/responsables')
  setStaff(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(projectStaffSchema)) body: ProjectStaffInput,
  ) {
    return this.service.setStaff(id, body);
  }

  @RequireCapability('obras.gestionar')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.remove(id);
  }
}
