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
  PostventaIncidentCreateInput,
  PostventaIncidentUpdateStatusInput,
  RealEstateKeyHandoverCreateInput,
  RealEstatePaymentMilestoneCreateInput,
  RealEstateReservationCancelInput,
  RealEstateReservationContractInput,
  RealEstateReservationCreateInput,
  RealEstateReservationDeedInput,
  RealEstateUnitCreateInput,
  RealEstateUnitUpdateInput,
  postventaIncidentCreateSchema,
  postventaIncidentUpdateStatusSchema,
  realEstateKeyHandoverCreateSchema,
  realEstatePaymentMilestoneCreateSchema,
  realEstateReservationCancelSchema,
  realEstateReservationContractSchema,
  realEstateReservationCreateSchema,
  realEstateReservationDeedSchema,
  realEstateUnitCreateSchema,
  realEstateUnitUpdateSchema,
} from '@erp/shared';
import { Roles } from '../../auth/roles';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RealEstateService } from './real-estate.service';

@Controller('real-estate')
export class RealEstateController {
  constructor(private readonly service: RealEstateService) {}

  /* ────────────────────── unidades ────────────────────── */

  @Get('units')
  listUnits(@Query('projectId') projectId?: string) {
    return this.service.listUnits(projectId);
  }

  @Get('units/:id')
  getUnit(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getUnit(id);
  }

  @Post('units')
  @Roles('admin', 'gerente', 'administracion')
  createUnit(
    @Body(new ZodValidationPipe(realEstateUnitCreateSchema))
    body: RealEstateUnitCreateInput,
  ) {
    return this.service.createUnit(body);
  }

  @Patch('units/:id')
  @Roles('admin', 'gerente', 'administracion')
  updateUnit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(realEstateUnitUpdateSchema))
    body: RealEstateUnitUpdateInput,
  ) {
    return this.service.updateUnit(id, body);
  }

  @Delete('units/:id')
  @Roles('admin', 'gerente', 'administracion')
  @HttpCode(204)
  async removeUnit(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.removeUnit(id);
  }

  @Get('comercializacion')
  commercialization(@Query('projectId', ParseUUIDPipe) projectId: string) {
    return this.service.commercialization(projectId);
  }

  /* ────────────────────── reservas ────────────────────── */

  @Get('reservations')
  listReservations(@Query('unitId') unitId?: string) {
    return this.service.listReservations(unitId);
  }

  @Post('reservations')
  @Roles('admin', 'gerente', 'administracion')
  createReservation(
    @Body(new ZodValidationPipe(realEstateReservationCreateSchema))
    body: RealEstateReservationCreateInput,
  ) {
    return this.service.createReservation(body);
  }

  @Post('reservations/:id/cancelar')
  @Roles('admin', 'gerente', 'administracion')
  cancelReservation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(realEstateReservationCancelSchema))
    body: RealEstateReservationCancelInput,
  ) {
    return this.service.cancelReservation(id, body);
  }

  @Post('reservations/:id/contrato')
  @Roles('admin', 'gerente', 'administracion')
  signContract(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(realEstateReservationContractSchema))
    body: RealEstateReservationContractInput,
  ) {
    return this.service.signContract(id, body);
  }

  @Post('reservations/:id/escritura')
  @Roles('admin', 'gerente', 'administracion')
  signDeed(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(realEstateReservationDeedSchema))
    body: RealEstateReservationDeedInput,
  ) {
    return this.service.signDeed(id, body);
  }

  /* ────────────────────── plan de cobros ────────────────────── */

  @Get('reservations/:id/cobros')
  listPayments(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.listPayments(id);
  }

  @Post('reservations/:id/cobros')
  @Roles('admin', 'gerente', 'administracion')
  createPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(realEstatePaymentMilestoneCreateSchema))
    body: RealEstatePaymentMilestoneCreateInput,
  ) {
    return this.service.createPayment(id, body);
  }

  @Post('cobros/:id/cobrar')
  @Roles('admin', 'gerente', 'administracion')
  @HttpCode(204)
  async payPayment(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.payPayment(id);
  }

  /* ────────────────────── entrega de llaves ────────────────────── */

  @Get('reservations/:id/entrega-llaves')
  getKeyHandover(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getKeyHandover(id);
  }

  @Post('reservations/:id/entrega-llaves')
  @Roles('admin', 'gerente', 'administracion', 'obra')
  createKeyHandover(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(realEstateKeyHandoverCreateSchema))
    body: RealEstateKeyHandoverCreateInput,
  ) {
    return this.service.createKeyHandover(id, body);
  }

  /* ────────────────────── postventa ────────────────────── */

  @Get('postventa')
  listIncidents(@Query('unitId') unitId?: string) {
    return this.service.listIncidents(unitId);
  }

  @Post('postventa')
  @Roles('admin', 'gerente', 'administracion', 'obra')
  createIncident(
    @Body(new ZodValidationPipe(postventaIncidentCreateSchema))
    body: PostventaIncidentCreateInput,
  ) {
    return this.service.createIncident(body);
  }

  @Patch('postventa/:id/estado')
  @Roles('admin', 'gerente', 'administracion', 'obra')
  updateIncidentStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(postventaIncidentUpdateStatusSchema))
    body: PostventaIncidentUpdateStatusInput,
  ) {
    return this.service.updateIncidentStatus(id, body);
  }
}
