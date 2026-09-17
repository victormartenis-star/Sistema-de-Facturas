import { Controller, Get, Query } from '@nestjs/common';
import { auditQuerySchema } from '@erp/shared';
import { Roles } from '../auth/roles';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuditService } from './audit.service';
import type { AuditQuery } from '@erp/shared';

@Controller('audit')
@Roles('admin', 'gerente')
export class AuditController {
  constructor(private readonly service: AuditService) {}

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
