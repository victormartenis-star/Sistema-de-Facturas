import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import {
  centroCosteCreateSchema,
  centroCosteUpdateSchema,
  cicloRepartoCreateSchema,
  cicloRepartoUpdateSchema,
  escenarioCreateSchema,
  escenarioUpdateSchema,
  fotoPrevisionCreateSchema,
  periodoRepartoSchema,
  previsionQuerySchema,
  revertirRepartoSchema,
  type CentroCosteCreateInput,
  type CentroCosteUpdateInput,
  type CicloRepartoCreateInput,
  type CicloRepartoUpdateInput,
  type EscenarioCreateInput,
  type EscenarioUpdateInput,
  type FotoPrevisionCreateInput,
  type PeriodoReparto,
  type PrevisionQuery,
  type RevertirRepartoInput,
} from '@erp/shared';
import { Roles } from '../auth/roles';
import { Idempotente } from '../common/idempotencia/idempotente.decorator';
import { VersionEsperada } from '../common/version';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CentrosCosteService } from './centros-coste.service';
import { ForecastService } from './forecast.service';
import { RepartosService } from './repartos.service';

const fechaQuery = z.object({
  hasta: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: AAAA-MM-DD'),
});
const cicloQuery = z.object({ cicloId: z.string().uuid().optional() });
const escenarioQuery = z.object({ escenarioId: z.string().uuid().optional() });

/**
 * Control analítico (SAP CO / Oracle Cost Management y EPM). Lectura:
 * admin, gerente, administración y lector; el rol obra ve el coste completo,
 * la previsión y las líneas de reparto de sus obras. Maestros (centros,
 * ciclos, escenarios) y ejecución/reversión de repartos: admin y gerente.
 * Fotos de previsión: además administración.
 */
@Controller('control-analitico')
@Roles('admin', 'gerente', 'administracion', 'lector')
export class ControlAnaliticoController {
  constructor(
    private readonly centros: CentrosCosteService,
    private readonly repartos: RepartosService,
    private readonly forecast: ForecastService,
  ) {}

  /* ─────────────────────────── centros de coste ─────────────────────────── */

  @Get('centros')
  listarCentros() {
    return this.centros.listar();
  }

  /** Saldo analítico por centro y cuenta: primario, recibido, repartido. */
  @Get('centros/saldos')
  saldos(
    @Query(new ZodValidationPipe(periodoRepartoSchema)) q: PeriodoReparto,
  ) {
    return this.centros.saldos(q);
  }

  @Get('centros/:id')
  centro(@Param('id', ParseUUIDPipe) id: string) {
    return this.centros.obtener(id);
  }

  @Post('centros')
  @Roles('admin', 'gerente')
  @Idempotente()
  crearCentro(
    @Body(new ZodValidationPipe(centroCosteCreateSchema))
    body: CentroCosteCreateInput,
  ) {
    return this.centros.crear(body);
  }

  @Patch('centros/:id')
  @Roles('admin', 'gerente')
  actualizarCentro(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(centroCosteUpdateSchema))
    body: CentroCosteUpdateInput,
    @VersionEsperada({ exigible: true }) version: number | undefined,
  ) {
    return this.centros.actualizar(id, body, version);
  }

  /* ─────────────────────────── ciclos de reparto ─────────────────────────── */

  @Get('ciclos')
  ciclos() {
    return this.repartos.listar();
  }

  @Get('ciclos/:id')
  ciclo(@Param('id', ParseUUIDPipe) id: string) {
    return this.repartos.obtener(id);
  }

  @Post('ciclos')
  @Roles('admin', 'gerente')
  @Idempotente()
  crearCiclo(
    @Body(new ZodValidationPipe(cicloRepartoCreateSchema))
    body: CicloRepartoCreateInput,
  ) {
    return this.repartos.crear(body);
  }

  @Patch('ciclos/:id')
  @Roles('admin', 'gerente')
  actualizarCiclo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cicloRepartoUpdateSchema))
    body: CicloRepartoUpdateInput,
    @VersionEsperada({ exigible: true }) version: number | undefined,
  ) {
    return this.repartos.actualizar(id, body, version);
  }

  /** Previsualización del reparto (no escribe nada). */
  @Post('ciclos/:id/simular')
  @HttpCode(200)
  simular(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(periodoRepartoSchema)) body: PeriodoReparto,
  ) {
    return this.repartos.simular(id, body);
  }

  @Post('ciclos/:id/ejecutar')
  @Roles('admin', 'gerente')
  @Idempotente()
  ejecutar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(periodoRepartoSchema)) body: PeriodoReparto,
  ) {
    return this.repartos.ejecutar(id, body);
  }

  @Get('ejecuciones')
  ejecuciones(
    @Query(new ZodValidationPipe(cicloQuery)) q: { cicloId?: string },
  ) {
    return this.repartos.ejecuciones(q);
  }

  @Get('ejecuciones/:id')
  @Roles('admin', 'gerente', 'administracion', 'lector', 'obra')
  ejecucion(@Param('id', ParseUUIDPipe) id: string) {
    return this.repartos.ejecucion(id);
  }

  @Post('ejecuciones/:id/revertir')
  @Roles('admin', 'gerente')
  @Idempotente()
  @HttpCode(200)
  revertir(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(revertirRepartoSchema))
    body: RevertirRepartoInput,
    @VersionEsperada({ exigible: true }) version: number | undefined,
  ) {
    return this.repartos.revertir(id, body, version);
  }

  /* ─────────────────────── coste completo y previsión ─────────────────────── */

  @Get('coste-obras')
  @Roles('admin', 'gerente', 'administracion', 'lector', 'obra')
  costeObras(@Query(new ZodValidationPipe(fechaQuery)) q: { hasta: string }) {
    return this.forecast.costeObras(q.hasta);
  }

  @Get('escenarios')
  @Roles('admin', 'gerente', 'administracion', 'lector', 'obra')
  escenarios() {
    return this.forecast.escenarios();
  }

  @Post('escenarios')
  @Roles('admin', 'gerente')
  @Idempotente()
  crearEscenario(
    @Body(new ZodValidationPipe(escenarioCreateSchema))
    body: EscenarioCreateInput,
  ) {
    return this.forecast.crearEscenario(body);
  }

  @Post('escenarios/predeterminados')
  @Roles('admin', 'gerente')
  @HttpCode(200)
  predeterminados() {
    return this.forecast.escenariosPredeterminados();
  }

  @Patch('escenarios/:id')
  @Roles('admin', 'gerente')
  actualizarEscenario(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(escenarioUpdateSchema))
    body: EscenarioUpdateInput,
    @VersionEsperada({ exigible: true }) version: number | undefined,
  ) {
    return this.forecast.actualizarEscenario(id, body, version);
  }

  /** Rolling forecast por escenario, con varianza frente a la línea base. */
  @Get('forecast')
  @Roles('admin', 'gerente', 'administracion', 'lector', 'obra')
  prevision(
    @Query(new ZodValidationPipe(previsionQuerySchema)) q: PrevisionQuery,
  ) {
    return this.forecast.prevision(q);
  }

  @Get('fotos')
  fotos(
    @Query(new ZodValidationPipe(escenarioQuery)) q: { escenarioId?: string },
  ) {
    return this.forecast.fotos(q.escenarioId);
  }

  @Post('fotos')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  crearFoto(
    @Body(new ZodValidationPipe(fotoPrevisionCreateSchema))
    body: FotoPrevisionCreateInput,
  ) {
    return this.forecast.crearFoto(body);
  }
}
