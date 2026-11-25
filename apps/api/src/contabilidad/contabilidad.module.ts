import { Module } from '@nestjs/common';
import { CierreEjercicioController } from './cierre-ejercicio.controller';
import { CierreEjercicioService } from './cierre-ejercicio.service';
import { ContabilidadController } from './contabilidad.controller';
import { ContabilidadService } from './contabilidad.service';

@Module({
  controllers: [ContabilidadController, CierreEjercicioController],
  providers: [ContabilidadService, CierreEjercicioService],
  exports: [ContabilidadService],
})
export class ContabilidadModule {}
