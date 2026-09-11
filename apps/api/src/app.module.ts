import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { BudgetsModule } from './budgets/budgets.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { UsersModule } from './users/users.module';
import { CategoriesModule } from './categories/categories.module';
import { CertificationsModule } from './certifications/certifications.module';
import { ComplianceModule } from './compliance/compliance.module';
import { ContactsModule } from './contacts/contacts.module';
import { DbModule } from './db/db.module';
import { DeliveryNotesModule } from './delivery-notes/delivery-notes.module';
import { DocumentsModule } from './documents/documents.module';
import { InvoicesModule } from './invoices/invoices.module';
import { OcrModule } from './ocr/ocr.module';
import { PhasesModule } from './phases/phases.module';
import { ProjectsModule } from './projects/projects.module';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';
import { TreasuryModule } from './treasury/treasury.module';

@Module({
  imports: [
    DbModule,
    AuthModule,
    ProjectsModule,
    ContactsModule,
    CategoriesModule,
    DocumentsModule,
    PhasesModule,
    InvoicesModule,
    CertificationsModule,
    PurchaseOrdersModule,
    DeliveryNotesModule,
    TreasuryModule,
    OcrModule,
    ComplianceModule,
    BudgetsModule,
    DashboardModule,
    UsersModule,
  ],
})
export class AppModule {}
