import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { auditQuerySchema } from '@erp/shared';
import { Roles } from '../auth/roles';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuditIntegrityService } from './audit-integrity.service';
import { AuditService } from './audit.service';
import type { AuditQuery } from '@erp/shared';

@Controller('audit')
@Roles('admin', 'gerente')
export class AuditController {
  constructor(
    private readonly service: AuditService,
    private readonly integrity: AuditIntegrityService,
  ) {}

  /**
   * GET /audit/verify-integrity — recorre la cadena hash de la empresa.
   * Siempre 200: el veredicto va en `integra` / `primerPuntoRoto`.
   * `@Roles('admin')` en el handler prevalece sobre el de la clase.
   */
  @Get('verify-integrity')
  @Roles('admin')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  verifyIntegrity() {
    return this.integrity.verificar();
  }

  /**
   * GET /audit — historial de auditoría con filtros opcionales.
   * Sin `ZodValidationPipe` aquí, un `entityType`/`action` no válido llegaba
   * sin validar hasta `AuditService.list()`, que sí llama a
   * `auditQuerySchema.parse()` (no `.safeParse()`): el `ZodError` sin
   * capturar salía como 500, no como el 400 del resto de la API.
   */
  @Get()
  list(@Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQuery) {
    return this.service.list(query);
  }
}
