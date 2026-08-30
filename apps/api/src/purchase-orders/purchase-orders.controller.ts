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
  PURCHASE_ORDER_STATUSES,
  PurchaseOrderCreateInput,
  PurchaseOrderStatus,
  PurchaseOrderUpdateInput,
  purchaseOrderCreateSchema,
  purchaseOrderUpdateSchema,
} from '@erp/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PurchaseOrdersService } from './purchase-orders.service';

@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly service: PurchaseOrdersService) {}

  @Get()
  list(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('projectId') projectId?: string,
    @Query('contactId') contactId?: string,
    @Query('receiving') receiving?: string,
  ) {
    const validStatus = PURCHASE_ORDER_STATUSES.includes(
      status as PurchaseOrderStatus,
    )
      ? (status as PurchaseOrderStatus)
      : undefined;
    return this.service.list({
      search,
      status: validStatus,
      projectId: projectId || undefined,
      contactId: contactId || undefined,
      receiving: receiving === 'true',
    });
  }

  /**
   * Cuadro de trazabilidad pedido–albarán–factura. Se declara antes de
   * `:id` para que "trazabilidad" no se interprete como un identificador.
   */
  @Get('trazabilidad')
  traceability(@Query('projectId') projectId?: string) {
    return this.service.traceability(projectId || undefined);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(purchaseOrderCreateSchema))
    body: PurchaseOrderCreateInput,
  ) {
    return this.service.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(purchaseOrderUpdateSchema))
    body: PurchaseOrderUpdateInput,
  ) {
    return this.service.update(id, body);
  }

  /** Liquidación del pedido: ningún pedido debe quedar sin factura. */
  @Post(':id/cerrar')
  close(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.close(id);
  }

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
