import { Module } from '@nestjs/common';
import { AprobacionesModule } from '../../aprobaciones/aprobaciones.module';
import { ComplianceModule } from '../../compliance/compliance.module';
import { DbService } from '../../db/db.service';
import { InvoicesModule } from '../../invoices/invoices.module';
import { ProveedoresModule } from '../proveedores/proveedores.module';
import { SubcontratasController } from './subcontratas.controller';
import { SubcontratasService } from './subcontratas.service';

/** Certificaciones de subcontrata y retención de garantía. */
@Module({
  imports: [
    ProveedoresModule,
    InvoicesModule,
    ComplianceModule,
    AprobacionesModule,
  ],
  controllers: [SubcontratasController],
  providers: [SubcontratasService, DbService],
})
export class SubcontratasModule {}
