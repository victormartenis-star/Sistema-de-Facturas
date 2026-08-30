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
  DELIVERY_NOTE_STATUSES,
  DeliveryNoteCreateInput,
  DeliveryNoteStatus,
  DeliveryNoteUpdateInput,
  deliveryNoteCreateSchema,
  deliveryNoteUpdateSchema,
} from '@erp/shared';
import { RequireCapability } from '../auth/auth.decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DeliveryNotesService } from './delivery-notes.service';

@Controller('delivery-notes')
export class DeliveryNotesController {
  constructor(private readonly service: DeliveryNotesService) {}

  @Get()
  list(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('contactId') contactId?: string,
    @Query('availableForContact') availableForContact?: string,
  ) {
    const validStatus = DELIVERY_NOTE_STATUSES.includes(
      status as DeliveryNoteStatus,
    )
      ? (status as DeliveryNoteStatus)
      : undefined;
    return this.service.list({
      search,
      status: validStatus,
      contactId: contactId || undefined,
      availableForContact: availableForContact || undefined,
    });
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(deliveryNoteCreateSchema))
    body: DeliveryNoteCreateInput,
  ) {
    return this.service.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(deliveryNoteUpdateSchema))
    body: DeliveryNoteUpdateInput,
  ) {
    return this.service.update(id, body);
  }

  /** Validación del jefe de obra (pendiente → validado). */
  @RequireCapability('albaranes.validar')
  @Post(':id/validar')
  validate(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.validate(id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.remove(id);
  }
}
