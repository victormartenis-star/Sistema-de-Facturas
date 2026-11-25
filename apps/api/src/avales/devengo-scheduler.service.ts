import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { companies } from '@erp/db';
import {
  USUARIO_SISTEMA,
  runWithRequestContext,
} from '../common/request-context';
import { DbService } from '../db/db.service';
import { DevengoAvalesService } from './devengo-avales.service';

/**
 * Devengo automático de comisiones de aval: el día 1 de cada mes a las 03:30
 * devenga, para cada empresa, los meses terminados que falten (idempotente:
 * lo ya devengado se omite). Corre con un contexto sintético de sistema
 * (`USUARIO_SISTEMA`, rol admin): los `created_by` quedan a null y la
 * auditoría registra al usuario de sistema. Un fallo de una empresa no
 * detiene al resto.
 */
@Injectable()
export class DevengoSchedulerService {
  private readonly logger = new Logger(DevengoSchedulerService.name);

  constructor(
    private readonly dbs: DbService,
    private readonly devengo: DevengoAvalesService,
  ) {}

  @Cron('0 30 3 1 * *')
  async handleCron(): Promise<void> {
    const empresas = await this.dbs.db
      .select({ id: companies.id })
      .from(companies);
    let total = 0;
    for (const e of empresas) {
      try {
        const r = await runWithRequestContext(
          { userId: USUARIO_SISTEMA, companyId: e.id, role: 'admin' },
          () => this.devengo.automatico({}, 'automatico'),
        );
        total += r.contabilizados;
      } catch (err) {
        this.logger.error(
          `Devengo automático de avales fallido en la empresa ${e.id}: ${String(err)}`,
        );
      }
    }
    this.logger.log(
      `Devengo automático de avales: ${empresas.length} empresa(s), ${total} devengo(s) nuevo(s).`,
    );
  }
}
