import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module';
import { CertificationsController } from './certifications.controller';
import { CertificationsService } from './certifications.service';

@Module({
  imports: [InvoicesModule],
  controllers: [CertificationsController],
  providers: [CertificationsService],
})
export class CertificationsModule {}
