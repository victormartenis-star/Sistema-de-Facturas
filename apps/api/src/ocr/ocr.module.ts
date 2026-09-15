import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { PurchaseOrdersModule } from '../purchase-orders/purchase-orders.module';
import { DeliveryNotesModule } from '../delivery-notes/delivery-notes.module';
import { ExtractionService } from './extraction.service';
import { OcrController } from './ocr.controller';
import { OcrWorker } from './ocr.worker';
import { ValidationService } from './validation.service';

@Module({
  imports: [
    DocumentsModule,
    InvoicesModule,
    PurchaseOrdersModule,
    DeliveryNotesModule,
  ],
  controllers: [OcrController],
  providers: [ExtractionService, ValidationService, OcrWorker],
  exports: [ExtractionService],
})
export class OcrModule {}
