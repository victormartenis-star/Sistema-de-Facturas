import { Module } from '@nestjs/common';
import { ContabilidadModule } from '../contabilidad/contabilidad.module';
import { CostControlModule } from '../cost-control/cost-control.module';
import { AlmacenController } from './almacen.controller';
import { AlmacenService } from './almacen.service';

@Module({
  imports: [ContabilidadModule, CostControlModule],
  controllers: [AlmacenController],
  providers: [AlmacenService],
})
export class AlmacenModule {}
