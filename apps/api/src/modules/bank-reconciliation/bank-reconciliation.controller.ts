import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  BANK_STATEMENT_FORMATS,
  BankStatementFormat,
  ReconcileTransactionInput,
  conciliacionSchema,
  desconciliacionSchema,
  reconcileTransactionSchema,
  type ConciliacionInput,
  type DesconciliacionInput,
} from '@erp/shared';
import { Roles } from '../../auth/roles';
import { Idempotente } from '../../common/idempotencia/idempotente.decorator';
import { VersionEsperada } from '../../common/version';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { BankReconciliationService } from './bank-reconciliation.service';

@Controller('bank-reconciliation')
export class BankReconciliationController {
  constructor(private readonly service: BankReconciliationService) {}

  /** Multipart: `file` (el extracto), `bankAccountId`, `format` (`csv`|`norma43`). */
  @Post('importar')
  @UseInterceptors(FileInterceptor('file'))
  @Roles('admin', 'gerente', 'administracion')
  async importar(
    @UploadedFile() file: Express.Multer.File,
    @Body('bankAccountId', ParseUUIDPipe) bankAccountId: string,
    @Body('format') format: string,
  ) {
    if (!file)
      throw new BadRequestException({
        code: 'BANK_STATEMENT_FILE_REQUIRED',
        message: 'Falta el fichero del extracto',
      });
    if (!BANK_STATEMENT_FORMATS.includes(format as BankStatementFormat)) {
      throw new BadRequestException({
        code: 'BANK_STATEMENT_FORMAT_UNSUPPORTED',
        message: `Formato no reconocido: usa ${BANK_STATEMENT_FORMATS.join(' o ')}`,
      });
    }
    return this.service.importStatement(
      bankAccountId,
      format as BankStatementFormat,
      file.buffer.toString('utf-8'),
    );
  }

  @Get('transacciones')
  list(
    @Query('bankAccountId') bankAccountId?: string,
    @Query('reconciled') reconciled?: string,
  ) {
    return this.service.list(
      bankAccountId,
      reconciled === undefined ? undefined : reconciled === 'true',
    );
  }

  @Get('sugerencias')
  suggestions(@Query('bankAccountId', ParseUUIDPipe) bankAccountId: string) {
    return this.service.suggestions(bankAccountId);
  }

  @Post('transacciones/:id/conciliar')
  @Roles('admin', 'gerente', 'administracion')
  @HttpCode(204)
  async reconcile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reconcileTransactionSchema))
    body: ReconcileTransactionInput,
  ) {
    await this.service.reconcile(id, body.milestoneId);
  }

  @Post('transacciones/:id/desconciliar')
  @Roles('admin', 'gerente', 'administracion')
  @HttpCode(204)
  async unreconcile(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.unreconcile(id);
  }

  /* ───── Conciliación asistida (fase 5, 0069) ───── */

  /** Sugerencias puntuadas contra vencimientos, liquidaciones, remesas, devoluciones y talones. */
  @Get('asistida/sugerencias')
  sugerencias(@Query('bankAccountId', ParseUUIDPipe) bankAccountId: string) {
    return this.service.sugerencias(bankAccountId);
  }

  @Get('transacciones/:id')
  movimiento(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.movimiento(id);
  }

  @Post('transacciones/:id/conciliacion')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  conciliar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(conciliacionSchema)) body: ConciliacionInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.conciliar(id, body, version);
  }

  @Post('transacciones/:id/desconciliacion')
  @Roles('admin', 'gerente', 'administracion')
  @Idempotente()
  @HttpCode(200)
  desconciliar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(desconciliacionSchema))
    body: DesconciliacionInput,
    @VersionEsperada() version: number | undefined,
  ) {
    return this.service.desconciliar(id, body, version);
  }
}
