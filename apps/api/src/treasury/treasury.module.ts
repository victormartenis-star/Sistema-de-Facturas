import { Module } from '@nestjs/common';
import { ComplianceModule } from '../compliance/compliance.module';
import { GrcModule } from '../grc/grc.module';
import { TreasuryController } from './treasury.controller';
import { TreasuryService } from './treasury.service';

@Module({
  imports: [ComplianceModule, GrcModule],
  controllers: [TreasuryController],
  providers: [TreasuryService],
  exports: [TreasuryService],
})
export class TreasuryModule {}
