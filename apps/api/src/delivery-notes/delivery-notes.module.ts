import { Module } from '@nestjs/common';
import { PurchaseOrdersModule } from '../purchase-orders/purchase-orders.module';
import { DeliveryNotesController } from './delivery-notes.controller';
import { DeliveryNotesService } from './delivery-notes.service';

@Module({
  // Los albaranes recalculan el estado del pedido al imputarse.
  imports: [PurchaseOrdersModule],
  controllers: [DeliveryNotesController],
  providers: [DeliveryNotesService],
})
export class DeliveryNotesModule {}
