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
  talonAccionSchema,
  talonCreateSchema,
  talonarioCreateSchema,
  talonesQuerySchema,
  type TalonAccionInput,
  type TalonCreateInput,
  type TalonarioCreateInput,
  type TalonesQuery,
} from '@erp/shared';
import { Roles } from '../auth/roles';
import { Idempotente } from '../common/idempotencia/idempotente.decorator';
import { VersionEsperada } from '../common/version';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TalonesService } from './talones.service';

/**
 * Talonarios y talones bancarios. Lectura: admin, gerente, administración y
 * lector. Operaciones: admin, gerente y administración (`Idempotency-Key` al
 * emitir; `If-Match` en las transiciones).
 */
@Controller('tesoreria')
@Roles('admin', 'gerente', 'administracion', 'lector')
export class TalonesController {
  constructor(private readonly service: TalonesService) {}

  @Get('talonarios')
  talonarios() {
    return this.service.talonarios();
  }

  @Post('talonarios')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  crearTalonario(
    @Body(new ZodValidationPipe(talonarioCreateSchema))
    body: TalonarioCreateInput,
  ) {
    return this.service.crearTalonario(body);
  }

  @Post('talonarios/:id/anular')
  @Roles('admin', 'gerente', 'administracion')
  @HttpCode(200)
  anularTalonario(
    @Param('id', ParseUUIDPipe) id: string,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.anularTalonario(id, version);
  }

  @Get('talones')
  talones(@Query(new ZodValidationPipe(talonesQuerySchema)) q: TalonesQuery) {
    return this.service.talones(q);
  }

  @Get('talones/:id')
  talon(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.talon(id);
  }

  @Post('talones')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  emitir(
    @Body(new ZodValidationPipe(talonCreateSchema)) body: TalonCreateInput,
  ) {
    return this.service.emitir(body);
  }

  @Post('talones/:id/acciones')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  accion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(talonAccionSchema)) body: TalonAccionInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.accion(id, body, version);
  }
}
