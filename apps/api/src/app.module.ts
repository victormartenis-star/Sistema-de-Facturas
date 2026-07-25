import { Module } from '@nestjs/common';
import { CategoriesModule } from './categories/categories.module';
import { ContactsModule } from './contacts/contacts.module';
import { DbModule } from './db/db.module';
import { ProjectsModule } from './projects/projects.module';

@Module({
  imports: [DbModule, ProjectsModule, ContactsModule, CategoriesModule],
})
export class AppModule {}
