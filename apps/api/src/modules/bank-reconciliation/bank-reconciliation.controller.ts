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
  reconcileTransactionSchema,
} from '@erp/shared';
import { Roles } from '../../auth/roles';
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
    if (!file) throw new BadRequestException('Falta el fichero del extracto');
    if (!BANK_STATEMENT_FORMATS.includes(format as BankStatementFormat)) {
      throw new BadRequestException(
        `Formato no reconocido: usa ${BANK_STATEMENT_FORMATS.join(' o ')}`,
      );
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
}
