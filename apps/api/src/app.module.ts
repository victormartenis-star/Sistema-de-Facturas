import { Module } from '@nestjs/common';
import { CategoriesModule } from './categories/categories.module';
import { CertificationsModule } from './certifications/certifications.module';
import { ContactsModule } from './contacts/contacts.module';
import { DbModule } from './db/db.module';
import { DeliveryNotesModule } from './delivery-notes/delivery-notes.module';
import { DocumentsModule } from './documents/documents.module';
import { InvoicesModule } from './invoices/invoices.module';
import { PhasesModule } from './phases/phases.module';
import { ProjectsModule } from './projects/projects.module';
import { TreasuryModule } from './treasury/treasury.module';

@Module({
  imports: [
    DbModule,
    ProjectsModule,
    ContactsModule,
    CategoriesModule,
    DocumentsModule,
    PhasesModule,
    InvoicesModule,
    CertificationsModule,
    DeliveryNotesModule,
    TreasuryModule,
  ],
})
export class AppModule {}
