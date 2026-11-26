import { Module } from '@nestjs/common';
import { ContabilidadModule } from '../../contabilidad/contabilidad.module';
import { TalonesModule } from '../../talones/talones.module';
import { BankReconciliationController } from './bank-reconciliation.controller';
import { BankReconciliationService } from './bank-reconciliation.service';

@Module({
  imports: [ContabilidadModule, TalonesModule],
  controllers: [BankReconciliationController],
  providers: [BankReconciliationService],
})
export class BankReconciliationModule {}
