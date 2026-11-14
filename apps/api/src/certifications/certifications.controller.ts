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
  CERT_STATUSES,
  CertStatus,
  CertificationCreateInput,
  CertificationInvoiceInput,
  CertificationRectifyInput,
  certificationCreateSchema,
  certificationInvoiceSchema,
  certificationRectifySchema,
  esModoPaginado,
  normalizarPaginacion,
  paginacionQuerySchema,
  type PaginacionQuery,
} from '@erp/shared';
import { Roles } from '../auth/roles';
import { Idempotente } from '../common/idempotencia/idempotente.decorator';
import { VersionEsperada } from '../common/version';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CertificationsService } from './certifications.service';

@Controller('certifications')
export class CertificationsController {
  constructor(private readonly service: CertificationsService) {}

  @Get()
  list(
    @Query('projectId', new ParseUUIDPipe({ optional: true }))
    projectId?: string,
    @Query('status') status?: string,
    @Query(new ZodValidationPipe(paginacionQuerySchema))
    paginacion: PaginacionQuery = {},
  ) {
    const validStatus = CERT_STATUSES.includes(status as CertStatus)
      ? (status as CertStatus)
      : undefined;
    return this.service.list(
      projectId || undefined,
      validStatus,
      esModoPaginado(paginacion) ? normalizarPaginacion(paginacion) : undefined,
    );
  }

  @Post()
  @Idempotente()
  create(
    @Body(new ZodValidationPipe(certificationCreateSchema))
    body: CertificationCreateInput,
  ) {
    return this.service.create(body);
  }

  /** Crea la certificación rectificativa (nuevo acumulado a origen, puede bajar). */
  @Post(':id/rectificar')
  @Roles('admin', 'gerente', 'administracion')
  rectify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(certificationRectifySchema))
    body: CertificationRectifyInput,
    @VersionEsperada() version?: number,
  ) {
    return this.service.rectify(id, body, version);
  }

  /** Genera y aprueba la factura de venta de la certificación. */
  @Post(':id/facturar')
  @Roles('admin', 'gerente', 'administracion')
  invoice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(certificationInvoiceSchema))
    body: CertificationInvoiceInput,
    @VersionEsperada() version?: number,
  ) {
    return this.service.invoice(id, body, version);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @VersionEsperada({ exigible: true }) version?: number,
  ) {
    await this.service.remove(id, version);
  }
}
