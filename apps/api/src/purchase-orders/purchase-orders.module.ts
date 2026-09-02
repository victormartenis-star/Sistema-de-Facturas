import { Module } from '@nestjs/common';
import { ComplianceModule } from '../compliance/compliance.module';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';

@Module({
  imports: [ComplianceModule],
  controllers: [PurchaseOrdersController],
  providers: [PurchaseOrdersService],
  // Los albaranes recalculan el estado del pedido al imputarse.
  exports: [PurchaseOrdersService],
})
export class PurchaseOrdersModule {}
