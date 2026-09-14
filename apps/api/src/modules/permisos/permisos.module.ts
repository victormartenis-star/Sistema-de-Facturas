import { Module } from '@nestjs/common';
import { PermisosController } from './permisos.controller';
import { PermisosService } from './permisos.service';
import { DbService } from '../../db/db.service';

@Module({
  controllers: [PermisosController],
  providers: [PermisosService, DbService],
  exports: [PermisosService],
})
export class PermisosModule {}
