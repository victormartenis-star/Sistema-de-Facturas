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
  INVOICE_KINDS,
  INVOICE_STATUSES,
  InvoiceCreateInput,
  InvoiceKind,
  InvoiceStatus,
  InvoiceUpdateInput,
  invoiceCreateSchema,
  invoiceUpdateSchema,
} from '@erp/shared';
import { RequireCapability } from '../auth/auth.decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { InvoicesService } from './invoices.service';

@RequireCapability('facturas.gestionar')
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly service: InvoicesService) {}

  @Get()
  list(
    @Query('kind') kind?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    const validKind = INVOICE_KINDS.includes(kind as InvoiceKind)
      ? (kind as InvoiceKind)
      : undefined;
    const validStatus = INVOICE_STATUSES.includes(status as InvoiceStatus)
      ? (status as InvoiceStatus)
      : undefined;
    return this.service.list(validKind, validStatus, search);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(invoiceCreateSchema))
    body: InvoiceCreateInput,
  ) {
    return this.service.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(invoiceUpdateSchema))
    body: InvoiceUpdateInput,
  ) {
    return this.service.update(id, body);
  }

  /** Aprueba la factura (con matching de albaranes si es de compra). */
  @Post(':id/aprobar')
  approve(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.approve(id);
  }

  /** Marca como pagada/cobrada y liquida sus vencimientos. */
  @Post(':id/pagar')
  markPaid(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.markPaid(id);
  }

  /** Anula la factura, libera albaranes y borra vencimientos previstos. */
  @Post(':id/anular')
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.cancel(id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.remove(id);
  }
}
