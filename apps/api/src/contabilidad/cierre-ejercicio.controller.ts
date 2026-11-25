import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  aplicacionResultadoAnularSchema,
  aplicacionResultadoSchema,
  cierreEjercicioRevertirSchema,
  ejercicioParamSchema,
  exportacionCuentasQuerySchema,
  type AplicacionResultadoAnularInput,
  type AplicacionResultadoInput,
  type CierreEjercicioRevertirInput,
  type ExportacionCuentasQuery,
} from '@erp/shared';
import { AplicacionResultadoService } from './aplicacion-resultado.service';
import { Roles } from '../auth/roles';
import { Idempotente } from '../common/idempotencia/idempotente.decorator';
import { VersionEsperada } from '../common/version';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CierreEjercicioService } from './cierre-ejercicio.service';

/**
 * Cierre y apertura del ejercicio. Lectura: admin, gerente, administración y
 * lector. Cerrar y revertir: solo admin y gerente (segregación de funciones,
 * igual que el cierre de períodos). Las acciones admiten `Idempotency-Key`;
 * revertir, también `If-Match` con la versión del cierre.
 */
@Controller('contabilidad/ejercicios')
@Roles('admin', 'gerente', 'administracion', 'lector')
export class CierreEjercicioController {
  constructor(
    private readonly service: CierreEjercicioService,
    private readonly aplicacion: AplicacionResultadoService,
  ) {}

  @Get()
  listar() {
    return this.service.listar();
  }

  /** Vista previa: regularización, cierre, apertura, resultado e impedimentos. */
  @Get(':ejercicio/cierre')
  propuesta(
    @Param('ejercicio', new ZodValidationPipe(ejercicioParamSchema))
    ejercicio: number,
  ) {
    return this.service.propuesta(ejercicio);
  }

  @Post(':ejercicio/cerrar')
  @Roles('admin', 'gerente')
  @Idempotente()
  @HttpCode(200)
  cerrar(
    @Param('ejercicio', new ZodValidationPipe(ejercicioParamSchema))
    ejercicio: number,
  ) {
    return this.service.cerrar(ejercicio);
  }

  /** Cuentas anuales: balance por masas y PyG (saldos antes del cierre). */
  @Get(':ejercicio/cuentas-anuales')
  cuentasAnuales(
    @Param('ejercicio', new ZodValidationPipe(ejercicioParamSchema))
    ejercicio: number,
  ) {
    return this.aplicacion.cuentasAnuales(ejercicio);
  }

  /**
   * Exportación de las cuentas anuales (CSV con BOM o JSON canónico). La
   * huella SHA-256 del contenido va en `X-Content-SHA256` y en la auditoría.
   */
  @Get(':ejercicio/cuentas-anuales/exportar')
  async exportarCuentasAnuales(
    @Param('ejercicio', new ZodValidationPipe(ejercicioParamSchema))
    ejercicio: number,
    @Query(new ZodValidationPipe(exportacionCuentasQuerySchema))
    q: ExportacionCuentasQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.aplicacion.exportar(ejercicio, q.formato);
    res.setHeader('Content-Type', out.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${out.fileName}"`,
    );
    res.setHeader('X-Content-SHA256', out.sha256);
    return out.body;
  }

  /** Resultado, saldos de PN, reserva legal mínima y destinos admitidos. */
  @Get(':ejercicio/aplicacion-resultado')
  propuestaAplicacion(
    @Param('ejercicio', new ZodValidationPipe(ejercicioParamSchema))
    ejercicio: number,
  ) {
    return this.aplicacion.propuesta(ejercicio);
  }

  @Post(':ejercicio/aplicar-resultado')
  @Roles('admin', 'gerente')
  @Idempotente()
  @HttpCode(200)
  aplicarResultado(
    @Param('ejercicio', new ZodValidationPipe(ejercicioParamSchema))
    ejercicio: number,
    @Body(new ZodValidationPipe(aplicacionResultadoSchema))
    body: AplicacionResultadoInput,
  ) {
    return this.aplicacion.aplicar(ejercicio, body);
  }

  @Post(':ejercicio/aplicacion-resultado/anular')
  @Roles('admin', 'gerente')
  @Idempotente()
  @HttpCode(200)
  anularAplicacion(
    @Param('ejercicio', new ZodValidationPipe(ejercicioParamSchema))
    ejercicio: number,
    @Body(new ZodValidationPipe(aplicacionResultadoAnularSchema))
    body: AplicacionResultadoAnularInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.aplicacion.anular(ejercicio, body, version);
  }

  @Post(':ejercicio/revertir')
  @Roles('admin', 'gerente')
  @Idempotente()
  @HttpCode(200)
  revertir(
    @Param('ejercicio', new ZodValidationPipe(ejercicioParamSchema))
    ejercicio: number,
    @Body(new ZodValidationPipe(cierreEjercicioRevertirSchema))
    body: CierreEjercicioRevertirInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.revertir(ejercicio, body, version);
  }
}
