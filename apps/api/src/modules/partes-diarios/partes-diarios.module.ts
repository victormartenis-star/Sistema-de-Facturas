import { Module } from '@nestjs/common';
import { PartesDiariosController } from './partes-diarios.controller';
import { PartesDiariosService } from './partes-diarios.service';

@Module({
  controllers: [PartesDiariosController],
  providers: [PartesDiariosService],
  exports: [PartesDiariosService],
})
export class PartesDiariosModule {}
