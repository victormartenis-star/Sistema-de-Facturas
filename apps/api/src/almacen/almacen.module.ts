import { Module } from '@nestjs/common';
import { NotificacionesModule } from '../alerts/notificaciones.module';
import { ContabilidadModule } from '../contabilidad/contabilidad.module';
import { CostControlModule } from '../cost-control/cost-control.module';
import { PurchaseOrdersModule } from '../purchase-orders/purchase-orders.module';
import { AlmacenController } from './almacen.controller';
import { AlmacenService } from './almacen.service';
import { LotesService } from './lotes.service';
import { SolicitudesMaterialController } from './solicitudes-material.controller';
import { SolicitudesMaterialService } from './solicitudes-material.service';

@Module({
  imports: [
    ContabilidadModule,
    CostControlModule,
    // El faltante de una solicitud de material se convierte en pedido.
    PurchaseOrdersModule,
    NotificacionesModule,
  ],
  // Las solicitudes van antes: `almacen/solicitudes` no debe caer en otra ruta.
  controllers: [SolicitudesMaterialController, AlmacenController],
  providers: [AlmacenService, SolicitudesMaterialService, LotesService],
  // La recepción de pedidos (compras) entra el material en almacén.
  exports: [AlmacenService],
})
export class AlmacenModule {}
