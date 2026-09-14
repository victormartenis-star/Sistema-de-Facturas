import { Module } from '@nestjs/common';
import { ComplianceModule } from '../compliance/compliance.module';
import { ProveedoresModule } from '../modules/proveedores/proveedores.module';
import { FacturaeService } from './facturae.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

@Module({
  imports: [ComplianceModule, ProveedoresModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, FacturaeService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
