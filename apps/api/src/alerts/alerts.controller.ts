import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ALERT_RULE_TYPES,
  AlertRuleType,
  AlertRuleUpdateInput,
  alertRuleUpdateSchema,
} from '@erp/shared';
import { Roles } from '../auth/roles';
import { DbService } from '../db/db.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AlertsService } from './alerts.service';

@Controller('alerts')
export class AlertsController {
  constructor(
    private readonly service: AlertsService,
    private readonly dbs: DbService,
  ) {}

  @Get('rules')
  listRules() {
    return this.service.listRules();
  }

  @Patch('rules/:type')
  @Roles('admin', 'gerente', 'administracion')
  updateRule(
    @Param('type', new ParseEnumPipe(ALERT_RULE_TYPES))
    type: AlertRuleType,
    @Body(new ZodValidationPipe(alertRuleUpdateSchema))
    body: AlertRuleUpdateInput,
  ) {
    return this.service.updateRule(type, body);
  }

  @Get('notifications')
  listNotifications(@Query('unread') unread?: string) {
    return this.service.listNotifications(unread === 'true');
  }

  @Get('notifications/no-leidas')
  unreadCount() {
    return this.service.unreadCount().then((count) => ({ count }));
  }

  @Patch('notifications/:id/leer')
  @HttpCode(204)
  async markRead(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.markRead(id);
  }

  @Post('notifications/marcar-todas-leidas')
  @HttpCode(204)
  async markAllRead() {
    await this.service.markAllRead();
  }

  /** Dispara la evaluación de la empresa actual sin esperar al cron diario — útil para probar reglas recién cambiadas. */
  @Post('run')
  @Roles('admin', 'gerente', 'administracion')
  run() {
    return this.service.runForCompany(this.dbs.getCompanyId());
  }
}
