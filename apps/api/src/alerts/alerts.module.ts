import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ComplianceModule } from '../compliance/compliance.module';
import { CostControlModule } from '../cost-control/cost-control.module';
import { PermisosModule } from '../modules/permisos/permisos.module';
import { RealEstateModule } from '../modules/real-estate/real-estate.module';
import { ProjectsModule } from '../projects/projects.module';
import { AlertsController } from './alerts.controller';
import { AlertsSchedulerService } from './alerts-scheduler.service';
import { AlertsService } from './alerts.service';
import { EmailService } from './email.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ComplianceModule,
    CostControlModule,
    PermisosModule,
    RealEstateModule,
    ProjectsModule,
  ],
  controllers: [AlertsController],
  providers: [AlertsService, AlertsSchedulerService, EmailService],
  exports: [EmailService],
})
export class AlertsModule {}
