import { Module } from '@nestjs/common';
import { ContabilidadController } from './contabilidad.controller';
import { ContabilidadService } from './contabilidad.service';

@Module({
  controllers: [ContabilidadController],
  providers: [ContabilidadService],
  exports: [ContabilidadService],
})
export class ContabilidadModule {}
