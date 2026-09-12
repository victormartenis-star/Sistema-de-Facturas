import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  /** KPIs globales de la empresa: obras, certificaciones, tesorería, compras. */
  @Get('resumen')
  resumen() {
    return this.service.resumen();
  }

  /** KPIs económicos por obra: margen bruto, % certificado, coste real. */
  @Get('obras')
  obrasKpi() {
    return this.service.obrasKpi();
  }
}
