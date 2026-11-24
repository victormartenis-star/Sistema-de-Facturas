import { Module } from '@nestjs/common';
import { AprobacionesModule } from '../aprobaciones/aprobaciones.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { ProveedoresModule } from '../modules/proveedores/proveedores.module';
import { FacturaeSigningService } from './facturae-signing.service';
import { FacturaeService } from './facturae.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { VerifactuSubmissionService } from './verifactu-submission.service';

@Module({
  imports: [ComplianceModule, ProveedoresModule, AprobacionesModule],
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
