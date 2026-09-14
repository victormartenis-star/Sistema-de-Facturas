import { Module } from '@nestjs/common';
import { ContratosObraController } from './contratos-obra.controller';
import { ContratosObraService } from './contratos-obra.service';
import { DbService } from '../../db/db.service';
import { ComplianceModule } from '../../compliance/compliance.module';

@Module({
  imports: [ComplianceModule],
  controllers: [ContratosObraController],
  providers: [ContratosObraService, DbService],
  exports: [ContratosObraService],
})
export class ContratosObraModule {}
