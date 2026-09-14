import { Module } from '@nestjs/common';
import { ComparativosController } from './comparativos.controller';
import { ComparativosService } from './comparativos.service';

@Module({
  controllers: [ComparativosController],
  providers: [ComparativosService],
  exports: [ComparativosService],
})
export class ComparativosModule {}
