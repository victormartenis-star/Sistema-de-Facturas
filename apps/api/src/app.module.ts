import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { ProjectsModule } from './projects/projects.module';

@Module({
  imports: [DbModule, ProjectsModule],
})
export class AppModule {}
