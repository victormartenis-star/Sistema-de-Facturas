import { Module } from '@nestjs/common';
import { FleetIotController } from './fleet-iot.controller';
import { FleetIotService } from './fleet-iot.service';

@Module({
  controllers: [FleetIotController],
  providers: [FleetIotService],
  exports: [FleetIotService],
})
export class FleetIotModule {}
