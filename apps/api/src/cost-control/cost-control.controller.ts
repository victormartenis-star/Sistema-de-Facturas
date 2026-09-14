import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { CostControlService } from './cost-control.service';

@Controller()
export class CostControlController {
  constructor(private readonly service: CostControlService) {}

  /**
   * Analítica de costes en tiempo real: Coste Previsto (BAC) vs. Coste Real
   * Imputado (AC: facturas de compra + partes diarios) vs. Producción
   * Certificada (EV), margen bruto actual, EAC y alertas de sobrecoste por
   * partida. Ver [[Control de Costes y Partes Diarios]].
   */
  @Get('projects/:id/cost-control')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }
}
