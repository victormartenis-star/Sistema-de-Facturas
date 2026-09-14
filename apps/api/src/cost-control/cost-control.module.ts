import { Module } from '@nestjs/common';
import { CostControlController } from './cost-control.controller';
import { CostControlService } from './cost-control.service';

@Module({
  controllers: [CostControlController],
  providers: [CostControlService],
})
export class CostControlModule {}
