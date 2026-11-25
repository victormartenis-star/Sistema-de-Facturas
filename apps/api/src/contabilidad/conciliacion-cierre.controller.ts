import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import {
  conciliacionCierreQuerySchema,
  conciliacionCierreRegistrarSchema,
  type ConciliacionCierreQuery,
  type ConciliacionCierreRegistrarInput,
} from '@erp/shared';
import { Roles } from '../auth/roles';
import { Idempotente } from '../common/idempotencia/idempotente.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ConciliacionCierreService } from './conciliacion-cierre.service';

/**
 * Conciliación de cierre auxiliar ↔ mayor a una fecha de corte (`?fecha=`,
 * por defecto hoy; nunca futura). Lectura: admin, gerente, administración y
 * lector. Registrar la evidencia: admin, gerente y administración
 * (`Idempotency-Key`).
 */
@Controller('contabilidad/conciliacion')
@Roles('admin', 'gerente', 'administracion', 'lector')
export class ConciliacionCierreController {
  constructor(private readonly service: ConciliacionCierreService) {}

  /** En vivo, sin guardar. */
  @Get()
  consultar(
    @Query(new ZodValidationPipe(conciliacionCierreQuerySchema))
    q: ConciliacionCierreQuery,
  ) {
    return this.service.consultar(q.fecha);
  }

  @Get('historial')
  historial() {
    return this.service.historial();
  }

  @Post()
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  registrar(
    @Body(new ZodValidationPipe(conciliacionCierreRegistrarSchema))
    body: ConciliacionCierreRegistrarInput,
  ) {
    return this.service.registrar(body.fecha);
  }
}
