import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditController } from './audit.controller';
import { AuditPartitionService } from './audit-partition.service';
import { AuditService } from './audit.service';

/** Global para que otros módulos puedan inyectar AuditService sin importar AuditModule. */
@Global()
@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AuditController],
  providers: [AuditService, AuditPartitionService],
  exports: [AuditService],
})
export class AuditModule {}
