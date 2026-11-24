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
  wipAnularSchema,
  wipCierreSchema,
  wipContabilizarSchema,
  wipPropuestaQuerySchema,
  wipQuerySchema,
  type WipAnularInput,
  type WipCierreInput,
  type WipContabilizarInput,
  type WipPropuestaQuery,
  type WipQuery,
} from '@erp/shared';
import { Roles } from '../auth/roles';
import { Idempotente } from '../common/idempotencia/idempotente.decorator';
import { VersionEsperada } from '../common/version';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { WipService } from './wip.service';

/**
 * Obra en curso (WIP) al cierre. Es contabilidad: lectura para admin,
 * gerente, administración y lector; contabilizar y anular, admin, gerente y
 * administración (como el resto del cierre contable). El rol obra no accede.
 */
@Controller('wip')
@Roles('admin', 'gerente', 'administracion', 'lector')
export class WipController {
  constructor(private readonly service: WipService) {}

  @Get()
  listar(@Query(new ZodValidationPipe(wipQuerySchema)) q: WipQuery) {
    return this.service.listar(q);
  }

  /** Cálculo del cierre (borrador) por obra, sin contabilizar. */
  @Get('propuesta')
  propuesta(
    @Query(new ZodValidationPipe(wipPropuestaQuerySchema))
    q: WipPropuestaQuery,
  ) {
    return this.service.propuesta(q);
  }

  /** Cierre de una obra y periodo. */
  @Post()
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  contabilizar(
    @Body(new ZodValidationPipe(wipContabilizarSchema))
    body: WipContabilizarInput,
  ) {
    return this.service.contabilizar(body);
  }

  /** Cierre del periodo para todas las obras con actividad. */
  @Post('cierre')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  cierre(@Body(new ZodValidationPipe(wipCierreSchema)) body: WipCierreInput) {
    return this.service.cierre(body);
  }

  @Post(':id/anular')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  anular(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(wipAnularSchema)) body: WipAnularInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.anular(id, body, version);
  }
}
