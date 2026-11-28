import { Module } from '@nestjs/common';
import { CostControlModule } from '../cost-control/cost-control.module';
import { CentrosCosteService } from './centros-coste.service';
import { ControlAnaliticoController } from './control-analitico.controller';
import { ForecastService } from './forecast.service';
import { RepartosService } from './repartos.service';

/** Control analítico: centros de coste, repartos y rolling forecast. */
@Module({
  imports: [CostControlModule],
  controllers: [ControlAnaliticoController],
  providers: [CentrosCosteService, RepartosService, ForecastService],
})
export class ControlAnaliticoModule {}
