import { Module } from '@nestjs/common';
import { DocumentsModule } from '../../documents/documents.module';
import { ContractAiController } from './contract-ai.controller';
import { ContractAiService } from './contract-ai.service';

@Module({
  imports: [DocumentsModule],
  controllers: [ContractAiController],
  providers: [ContractAiService],
})
export class ContractAiModule {}
