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
  ComplianceBlockInput,
  ComplianceDocCreateInput,
  ComplianceDocUpdateInput,
  ComplianceWaiverInput,
  complianceBlockSchema,
  complianceDocCreateSchema,
  complianceDocUpdateSchema,
  complianceWaiverSchema,
} from '@erp/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ComplianceService } from './compliance.service';

@Controller()
export class ComplianceController {
  constructor(private readonly service: ComplianceService) {}

  /** Panel de homologación. `?todos=1` incluye los no sujetos a control. */
  @Get('cumplimiento')
  list(@Query('todos') todos?: string) {
    return this.service.list(todos !== '1');
  }

  /**
   * Alertas de vencimiento: contactos con docs bloqueantes que ya caducaron
   * o caducan en los próximos `days` días (default 30).
   * GET /cumplimiento/alertas?days=30
   */
  @Get('cumplimiento/alertas')
  alertas(@Query('days') days?: string) {
    return this.service.alertas(days ? parseInt(days, 10) : 30);
  }

  @Get('contacts/:id/cumplimiento')
  summary(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.summary(id);
  }

  @Post('contacts/:id/cumplimiento/documentos')
  addDoc(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(complianceDocCreateSchema))
    body: ComplianceDocCreateInput,
  ) {
    return this.service.addDoc(id, body);
  }

  @Patch('cumplimiento/documentos/:docId')
  updateDoc(
    @Param('docId', ParseUUIDPipe) docId: string,
    @Body(new ZodValidationPipe(complianceDocUpdateSchema))
    body: ComplianceDocUpdateInput,
  ) {
    return this.service.updateDoc(docId, body);
  }

  @Delete('cumplimiento/documentos/:docId')
  @HttpCode(204)
  async removeDoc(@Param('docId', ParseUUIDPipe) docId: string) {
    await this.service.removeDoc(docId);
  }

  /** Sujeta (o libera) al contacto del control documental de PRL. */
  @Post('contacts/:id/cumplimiento/exigir')
  setRequired(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { required?: boolean },
  ) {
    return this.service.setRequired(id, body.required !== false);
  }

  @Post('contacts/:id/cumplimiento/bloquear')
  block(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(complianceBlockSchema))
    body: ComplianceBlockInput,
  ) {
    return this.service.block(id, body);
  }

  @Post('contacts/:id/cumplimiento/desbloquear')
  unblock(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.unblock(id);
  }

  @Post('contacts/:id/cumplimiento/exencion')
  grantWaiver(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(complianceWaiverSchema))
    body: ComplianceWaiverInput,
  ) {
    return this.service.grantWaiver(id, body);
  }

  @Delete('contacts/:id/cumplimiento/exencion')
  @HttpCode(204)
  async revokeWaiver(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.revokeWaiver(id);
  }
}
