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
  anticipoAplicarSchema,
  anticipoCreateSchema,
  anticiposQuerySchema,
  carteraQuerySchema,
  compensacionCreateSchema,
  conciliacionCarteraQuerySchema,
  documentoCarteraAnularSchema,
  type AnticipoAplicarInput,
  type AnticipoCreateInput,
  type AnticiposQuery,
  type CarteraQuery,
  type CompensacionCreateInput,
  type ConciliacionCarteraQuery,
  type DocumentoCarteraAnularInput,
} from '@erp/shared';
import { Roles } from '../auth/roles';
import { Idempotente } from '../common/idempotencia/idempotente.decorator';
import { VersionEsperada } from '../common/version';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CarteraService } from './cartera.service';

/**
 * Cartera de clientes y proveedores (subledgers AR/AP). Lectura: admin,
 * gerente, administración y lector. Anticipos y compensaciones: admin,
 * gerente y administración, con `Idempotency-Key` al crear o aplicar e
 * `If-Match` (opcional) al aplicar o anular.
 */
@Controller('cartera')
@Roles('admin', 'gerente', 'administracion', 'lector')
export class CarteraController {
  constructor(private readonly service: CarteraService) {}

  /** Partidas abiertas por tercero y documento a la fecha de corte. */
  @Get('partidas')
  partidas(@Query(new ZodValidationPipe(carteraQuerySchema)) q: CarteraQuery) {
    return this.service.partidas(q);
  }

  /** Antigüedad de saldos por tercero y tramo. */
  @Get('antiguedad')
  antiguedad(
    @Query(new ZodValidationPipe(carteraQuerySchema)) q: CarteraQuery,
  ) {
    return this.service.antiguedad(q);
  }

  /** Conciliación auxiliar ↔ mayor por tercero. */
  @Get('conciliacion')
  conciliacion(
    @Query(new ZodValidationPipe(conciliacionCarteraQuerySchema))
    q: ConciliacionCarteraQuery,
  ) {
    return this.service.conciliacion(q);
  }

  @Get('anticipos')
  anticipos(
    @Query(new ZodValidationPipe(anticiposQuerySchema)) q: AnticiposQuery,
  ) {
    return this.service.anticipos(q);
  }

  @Get('anticipos/:id')
  anticipo(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.anticipo(id);
  }

  @Post('anticipos')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  crearAnticipo(
    @Body(new ZodValidationPipe(anticipoCreateSchema))
    body: AnticipoCreateInput,
  ) {
    return this.service.crearAnticipo(body);
  }

  @Post('anticipos/:id/aplicar')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  aplicarAnticipo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(anticipoAplicarSchema))
    body: AnticipoAplicarInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.aplicarAnticipo(id, body, version);
  }

  @Post('anticipos/:id/desaplicar')
  @Roles('admin', 'gerente', 'administracion')
  @HttpCode(200)
  desaplicarAnticipo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(documentoCarteraAnularSchema))
    body: DocumentoCarteraAnularInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.desaplicarAnticipo(id, body, version);
  }

  @Post('anticipos/:id/anular')
  @Roles('admin', 'gerente', 'administracion')
  @HttpCode(200)
  anularAnticipo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(documentoCarteraAnularSchema))
    body: DocumentoCarteraAnularInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.anularAnticipo(id, body, version);
  }

  @Get('compensaciones')
  compensaciones(@Query('contactId') contactId?: string) {
    return this.service.compensaciones(
      contactId && /^[0-9a-f-]{36}$/i.test(contactId) ? contactId : undefined,
    );
  }

  @Get('compensaciones/:id')
  compensacion(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.compensacion(id);
  }

  @Post('compensaciones')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  crearCompensacion(
    @Body(new ZodValidationPipe(compensacionCreateSchema))
    body: CompensacionCreateInput,
  ) {
    return this.service.crearCompensacion(body);
  }

  @Post('compensaciones/:id/anular')
  @Roles('admin', 'gerente', 'administracion')
  @HttpCode(200)
  anularCompensacion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(documentoCarteraAnularSchema))
    body: DocumentoCarteraAnularInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.anularCompensacion(id, body, version);
  }
}
