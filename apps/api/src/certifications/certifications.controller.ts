import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  CertificationCreateInput,
  CertificationInvoiceInput,
  certificationCreateSchema,
  certificationInvoiceSchema,
} from '@erp/shared';
import { RequireCapability } from '../auth/auth.decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CertificationsService } from './certifications.service';

@RequireCapability('certificaciones.gestionar')
@Controller('certifications')
export class CertificationsController {
  constructor(private readonly service: CertificationsService) {}

  @Get()
  list(@Query('projectId') projectId?: string) {
    return this.service.list(projectId || undefined);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(certificationCreateSchema))
    body: CertificationCreateInput,
  ) {
    return this.service.create(body);
  }

  /** Genera y aprueba la factura de venta de la certificación. */
  @Post(':id/facturar')
  invoice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(certificationInvoiceSchema))
    body: CertificationInvoiceInput,
  ) {
    return this.service.invoice(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.remove(id);
  }
}
