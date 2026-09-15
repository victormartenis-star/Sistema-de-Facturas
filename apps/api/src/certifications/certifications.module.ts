import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module';
import { ChangeOrdersModule } from '../modules/change-orders/change-orders.module';
import { CertificationsController } from './certifications.controller';
import { CertificationsService } from './certifications.service';
import { CertificationLinesController } from './certification-lines.controller';
import { CertificationLinesService } from './certification-lines.service';

@Module({
  // ChangeOrdersModule: bloquea certificar una partida con un
  // contradictorio/modificado pendiente de resolver, ver
  // `CertificationLinesService.create()`.
  imports: [InvoicesModule, ChangeOrdersModule],
  controllers: [CertificationsController, CertificationLinesController],
  providers: [CertificationsService, CertificationLinesService],
})
export class CertificationsModule {}
