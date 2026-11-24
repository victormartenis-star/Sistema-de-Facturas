import { Module } from '@nestjs/common';
import { AprobacionesController } from './aprobaciones.controller';
import { AprobacionesService } from './aprobaciones.service';

@Module({
  controllers: [AprobacionesController],
  providers: [AprobacionesService],
  // Pedidos, albaranes, facturas y subcontratas aplican la puerta y la
  // invalidación dentro de sus propias transacciones.
  exports: [AprobacionesService],
})
export class AprobacionesModule {}
