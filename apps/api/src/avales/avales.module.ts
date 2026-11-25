import { Module } from '@nestjs/common';
import { NotificacionesModule } from '../alerts/notificaciones.module';
import { ContabilidadModule } from '../contabilidad/contabilidad.module';
import { AvalesController } from './avales.controller';
import { AvalesService } from './avales.service';
import { DevengoAvalesService } from './devengo-avales.service';

/** Avales bancarios y garantías de obra (tesorería). */
@Module({
  imports: [ContabilidadModule, NotificacionesModule],
  controllers: [AvalesController],
  providers: [AvalesService, DevengoAvalesService],
})
export class AvalesModule {}
