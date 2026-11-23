import { Module } from '@nestjs/common';
import { ControlPresupuestarioService } from './control-presupuestario.service';
import { CostControlController } from './cost-control.controller';
import { CostControlService } from './cost-control.service';

@Module({
  controllers: [CostControlController],
  providers: [CostControlService, ControlPresupuestarioService],
  // El control presupuestario lo aplican pedidos y almacén en sus transacciones.
  exports: [CostControlService, ControlPresupuestarioService],
})
export class CostControlModule {}
