import { Module } from '@nestjs/common';
import { AplicacionResultadoService } from './aplicacion-resultado.service';
import { CierreEjercicioController } from './cierre-ejercicio.controller';
import { CierreEjercicioService } from './cierre-ejercicio.service';
import { ConciliacionCierreController } from './conciliacion-cierre.controller';
import { ConciliacionCierreService } from './conciliacion-cierre.service';
import { ContabilidadController } from './contabilidad.controller';
import { ContabilidadService } from './contabilidad.service';

@Module({
  controllers: [
    ContabilidadController,
    CierreEjercicioController,
    ConciliacionCierreController,
  ],
  providers: [
    ContabilidadService,
    CierreEjercicioService,
    AplicacionResultadoService,
    ConciliacionCierreService,
  ],
  exports: [ContabilidadService],
})
export class ContabilidadModule {}
