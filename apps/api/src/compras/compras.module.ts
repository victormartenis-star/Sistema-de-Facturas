import { Module } from '@nestjs/common';
import { AlmacenModule } from '../almacen/almacen.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { PurchaseOrdersModule } from '../purchase-orders/purchase-orders.module';
import { ComprasController } from './compras.controller';
import { ComprasService } from './compras.service';

/** Procure-to-Pay: solicitudes, peticiones de ofertas, pedidos, recepciones y cuadre. */
@Module({
  imports: [PurchaseOrdersModule, AlmacenModule, InvoicesModule],
  controllers: [ComprasController],
  providers: [ComprasService],
})
export class ComprasModule {}
