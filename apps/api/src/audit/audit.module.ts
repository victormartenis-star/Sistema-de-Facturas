import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditController } from './audit.controller';
import { AuditPartitionService } from './audit-partition.service';
import { AuditAnchorService } from './audit-anchor.service';
import { AuditChainBackfillService } from './audit-chain-backfill.service';
import { AuditIntegrityService } from './audit-integrity.service';
import { AuditService } from './audit.service';

/** Global para que otros módulos puedan inyectar AuditService sin importar AuditModule. */
@Global()
@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AuditController],
  providers: [
    AuditService,
    AuditPartitionService,
    AuditIntegrityService,
    AuditChainBackfillService,
    AuditAnchorService,
  ],
  exports: [AuditService, AuditIntegrityService, AuditAnchorService],
})
export class AuditModule {}
