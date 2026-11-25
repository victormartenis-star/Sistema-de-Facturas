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
  provisionPerdidasAnularSchema,
  provisionPerdidasCierreSchema,
  provisionPerdidasContabilizarSchema,
  provisionPerdidasPropuestaQuerySchema,
  provisionPerdidasQuerySchema,
  type ProvisionPerdidasAnularInput,
  type ProvisionPerdidasCierreInput,
  type ProvisionPerdidasContabilizarInput,
  type ProvisionPerdidasPropuestaQuery,
  type ProvisionPerdidasQuery,
} from '@erp/shared';
import { Roles } from '../auth/roles';
import { Idempotente } from '../common/idempotencia/idempotente.decorator';
import { VersionEsperada } from '../common/version';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ProvisionPerdidasService } from './provision-perdidas.service';

/**
 * Provisión por pérdidas previstas en obra. Es contabilidad de cierre, como
 * la obra en curso: lectura para admin, gerente, administración y lector;
 * contabilizar y anular, admin, gerente y administración. El rol obra no
 * accede.
 */
@Controller('provision-perdidas')
@Roles('admin', 'gerente', 'administracion', 'lector')
export class ProvisionPerdidasController {
  constructor(private readonly service: ProvisionPerdidasService) {}

  @Get()
  listar(
    @Query(new ZodValidationPipe(provisionPerdidasQuerySchema))
    q: ProvisionPerdidasQuery,
  ) {
    return this.service.listar(q);
  }

  /** Cálculo del cierre (borrador) por obra, sin contabilizar. */
  @Get('propuesta')
  propuesta(
    @Query(new ZodValidationPipe(provisionPerdidasPropuestaQuerySchema))
    q: ProvisionPerdidasPropuestaQuery,
  ) {
    return this.service.propuesta(q);
  }

  /** Cierre de una obra y periodo. */
  @Post()
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  contabilizar(
    @Body(new ZodValidationPipe(provisionPerdidasContabilizarSchema))
    body: ProvisionPerdidasContabilizarInput,
  ) {
    return this.service.contabilizar(body);
  }

  /** Cierre del periodo para todas las obras con pérdida o provisión vigente. */
  @Post('cierre')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  cierre(
    @Body(new ZodValidationPipe(provisionPerdidasCierreSchema))
    body: ProvisionPerdidasCierreInput,
  ) {
    return this.service.cierre(body);
  }

  @Post(':id/anular')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  anular(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(provisionPerdidasAnularSchema))
    body: ProvisionPerdidasAnularInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.anular(id, body, version);
  }
}
