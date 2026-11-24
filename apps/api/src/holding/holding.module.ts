import { Module } from '@nestjs/common';
import { HoldingController } from './holding.controller';
import { HoldingService } from './holding.service';

/** Consolidación de grupo / holding. */
@Module({
  controllers: [HoldingController],
  providers: [HoldingService],
})
export class HoldingModule {}
