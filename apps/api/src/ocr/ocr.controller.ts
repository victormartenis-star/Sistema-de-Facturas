import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  DOC_STATUSES,
  DocStatus,
  ExtractionValidateInput,
  extractionValidateSchema,
} from '@erp/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ExtractionService } from './extraction.service';
import { ValidationService } from './validation.service';

@Controller()
export class OcrController {
  constructor(
    private readonly validation: ValidationService,
    private readonly extraction: ExtractionService,
  ) {}

  /** Estado del pipeline, para que la interfaz avise si falta la clave. */
  @Get('ocr/estado')
  status() {
    return {
      enabled: this.extraction.enabled,
      model: this.extraction.enabled ? this.extraction.model : null,
    };
  }

  /** Bandeja de validación. */
  @Get('validacion')
  pending(@Query('status') status?: string) {
    const valid = DOC_STATUSES.includes(status as DocStatus)
      ? (status as DocStatus)
      : undefined;
    return this.validation.pending(valid);
  }

  /** Relanza la lectura del documento (tras un error o para reintentar). */
  @Post('documents/:id/extraer')
  @HttpCode(202)
  async reprocess(@Param('id', ParseUUIDPipe) id: string) {
    await this.validation.reprocess(id);
    return { documentId: id, status: 'extraido' };
  }

  @Post('validacion/:id/validar')
  validate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(extractionValidateSchema))
    body: ExtractionValidateInput,
  ) {
    return this.validation.validate(id, body);
  }

  @Post('validacion/:id/rechazar')
  @HttpCode(204)
  async reject(@Param('id', ParseUUIDPipe) id: string) {
    await this.validation.reject(id);
  }
}
