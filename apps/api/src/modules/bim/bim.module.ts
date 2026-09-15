import { Module } from '@nestjs/common';
import { DocumentsModule } from '../../documents/documents.module';
import { BimController } from './bim.controller';
import { BimService } from './bim.service';

@Module({
  imports: [DocumentsModule],
  controllers: [BimController],
  providers: [BimService],
})
export class BimModule {}
