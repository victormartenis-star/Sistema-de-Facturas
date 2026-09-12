import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module';
import { CertificationsController } from './certifications.controller';
import { CertificationsService } from './certifications.service';
import { CertificationLinesController } from './certification-lines.controller';
import { CertificationLinesService } from './certification-lines.service';

@Module({
  imports: [InvoicesModule],
  controllers: [CertificationsController, CertificationLinesController],
  providers: [CertificationsService, CertificationLinesService],
})
export class CertificationsModule {}
