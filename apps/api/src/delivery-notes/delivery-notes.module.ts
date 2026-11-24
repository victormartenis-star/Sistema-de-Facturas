import { Module } from '@nestjs/common';
import { AprobacionesModule } from '../aprobaciones/aprobaciones.module';
import { PurchaseOrdersModule } from '../purchase-orders/purchase-orders.module';
import { DeliveryNotesController } from './delivery-notes.controller';
import { DeliveryNotesService } from './delivery-notes.service';

@Module({
  // Los albaranes recalculan el estado del pedido al imputarse.
  imports: [PurchaseOrdersModule, AprobacionesModule],
  controllers: [DeliveryNotesController],
  providers: [DeliveryNotesService],
  exports: [DeliveryNotesService],
})
export class DeliveryNotesModule {}
