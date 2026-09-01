import {
  BadRequestException,
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
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  DOC_STATUSES,
  DOC_TYPES,
  DOCUMENT_MAX_SIZE_MB,
  DocStatus,
  DocType,
  DocumentUpdateInput,
  DocumentUploadMeta,
  documentUpdateSchema,
  documentUploadMetaSchema,
} from '@erp/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DocumentsService, UploadedDocumentFile } from './documents.service';

/** Codifica el nombre de archivo para Content-Disposition (RFC 5987). */
function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

@Controller('documents')
export class DocumentsController {
  constructor(private readonly service: DocumentsService) {}

  @Get()
  list(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('docType') docType?: string,
    @Query('projectId', new ParseUUIDPipe({ optional: true }))
    projectId?: string,
  ) {
    return this.service.list({
      search,
      status: DOC_STATUSES.includes(status as DocStatus)
        ? (status as DocStatus)
        : undefined,
      docType: DOC_TYPES.includes(docType as DocType)
        ? (docType as DocType)
        : undefined,
      projectId,
    });
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Get(':id/file')
  async file(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { document, stream } = await this.service.openFile(id);
    res.setHeader('Content-Type', document.mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${rfc5987(document.fileName)}`,
    );
    return new StreamableFile(stream);
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: DOCUMENT_MAX_SIZE_MB * 1024 * 1024 },
    }),
  )
  upload(
    @UploadedFile() file: UploadedDocumentFile | undefined,
    @Body(new ZodValidationPipe(documentUploadMetaSchema))
    meta: DocumentUploadMeta,
  ) {
    if (!file) {
      throw new BadRequestException(
        'No se ha recibido ningún archivo (campo "file")',
      );
    }
    return this.service.upload(file, meta);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(documentUpdateSchema))
    body: DocumentUpdateInput,
  ) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.remove(id);
  }
}
