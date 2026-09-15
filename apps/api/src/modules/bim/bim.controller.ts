import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  BimElementLinkUpsertInput,
  BimModelCreateMeta,
  bimElementLinkUpsertSchema,
  bimModelCreateMetaSchema,
} from '@erp/shared';
import { Roles } from '../../auth/roles';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { BimService, UploadedBimFile } from './bim.service';

const MAX_SIZE_MB = 200;

/** Codifica el nombre de archivo para Content-Disposition (RFC 5987). */
function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

@Controller('bim/models')
export class BimController {
  constructor(private readonly service: BimService) {}

  @Get()
  list(
    @Query('projectId', new ParseUUIDPipe({ optional: true }))
    projectId?: string,
  ) {
    return this.service.listModels(projectId);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getModel(id);
  }

  @Get(':id/file')
  async file(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { model, stream } = await this.service.downloadModel(id);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${rfc5987(model.fileName)}`,
    );
    return new StreamableFile(stream);
  }

  @Post()
  @Roles('admin', 'gerente', 'administracion', 'obra')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
    }),
  )
  upload(
    @UploadedFile() file: UploadedBimFile | undefined,
    @Body(new ZodValidationPipe(bimModelCreateMetaSchema))
    meta: BimModelCreateMeta,
  ) {
    if (!file) {
      throw new BadRequestException(
        'No se ha recibido ningún archivo (campo "file")',
      );
    }
    return this.service.uploadModel(file, meta);
  }

  @Delete(':id')
  @Roles('admin', 'gerente', 'administracion', 'obra')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.removeModel(id);
  }

  @Get(':id/links')
  listLinks(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.listLinks(id);
  }

  @Put(':id/links/:globalId')
  @Roles('admin', 'gerente', 'administracion', 'obra')
  upsertLink(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('globalId') globalId: string,
    @Body(new ZodValidationPipe(bimElementLinkUpsertSchema))
    body: BimElementLinkUpsertInput,
  ) {
    return this.service.upsertLink(id, globalId, body);
  }
}
