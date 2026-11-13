import { Module } from '@nestjs/common';
import { CostControlModule } from '../cost-control/cost-control.module';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

@Module({
  imports: [CostControlModule],
  controllers: [ExportsController],
  providers: [ExportsService],
})
export class ExportsModule {}
