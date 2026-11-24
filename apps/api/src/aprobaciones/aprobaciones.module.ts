import { Module } from '@nestjs/common';
import { NotificacionesModule } from '../alerts/notificaciones.module';
import { AprobacionesController } from './aprobaciones.controller';
import { AprobacionesService } from './aprobaciones.service';

@Module({
  imports: [NotificacionesModule],
  controllers: [AprobacionesController],
  providers: [AprobacionesService],
  // Pedidos, albaranes, facturas y subcontratas aplican la puerta y la
  // invalidación dentro de sus propias transacciones.
  exports: [AprobacionesService],
})
export class AprobacionesModule {}
