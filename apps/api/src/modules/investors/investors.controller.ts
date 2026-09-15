import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  DistributeDividendInput,
  InvestmentAccountCreateInput,
  InvestmentAccountUpdateInput,
  InvestmentCashflowCreateInput,
  InvestorCreateInput,
  InvestorUpdateInput,
  ParticipationCreateInput,
  ParticipationUpdateInput,
  distributeDividendSchema,
  investmentAccountCreateSchema,
  investmentAccountUpdateSchema,
  investmentCashflowCreateSchema,
  investorCreateSchema,
  investorUpdateSchema,
  participationCreateSchema,
  participationUpdateSchema,
} from '@erp/shared';
import { Roles } from '../../auth/roles';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { InvestorsService } from './investors.service';

@Controller()
export class InvestorsController {
  constructor(private readonly service: InvestorsService) {}

  /* ────────────────────── inversores ────────────────────── */

  @Get('investors')
  listInvestors() {
    return this.service.listInvestors();
  }

  @Post('investors')
  @Roles('admin', 'gerente', 'administracion')
  createInvestor(
    @Body(new ZodValidationPipe(investorCreateSchema))
    body: InvestorCreateInput,
  ) {
    return this.service.createInvestor(body);
  }

  @Patch('investors/:id')
  @Roles('admin', 'gerente', 'administracion')
  updateInvestor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(investorUpdateSchema))
    body: InvestorUpdateInput,
  ) {
    return this.service.updateInvestor(id, body);
  }

  /* ────────────────────── cuentas ────────────────────── */

  @Get('investment-accounts')
  listAccounts(@Query('projectId') projectId?: string) {
    return this.service.listAccounts(projectId);
  }

  @Get('investment-accounts/:id')
  getAccount(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getAccount(id);
  }

  @Post('investment-accounts')
  @Roles('admin', 'gerente', 'administracion')
  createAccount(
    @Body(new ZodValidationPipe(investmentAccountCreateSchema))
    body: InvestmentAccountCreateInput,
  ) {
    return this.service.createAccount(body);
  }

  @Patch('investment-accounts/:id')
  @Roles('admin', 'gerente', 'administracion')
  updateAccount(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(investmentAccountUpdateSchema))
    body: InvestmentAccountUpdateInput,
  ) {
    return this.service.updateAccount(id, body);
  }

  @Delete('investment-accounts/:id')
  @Roles('admin', 'gerente', 'administracion')
  @HttpCode(204)
  async removeAccount(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.removeAccount(id);
  }

  @Get('investment-accounts/:id/informe')
  report(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('discountRate') discountRate?: string,
    @Query('asOfDate') asOfDate?: string,
  ) {
    const rate = discountRate ? Number(discountRate) : 0.08;
    return this.service.report(id, rate, asOfDate);
  }

  /* ────────────────────── participaciones ────────────────────── */

  @Get('investment-accounts/:id/participations')
  listParticipations(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.listParticipations(id);
  }

  @Post('investment-accounts/:id/participations')
  @Roles('admin', 'gerente', 'administracion')
  createParticipation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(participationCreateSchema))
    body: ParticipationCreateInput,
  ) {
    return this.service.createParticipation(id, body);
  }

  @Patch('investment-accounts/:id/participations/:participationId')
  @Roles('admin', 'gerente', 'administracion')
  updateParticipation(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('participationId', ParseUUIDPipe) participationId: string,
    @Body(new ZodValidationPipe(participationUpdateSchema))
    body: ParticipationUpdateInput,
  ) {
    return this.service.updateParticipation(id, participationId, body);
  }

  @Delete('investment-accounts/:id/participations/:participationId')
  @Roles('admin', 'gerente', 'administracion')
  @HttpCode(204)
  async removeParticipation(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('participationId', ParseUUIDPipe) participationId: string,
  ) {
    await this.service.removeParticipation(id, participationId);
  }

  /* ────────────────────── cashflows y reparto ────────────────────── */

  @Get('investment-accounts/:id/cashflows')
  listCashflows(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.listCashflows(id);
  }

  @Post('investment-accounts/:id/cashflows')
  @Roles('admin', 'gerente', 'administracion')
  createCashflow(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(investmentCashflowCreateSchema))
    body: InvestmentCashflowCreateInput,
  ) {
    return this.service.createCashflow(id, body);
  }

  @Post('investment-accounts/:id/distribuir')
  @Roles('admin', 'gerente', 'administracion')
  distribute(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(distributeDividendSchema))
    body: DistributeDividendInput,
  ) {
    return this.service.distribute(id, body);
  }
}
