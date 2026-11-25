import { Module } from '@nestjs/common';
import { NotificacionesModule } from '../alerts/notificaciones.module';
import { ContabilidadModule } from '../contabilidad/contabilidad.module';
import { AvalesController } from './avales.controller';
import { AvalesService } from './avales.service';

/** Avales bancarios y garantías de obra (tesorería). */
@Module({
  imports: [ContabilidadModule, NotificacionesModule],
  controllers: [AvalesController],
  providers: [AvalesService],
})
export class AvalesModule {}
