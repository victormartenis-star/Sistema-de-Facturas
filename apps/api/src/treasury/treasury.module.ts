import { Module } from '@nestjs/common';
import { ComplianceModule } from '../compliance/compliance.module';
import { TreasuryController } from './treasury.controller';
import { TreasuryService } from './treasury.service';

@Module({
  imports: [ComplianceModule],
  controllers: [TreasuryController],
  providers: [TreasuryService],
})
export class TreasuryModule {}
