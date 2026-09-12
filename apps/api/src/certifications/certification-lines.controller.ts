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
} from '@nestjs/common';
import { CertificationLinesService } from './certification-lines.service';
import {
  certificationLineCreateSchema,
  certificationLineUpdateSchema,
  type CertificationLineCreateInput,
  type CertificationLineUpdateInput,
} from '@erp/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller('certifications/:certId/lines')
export class CertificationLinesController {
  constructor(private readonly service: CertificationLinesService) {}

  @Get()
  list(@Param('certId', ParseUUIDPipe) certId: string) {
    return this.service.list(certId);
  }

  @Post()
  create(
    @Param('certId', ParseUUIDPipe) certId: string,
    @Body(new ZodValidationPipe(certificationLineCreateSchema))
    body: CertificationLineCreateInput,
  ) {
    return this.service.create(certId, body);
  }

  @Patch(':lineId')
  update(
    @Param('certId', ParseUUIDPipe) certId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body(new ZodValidationPipe(certificationLineUpdateSchema))
    body: CertificationLineUpdateInput,
  ) {
    return this.service.update(certId, lineId, body);
  }

  @Delete(':lineId')
  @HttpCode(204)
  remove(
    @Param('certId', ParseUUIDPipe) certId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ) {
    return this.service.remove(certId, lineId);
  }
}
