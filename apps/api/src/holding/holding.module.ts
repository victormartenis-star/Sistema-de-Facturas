import { Module } from '@nestjs/common';
import { HoldingController } from './holding.controller';
import { HoldingService } from './holding.service';
import { TiposCambioService } from './tipos-cambio.service';

/** Consolidación de grupo / holding (Group Reporting). */
@Module({
  controllers: [HoldingController],
  providers: [HoldingService, TiposCambioService],
})
export class HoldingModule {}
