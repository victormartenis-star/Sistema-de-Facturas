import { Module } from '@nestjs/common';
import { ActasRecepcionController } from './actas-recepcion.controller';
import { ActasRecepcionService } from './actas-recepcion.service';
import { DbService } from '../../db/db.service';

@Module({
  controllers: [ActasRecepcionController],
  providers: [ActasRecepcionService, DbService],
  exports: [ActasRecepcionService],
})
export class ActasRecepcionModule {}
