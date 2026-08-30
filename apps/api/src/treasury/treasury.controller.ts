import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  CASHFLOW_GROUPINGS,
  CashflowGrouping,
  MILESTONE_DIRECTIONS,
  MILESTONE_STATUSES,
  MilestoneDirection,
  MilestoneStatus,
} from '@erp/shared';
import { RequireCapability } from '../auth/auth.decorators';
import { TreasuryService } from './treasury.service';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

@RequireCapability('tesoreria.gestionar')
@Controller('treasury')
export class TreasuryController {
  constructor(private readonly service: TreasuryService) {}

  /** Calendario de vencimientos (cobros y pagos). */
  @Get('milestones')
  milestones(
    @Query('direction') direction?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.milestones({
      direction: MILESTONE_DIRECTIONS.includes(direction as MilestoneDirection)
        ? (direction as MilestoneDirection)
        : undefined,
      status: MILESTONE_STATUSES.includes(status as MilestoneStatus)
        ? (status as MilestoneStatus)
        : undefined,
      from: ISO_DATE.test(from ?? '') ? from : undefined,
      to: ISO_DATE.test(to ?? '') ? to : undefined,
    });
  }

  @Post('milestones/:id/pagar')
  @HttpCode(204)
  async pay(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.setStatus(id, 'pagado');
  }

  @Post('milestones/:id/reabrir')
  @HttpCode(204)
  async reopen(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.setStatus(id, 'previsto');
  }

  /** Previsión de flujo de caja agrupada por semanas o meses. */
  @Get('cashflow')
  cashflow(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy') groupBy?: string,
  ) {
    return this.service.cashflow(
      ISO_DATE.test(from ?? '') ? from : undefined,
      ISO_DATE.test(to ?? '') ? to : undefined,
      CASHFLOW_GROUPINGS.includes(groupBy as CashflowGrouping)
        ? (groupBy as CashflowGrouping)
        : 'semana',
    );
  }
}
