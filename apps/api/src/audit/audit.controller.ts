import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../auth/roles';
import { AuditService } from './audit.service';
import type { AuditQuery } from '@erp/shared';

@Controller('audit')
@Roles('admin', 'gerente')
export class AuditController {
  constructor(private readonly service: AuditService) {}

  /** GET /audit — historial de auditoría con filtros opcionales. */
  @Get()
  list(@Query() query: AuditQuery) {
    return this.service.list(query);
  }
}
