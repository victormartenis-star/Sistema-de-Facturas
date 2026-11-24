import { Module } from '@nestjs/common';
import { NotificacionesService } from './notificaciones.service';

/**
 * Bandeja de notificaciones por evento. Módulo aparte de `AlertsModule`
 * (que importa control de costes y otros) para que los módulos de negocio
 * puedan notificar sin dependencias circulares.
 */
@Module({
  providers: [NotificacionesService],
  exports: [NotificacionesService],
})
export class NotificacionesModule {}
