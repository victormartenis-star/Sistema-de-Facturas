import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AlertsService } from './alerts.service';

/**
 * Evalúa las reglas de alerta de todas las empresas una vez al día. Horario
 * temprano (6:00) para que la bandeja esté lista antes de la jornada de obra.
 */
@Injectable()
export class AlertsSchedulerService {
  private readonly logger = new Logger(AlertsSchedulerService.name);

  constructor(private readonly alerts: AlertsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async handleCron(): Promise<void> {
    const summaries = await this.alerts.runForAllCompanies();
    const created = summaries.reduce((s, r) => s + r.created, 0);
    this.logger.log(
      `Evaluación de alertas completada: ${summaries.length} empresa(s), ${created} notificación(es) nueva(s).`,
    );
  }
}
