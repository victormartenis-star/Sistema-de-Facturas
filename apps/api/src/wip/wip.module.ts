import { Module } from '@nestjs/common';
import { ContabilidadModule } from '../contabilidad/contabilidad.module';
import { CostControlModule } from '../cost-control/cost-control.module';
import { ProvisionPerdidasController } from './provision-perdidas.controller';
import { ProvisionPerdidasService } from './provision-perdidas.service';
import { WipController } from './wip.controller';
import { WipService } from './wip.service';

/**
 * Cierre de obra: obra en curso (WIP) y provisión por pérdidas previstas,
 * que comparte la producción ejecutada y el cuadro de márgenes.
 */
@Module({
  imports: [ContabilidadModule, CostControlModule],
  controllers: [WipController, ProvisionPerdidasController],
  providers: [WipService, ProvisionPerdidasService],
})
export class WipModule {}
