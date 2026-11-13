import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ExportQuery, ExportRecurso, exportQuerySchema } from '@erp/shared';
import { Roles } from '../auth/roles';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ExportResult, ExportsService } from './exports.service';

/**
 * Exportaciones en CSV (separador `;`, BOM UTF-8 para Excel) y JSON. Todo es
 * GET: el rol `lector` pasa el `ReadOnlyGuard` sin excepciones. Los roles de
 * portal (`subcontrata`, `cliente`) quedan fuera por no estar en `@Roles`.
 * El rol `obra` solo exporta datos de sus obras.
 */
@Controller('exports')
@Roles('admin', 'gerente', 'administracion', 'obra', 'lector')
export class ExportsController {
  constructor(private readonly service: ExportsService) {}

  // Resúmenes de empresa: fuera del rol `obra`. Van antes que `:recurso`.
  @Get('economia-resumen')
  @Roles('admin', 'gerente', 'administracion', 'lector')
  resumen(
    @Query(new ZodValidationPipe(exportQuerySchema)) query: ExportQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.responder('economia-resumen', query, res);
  }

  @Get('economia-iva')
  @Roles('admin', 'gerente', 'administracion', 'lector')
  iva(
    @Query(new ZodValidationPipe(exportQuerySchema)) query: ExportQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.responder('economia-iva', query, res);
  }

  @Get(':recurso')
  exportar(
    @Param('recurso') recurso: string,
    @Query(new ZodValidationPipe(exportQuerySchema)) query: ExportQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.responder(recurso as ExportRecurso, query, res);
  }

  private async responder(
    recurso: ExportRecurso,
    query: ExportQuery,
    res: Response,
  ): Promise<ExportResult['body']> {
    const out = await this.service.exportar(recurso, query);
    res.setHeader('Content-Type', out.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${out.fileName}"`,
    );
    return out.body;
  }
}
