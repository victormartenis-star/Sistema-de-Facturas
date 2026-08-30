import { Module } from '@nestjs/common';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';

@Module({
  controllers: [PurchaseOrdersController],
  providers: [PurchaseOrdersService],
  // Los albaranes recalculan el estado del pedido al imputarse.
  exports: [PurchaseOrdersService],
})
export class PurchaseOrdersModule {}
