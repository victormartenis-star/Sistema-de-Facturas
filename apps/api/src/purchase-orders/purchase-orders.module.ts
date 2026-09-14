import { Module } from '@nestjs/common';
import { ProveedoresModule } from '../modules/proveedores/proveedores.module';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';

@Module({
  imports: [ProveedoresModule],
  controllers: [PurchaseOrdersController],
  providers: [PurchaseOrdersService],
  // Los albaranes recalculan el estado del pedido al imputarse.
  exports: [PurchaseOrdersService],
})
export class PurchaseOrdersModule {}
