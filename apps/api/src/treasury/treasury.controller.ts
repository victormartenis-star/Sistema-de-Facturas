import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  BankAccountCreateInput,
  BankAccountUpdateInput,
  CASHFLOW_GROUPINGS,
  CashflowGrouping,
  MILESTONE_DIRECTIONS,
  MILESTONE_STATUSES,
  MilestoneDirection,
  MilestoneStatus,
  SetPaymentInstrumentInput,
  bankAccountCreateSchema,
  bankAccountUpdateSchema,
  setPaymentInstrumentSchema,
} from '@erp/shared';
import { Roles } from '../auth/roles';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TreasuryService } from './treasury.service';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

  /** Marca a mano el instrumento de cobro/pago (transferencia/confirming/pagaré…) de un vencimiento. */
  @Patch('milestones/:id/instrumento')
  @Roles('admin', 'gerente', 'administracion')
  @HttpCode(204)
  async setPaymentInstrument(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setPaymentInstrumentSchema))
    body: SetPaymentInstrumentInput,
  ) {
    await this.service.setPaymentInstrument(id, body);
  }

  /** Cruce de vencimientos: cobros por certificación vs. otros, pagos por confirming/pagaré vs. otros. */
  @Get('vencimientos-cruzados')
  crossedMaturities(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.crossedMaturities(
      ISO_DATE.test(from ?? '') ? from : undefined,
      ISO_DATE.test(to ?? '') ? to : undefined,
    );
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

  /** Proyección de iliquidez a 30/60/90 días a partir del saldo bancario actual. */
  @Get('iliquidez')
  illiquidity(@Query('from') from?: string) {
    return this.service.illiquidityProjection(
      ISO_DATE.test(from ?? '') ? from : undefined,
    );
  }

  @Get('cuentas')
  listBankAccounts(@Query('activa') activa?: string) {
    return this.service.listBankAccounts(
      activa === undefined ? undefined : activa === 'true',
    );
  }

  @Post('cuentas')
  @Roles('admin', 'gerente', 'administracion')
  createBankAccount(
    @Body(new ZodValidationPipe(bankAccountCreateSchema))
    body: BankAccountCreateInput,
  ) {
    return this.service.createBankAccount(body);
  }

  @Patch('cuentas/:id')
  @Roles('admin', 'gerente', 'administracion')
  updateBankAccount(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(bankAccountUpdateSchema))
    body: BankAccountUpdateInput,
  ) {
    return this.service.updateBankAccount(id, body);
  }
}
