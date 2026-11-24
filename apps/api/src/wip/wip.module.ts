import { Module } from '@nestjs/common';
import { ContabilidadModule } from '../contabilidad/contabilidad.module';
import { CostControlModule } from '../cost-control/cost-control.module';
import { WipController } from './wip.controller';
import { WipService } from './wip.service';

/** Obra en curso (WIP) al cierre de periodo. */
@Module({
  imports: [ContabilidadModule, CostControlModule],
  controllers: [WipController],
  providers: [WipService],
})
export class WipModule {}
