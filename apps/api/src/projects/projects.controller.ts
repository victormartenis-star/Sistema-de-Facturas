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
  ProjectCreateInput,
  ProjectStatus,
  ProjectUpdateInput,
  projectCreateSchema,
  projectUpdateSchema,
} from '@erp/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  @Get()
  list(@Query('search') search?: string, @Query('status') status?: string) {
    const validStatus = PROJECT_STATUSES.includes(status as ProjectStatus)
      ? (status as ProjectStatus)
      : undefined;
    return this.service.list(search, validStatus);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(projectCreateSchema))
    body: ProjectCreateInput,
  ) {
    return this.service.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(projectUpdateSchema))
    body: ProjectUpdateInput,
  ) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.remove(id);
  }
}
