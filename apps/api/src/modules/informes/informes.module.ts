import { Module } from '@nestjs/common';
import { AlertsModule } from '../../alerts/alerts.module';
import { DashboardModule } from '../../dashboard/dashboard.module';
import { CostControlModule } from '../../cost-control/cost-control.module';
import { InformesController } from './informes.controller';
import { InformesService } from './informes.service';

@Module({
  imports: [DashboardModule, CostControlModule, AlertsModule],
  controllers: [InformesController],
  providers: [InformesService],
})
export class InformesModule {}
