import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { ExtractionService } from './extraction.service';
import { OcrController } from './ocr.controller';
import { OcrWorker } from './ocr.worker';
import { ValidationService } from './validation.service';

@Module({
  imports: [DocumentsModule, InvoicesModule],
  controllers: [OcrController],
  providers: [ExtractionService, ValidationService, OcrWorker],
  exports: [ExtractionService],
})
export class OcrModule {}
