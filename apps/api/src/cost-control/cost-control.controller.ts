import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  controlPresupuestarioUpdateSchema,
  cuadroMargenesQuerySchema,
  estimacionCierreSetSchema,
  margenesObraQuerySchema,
  type ControlPresupuestarioUpdateInput,
  type CuadroMargenesQuery,
  type EstimacionCierreSetInput,
  type MargenesObraQuery,
} from '@erp/shared';
import { Roles } from '../auth/roles';
import { Idempotente } from '../common/idempotencia/idempotente.decorator';
import { VersionEsperada } from '../common/version';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { EstimacionCierreService } from './estimacion-cierre.service';
import { ControlPresupuestarioService } from './control-presupuestario.service';
import { CostControlService } from './cost-control.service';

@Controller()
export class CostControlController {
  constructor(
    private readonly service: CostControlService,
    private readonly control: ControlPresupuestarioService,
    private readonly eac: EstimacionCierreService,
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

  /** Estimación al cierre (EAC) vigente, automática, efectiva e historial. */
  @Get('projects/:id/estimacion-cierre')
  @Roles('admin', 'gerente', 'administracion', 'lector', 'obra')
  estimacionCierre(@Param('id', ParseUUIDPipe) id: string) {
    return this.eac.obtener(id);
  }

  /**
   * Fija o retira (`costeEstimado: null`) la estimación al cierre: nueva
   * versión con motivo y fecha de efecto. `If-Match` con la versión vigente
   * (sin cabecera si nunca se fijó) e `Idempotency-Key`. También el jefe de
   * obra, en sus obras.
   */
  @Post('projects/:id/estimacion-cierre')
  @Roles('admin', 'gerente', 'administracion', 'obra')
  @Idempotente()
  @HttpCode(200)
  fijarEstimacionCierre(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(estimacionCierreSetSchema))
    body: EstimacionCierreSetInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.eac.fijar(id, body, version);
  }
}
