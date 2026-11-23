import { Module } from '@nestjs/common';
import { ContabilidadModule } from '../contabilidad/contabilidad.module';
import { AlmacenController } from './almacen.controller';
import { AlmacenService } from './almacen.service';

@Module({
  imports: [ContabilidadModule],
  controllers: [AlmacenController],
  providers: [AlmacenService],
})
export class AlmacenModule {}
