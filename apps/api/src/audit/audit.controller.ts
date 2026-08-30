import { Controller, Get, Query } from '@nestjs/common';
import { RequireCapability } from '../auth/auth.decorators';
import { AuditService } from './audit.service';

@RequireCapability('auditoria.ver')
@Controller('audit')
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Get()
  list(
    @Query('entity') entity?: string,
    @Query('entityId') entityId?: string,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list({
      entity: entity || undefined,
      entityId: entityId || undefined,
      userId: userId || undefined,
      from: from || undefined,
      to: to || undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
