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
  CONTACT_KINDS,
  ContactCreateInput,
  ContactKind,
  ContactUpdateInput,
  contactCreateSchema,
  contactUpdateSchema,
} from '@erp/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ContactsService } from './contacts.service';

@Controller('contacts')
export class ContactsController {
  constructor(private readonly service: ContactsService) {}

  @Get()
  list(@Query('search') search?: string, @Query('kind') kind?: string) {
    const validKind = CONTACT_KINDS.includes(kind as ContactKind)
      ? (kind as ContactKind)
      : undefined;
    return this.service.list(search, validKind);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(contactCreateSchema))
    body: ContactCreateInput,
  ) {
    return this.service.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(contactUpdateSchema))
    body: ContactUpdateInput,
  ) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.remove(id);
  }
}
