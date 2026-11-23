import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import {
  controlPresupuestarioUpdateSchema,
  cuadroMargenesQuerySchema,
  margenesObraQuerySchema,
  type ControlPresupuestarioUpdateInput,
  type CuadroMargenesQuery,
  type MargenesObraQuery,
} from '@erp/shared';
import { Roles } from '../auth/roles';
import { VersionEsperada } from '../common/version';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ControlPresupuestarioService } from './control-presupuestario.service';
import { CostControlService } from './cost-control.service';

@Controller()
export class CostControlController {
  constructor(
    private readonly service: CostControlService,
    private readonly control: ControlPresupuestarioService,
  ) {}

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

  /**
   * Economía de la obra: margen bruto, desviación por partida, retenciones
   * e IVA. Mismo control de acceso que `cost-control`.
   */
  @Get('projects/:id/economics')
  economics(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getEconomics(id);
  }

  /**
   * Cuadro de márgenes de la cartera visible: presupuestado, comprometido,
   * coste real (compras, partes, almacén y amortización), certificado,
   * facturado, cobrado, márgenes, desviación y estado del control.
   */
  @Get('cost-control/margenes')
  cuadro(
    @Query(new ZodValidationPipe(cuadroMargenesQuerySchema))
    q: CuadroMargenesQuery,
  ) {
    return this.control.cuadro(q);
  }

  /** Cuadro de una obra con desglose por partida y capítulo. */
  @Get('projects/:id/margenes')
  margenesObra(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(margenesObraQuerySchema)) q: MargenesObraQuery,
  ) {
    return this.control.margenesObra(id, q);
  }

  /** Configuración, evaluación y últimos eventos del control presupuestario. */
  @Get('projects/:id/control-presupuestario')
  estadoControl(@Param('id', ParseUUIDPipe) id: string) {
    return this.control.estado(id);
  }

  /** Modo (observación / aviso / bloqueo), tolerancia y umbral de aviso. */
  @Put('projects/:id/control-presupuestario')
  @Roles('admin', 'gerente')
  configurarControl(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(controlPresupuestarioUpdateSchema))
    body: ControlPresupuestarioUpdateInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.control.configurar(id, body, version);
  }
}
