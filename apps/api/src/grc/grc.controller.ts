import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import {
  CONFLICTOS_SOD,
  delegacionCreateSchema,
  politicaSodSchema,
  type ConflictoSod,
  type DelegacionCreateInput,
  type ModoSod,
} from '@erp/shared';
import { Roles } from '../auth/roles';
import { Idempotente } from '../common/idempotencia/idempotente.decorator';
import { getRequestContext } from '../common/request-context';
import { VersionEsperada } from '../common/version';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { GrcService } from './grc.service';

const conflictoPipe = new ZodValidationPipe(z.enum(CONFLICTOS_SOD));
const delegacionBodySchema = delegacionCreateSchema.extend({
  /** Solo admin o gerente: delegación en nombre de otro aprobador. */
  deleganteId: z.string().uuid().nullish(),
});

/**
 * Gobierno: políticas de segregación de funciones, eventos SoD (informe de
 * riesgos) y delegaciones de aprobación. Lectura de políticas: roles
 * internos y lector; cambiarlas: admin y gerente. Delegaciones: cualquier
 * aprobador las suyas.
 */
@Controller('grc')
@Roles('admin', 'gerente', 'administracion', 'lector')
export class GrcController {
  constructor(private readonly grc: GrcService) {}

  @Get('sod/politicas')
  politicas() {
    return this.grc.politicas();
  }

  @Put('sod/politicas/:conflicto')
  @Roles('admin', 'gerente')
  @Idempotente()
  actualizar(
    @Param('conflicto', conflictoPipe) conflicto: ConflictoSod,
    @Body(new ZodValidationPipe(politicaSodSchema)) body: { modo: ModoSod },
    @VersionEsperada() version: number | undefined,
  ) {
    return this.grc.actualizarPolitica(conflicto, body.modo, version);
  }

  @Get('sod/eventos')
  @Roles('admin', 'gerente', 'administracion')
  eventos() {
    return this.grc.eventos();
  }

  @Get('delegaciones')
  @Roles('admin', 'gerente', 'administracion')
  delegaciones(@Query('todas') todas?: string) {
    const rol = getRequestContext()?.role;
    return this.grc.listarDelegaciones(
      todas === 'true' && (rol === 'admin' || rol === 'gerente'),
    );
  }

  @Post('delegaciones')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  crearDelegacion(
    @Body(new ZodValidationPipe(delegacionBodySchema))
    body: DelegacionCreateInput & { deleganteId?: string | null },
  ) {
    return this.grc.crearDelegacion(body);
  }

  @Post('delegaciones/:id/revocar')
  @Roles('admin', 'gerente', 'administracion')
  @HttpCode(200)
  revocar(
    @Param('id', ParseUUIDPipe) id: string,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.grc.revocarDelegacion(id, version);
  }
}
