import { Module } from '@nestjs/common';
import { TreasuryModule } from '../../treasury/treasury.module';
import { BankReconciliationController } from './bank-reconciliation.controller';
import { BankReconciliationService } from './bank-reconciliation.service';

@Module({
  imports: [TreasuryModule],
  controllers: [BankReconciliationController],
  providers: [BankReconciliationService],
})
export class BankReconciliationModule {}
