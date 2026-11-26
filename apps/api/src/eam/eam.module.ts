import { Module } from '@nestjs/common';
import { EamController } from './eam.controller';
import { EquiposEamService } from './equipos-eam.service';
import { ExplotacionService } from './explotacion.service';
import { OrdenesService } from './ordenes.service';

/** Enterprise Asset Management de maquinaria (fase 6). */
@Module({
  controllers: [EamController],
  providers: [EquiposEamService, OrdenesService, ExplotacionService],
})
export class EamModule {}
