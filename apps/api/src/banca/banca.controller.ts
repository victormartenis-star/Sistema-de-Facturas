import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  liquidezQuerySchema,
  remesaAnularSchema,
  remesaCreateSchema,
  remesaDevolverSchema,
  remesaRemitirSchema,
  remesasQuerySchema,
  type LiquidezQuery,
  type RemesaCreateInput,
  type RemesasQuery,
} from '@erp/shared';
import { Roles } from '../auth/roles';
import { Idempotente } from '../common/idempotencia/idempotente.decorator';
import { VersionEsperada } from '../common/version';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { LiquidezService } from './liquidez.service';
import { RemesasService } from './remesas.service';

/**
 * Bank Accounting: remesas SEPA y previsión de liquidez. Lectura de remesas:
 * admin, gerente, administración y lector; operaciones: admin, gerente y
 * administración (`Idempotency-Key` al crear y en cada transición, `If-Match`
 * con la versión). La previsión la ve también el rol obra, solo de sus obras.
 */
@Controller('tesoreria')
@Roles('admin', 'gerente', 'administracion', 'lector')
export class BancaController {
  constructor(
    private readonly remesas: RemesasService,
    private readonly liquidez: LiquidezService,
  ) {}

  @Get('remesas')
  listar(@Query(new ZodValidationPipe(remesasQuerySchema)) q: RemesasQuery) {
    return this.remesas.listar(q);
  }

  @Get('remesas/:id')
  detalle(@Param('id', ParseUUIDPipe) id: string) {
    return this.remesas.detalle(id);
  }

  /** Fichero SEPA XML guardado al generar (idéntico en cada descarga). */
  @Get('remesas/:id/xml')
  async xml(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const { xml, nombre } = await this.remesas.xml(id);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    return xml;
  }

  @Post('remesas')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  crear(
    @Body(new ZodValidationPipe(remesaCreateSchema)) body: RemesaCreateInput,
  ) {
    return this.remesas.crear(body);
  }

  @Post('remesas/:id/generar')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  generar(
    @Param('id', ParseUUIDPipe) id: string,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.remesas.generar(id, version);
  }

  @Post('remesas/:id/remitir')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  remitir(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(remesaRemitirSchema))
    body: { fecha: string; justificacionSod?: string | null },
    @VersionEsperada() version: number | undefined,
  ) {
    return this.remesas.remitir(id, body.fecha, version, body.justificacionSod);
  }

  @Post('remesas/:id/anular')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  anular(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(remesaAnularSchema)) body: { motivo: string },
    @VersionEsperada() version: number | undefined,
  ) {
    return this.remesas.anular(id, body.motivo, version);
  }

  @Post('remesas/:id/partidas/:partidaId/devolver')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  devolver(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('partidaId', ParseUUIDPipe) partidaId: string,
    @Body(new ZodValidationPipe(remesaDevolverSchema))
    body: { fecha: string; motivo: string },
    @VersionEsperada() version: number | undefined,
  ) {
    return this.remesas.devolverPartida(
      id,
      partidaId,
      body.fecha,
      body.motivo,
      version,
    );
  }

  /** Previsión de liquidez por horizontes (`?horizontes=7,30,60,90`). */
  @Get('liquidez')
  @Roles('admin', 'gerente', 'administracion', 'lector', 'obra')
  prevision(
    @Query(new ZodValidationPipe(liquidezQuerySchema)) q: LiquidezQuery,
  ) {
    return this.liquidez.prevision(q);
  }
}
