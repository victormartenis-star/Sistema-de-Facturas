import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  cierreEjercicioRevertirSchema,
  ejercicioParamSchema,
  type CierreEjercicioRevertirInput,
} from '@erp/shared';
import { Roles } from '../auth/roles';
import { Idempotente } from '../common/idempotencia/idempotente.decorator';
import { VersionEsperada } from '../common/version';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CierreEjercicioService } from './cierre-ejercicio.service';

/**
 * Cierre y apertura del ejercicio. Lectura: admin, gerente, administración y
 * lector. Cerrar y revertir: solo admin y gerente (segregación de funciones,
 * igual que el cierre de períodos). Las acciones admiten `Idempotency-Key`;
 * revertir, también `If-Match` con la versión del cierre.
 */
@Controller('contabilidad/ejercicios')
@Roles('admin', 'gerente', 'administracion', 'lector')
export class CierreEjercicioController {
  constructor(private readonly service: CierreEjercicioService) {}

  @Get()
  listar() {
    return this.service.listar();
  }

  /** Vista previa: regularización, cierre, apertura, resultado e impedimentos. */
  @Get(':ejercicio/cierre')
  propuesta(
    @Param('ejercicio', new ZodValidationPipe(ejercicioParamSchema))
    ejercicio: number,
  ) {
    return this.service.propuesta(ejercicio);
  }

  @Post(':ejercicio/cerrar')
  @Roles('admin', 'gerente')
  @Idempotente()
  @HttpCode(200)
  cerrar(
    @Param('ejercicio', new ZodValidationPipe(ejercicioParamSchema))
    ejercicio: number,
  ) {
    return this.service.cerrar(ejercicio);
  }

  @Post(':ejercicio/revertir')
  @Roles('admin', 'gerente')
  @Idempotente()
  @HttpCode(200)
  revertir(
    @Param('ejercicio', new ZodValidationPipe(ejercicioParamSchema))
    ejercicio: number,
    @Body(new ZodValidationPipe(cierreEjercicioRevertirSchema))
    body: CierreEjercicioRevertirInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.revertir(ejercicio, body, version);
  }
}
