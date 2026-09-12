import { Module } from '@nestjs/common';
import { CopilotoController } from './copiloto.controller';
import { CopilotoService } from './copiloto.service';

@Module({
  controllers: [CopilotoController],
  providers: [CopilotoService],
})
export class CopilotoModule {}
