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
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  INVOICE_KINDS,
  INVOICE_STATUSES,
  InvoiceCancelInput,
  InvoiceCreateInput,
  InvoiceKind,
  InvoiceRectifyInput,
  InvoiceStatus,
  InvoiceUpdateInput,
  invoiceCancelSchema,
  invoiceCreateSchema,
  invoiceRectifySchema,
  invoiceUpdateSchema,
  esModoPaginado,
  normalizarPaginacion,
  paginacionQuerySchema,
  type PaginacionQuery,
} from '@erp/shared';
import { Roles } from '../auth/roles';
import { VersionEsperada } from '../common/version';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { FacturaeService } from './facturae.service';
import { InvoicesService } from './invoices.service';
import { VerifactuSubmissionService } from './verifactu-submission.service';

@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly service: InvoicesService,
    private readonly facturaeService: FacturaeService,
    private readonly verifactuService: VerifactuSubmissionService,
  ) {}

  @Get()
  list(
    @Query('kind') kind?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('rectificativas') rectificativas?: string,
    @Query('projectId', new ParseUUIDPipe({ optional: true }))
    projectId?: string,
    @Query(new ZodValidationPipe(paginacionQuerySchema))
    paginacion: PaginacionQuery = {},
  ) {
    const validKind = INVOICE_KINDS.includes(kind as InvoiceKind)
      ? (kind as InvoiceKind)
      : undefined;
    const validStatus = INVOICE_STATUSES.includes(status as InvoiceStatus)
      ? (status as InvoiceStatus)
      : undefined;
    return this.service.list(
      validKind,
      validStatus,
      search,
      rectificativas === 'true',
      projectId || undefined,
      esModoPaginado(paginacion) ? normalizarPaginacion(paginacion) : undefined,
    );
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  /**
   * XML Facturae 3.2.2 de una factura de venta, con la huella de
   * encadenamiento VeriFactu incrustada como extensión propia. Alcance
   * preliminar: sin firma XAdES ni validación contra el XSD oficial — ver
   * `packages/shared/src/facturae.ts`.
   */
  @Get(':id/facturae')
  async facturae(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const { xml, fileName, signed } = await this.facturaeService.generate(id);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('X-Facturae-Signed', String(signed));
    return xml;
  }

  /**
   * Genera (y, si hay certificado AEAT configurado, envía) el registro
   * VeriFactu real de esta factura. Ver `VerifactuSubmissionService` para
   * el alcance no verificado de la rama de envío.
   */
  @Post(':id/verifactu/enviar')
  @Roles('admin', 'gerente', 'administracion')
  enviarVerifactu(@Param('id', ParseUUIDPipe) id: string) {
    return this.verifactuService.send(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(invoiceCreateSchema))
    body: InvoiceCreateInput,
  ) {
    return this.service.create(body);
  }

  @Patch(':id')
  @Roles('admin', 'gerente', 'administracion')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(invoiceUpdateSchema))
    body: InvoiceUpdateInput,
    @VersionEsperada({ exigible: true }) version?: number,
  ) {
    return this.service.update(id, body, version);
  }

  /** Aprueba la factura (con matching de albaranes si es de compra). */
  @Post(':id/aprobar')
  @Roles('admin', 'gerente', 'administracion')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @VersionEsperada() version?: number,
  ) {
    return this.service.approve(id, version);
  }

  /** Marca como pagada/cobrada y liquida sus vencimientos. */
  @Post(':id/pagar')
  @Roles('admin', 'gerente', 'administracion')
  markPaid(
    @Param('id', ParseUUIDPipe) id: string,
    @VersionEsperada() version?: number,
  ) {
    return this.service.markPaid(id, version);
  }

  /**
   * Anula la factura, libera albaranes y borra vencimientos previstos.
   * Fuera de borrador exige motivo; una venta aprobada no se anula (se rectifica).
   */
  @Post(':id/anular')
  @Roles('admin', 'gerente', 'administracion')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(invoiceCancelSchema))
    body: InvoiceCancelInput,
    @VersionEsperada() version?: number,
  ) {
    return this.service.cancel(id, body, version);
  }

  /** Crea la rectificativa (total o por diferencias) en borrador. */
  @Post(':id/rectificar')
  @Roles('admin', 'gerente', 'administracion')
  rectify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(invoiceRectifySchema))
    body: InvoiceRectifyInput,
    @VersionEsperada() version?: number,
  ) {
    return this.service.rectify(id, body, version);
  }

  @Delete(':id')
  @Roles('admin', 'gerente', 'administracion')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @VersionEsperada({ exigible: true }) version?: number,
  ) {
    await this.service.remove(id, version);
  }
}
