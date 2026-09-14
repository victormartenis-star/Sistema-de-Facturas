import { Module } from '@nestjs/common';
import { IncidenciasPRLController } from './incidencias-prl.controller';
import { IncidenciasPRLService } from './incidencias-prl.service';
import { DbService } from '../../db/db.service';

@Module({
  controllers: [IncidenciasPRLController],
  providers: [IncidenciasPRLService, DbService],
  exports: [IncidenciasPRLService],
})
export class IncidenciasPRLModule {}
