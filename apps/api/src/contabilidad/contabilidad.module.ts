import { Module } from '@nestjs/common';
import { AplicacionResultadoService } from './aplicacion-resultado.service';
import { CierreEjercicioController } from './cierre-ejercicio.controller';
import { CierreEjercicioService } from './cierre-ejercicio.service';
import { ContabilidadController } from './contabilidad.controller';
import { ContabilidadService } from './contabilidad.service';

@Module({
  controllers: [ContabilidadController, CierreEjercicioController],
  providers: [
    ContabilidadService,
    CierreEjercicioService,
    AplicacionResultadoService,
  ],
  exports: [ContabilidadService],
})
export class ContabilidadModule {}
