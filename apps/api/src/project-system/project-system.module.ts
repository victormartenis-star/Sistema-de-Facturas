import { Module } from '@nestjs/common';
import { ProjectSystemController } from './project-system.controller';
import { ProjectSystemService } from './project-system.service';

/** Project System: retenciones, sustitución por aval y modificados de subcontrata. */
@Module({
  controllers: [ProjectSystemController],
  providers: [ProjectSystemService],
})
export class ProjectSystemModule {}
