import { Module } from '@nestjs/common';
import { ProveedoresController } from './proveedores.controller';
import { ProveedoresService } from './proveedores.service';
import { DbService } from '../../db/db.service';

@Module({
  controllers: [ProveedoresController],
  providers: [ProveedoresService, DbService],
  exports: [ProveedoresService],
})
export class ProveedoresModule {}
