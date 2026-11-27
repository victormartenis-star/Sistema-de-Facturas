import { Module } from '@nestjs/common';
import { GrcController } from './grc.controller';
import { GrcService } from './grc.service';

/** Governance, Risk & Compliance: SoD, delegaciones y eventos (fase 7). */
@Module({
  controllers: [GrcController],
  providers: [GrcService],
  exports: [GrcService],
})
export class GrcModule {}
