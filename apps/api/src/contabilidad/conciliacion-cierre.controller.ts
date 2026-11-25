import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Roles } from '../auth/roles';
import { Idempotente } from '../common/idempotencia/idempotente.decorator';
import { ConciliacionCierreService } from './conciliacion-cierre.service';

/**
 * Conciliación de cierre auxiliar ↔ mayor. Lectura: admin, gerente,
 * administración y lector. Registrar la evidencia: admin, gerente y
 * administración (`Idempotency-Key`).
 */
@Controller('contabilidad/conciliacion')
@Roles('admin', 'gerente', 'administracion', 'lector')
export class ConciliacionCierreController {
  constructor(private readonly service: ConciliacionCierreService) {}

  /** En vivo, sin guardar. */
  @Get()
  consultar() {
    return this.service.consultar();
  }

  @Get('historial')
  historial() {
    return this.service.historial();
  }

  @Post()
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  registrar() {
    return this.service.registrar();
  }
}
