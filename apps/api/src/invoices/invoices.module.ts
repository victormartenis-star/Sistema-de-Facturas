import { Module } from '@nestjs/common';
import { ComplianceModule } from '../compliance/compliance.module';
import { ProveedoresModule } from '../modules/proveedores/proveedores.module';
import { FacturaeSigningService } from './facturae-signing.service';
import { FacturaeService } from './facturae.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { VerifactuSubmissionService } from './verifactu-submission.service';

@Module({
  imports: [ComplianceModule, ProveedoresModule],
  controllers: [InvoicesController],
  providers: [
    InvoicesService,
    FacturaeService,
    FacturaeSigningService,
    VerifactuSubmissionService,
  ],
  exports: [InvoicesService],
})
export class InvoicesModule {}
