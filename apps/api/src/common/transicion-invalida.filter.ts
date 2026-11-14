import {
  ArgumentsHost,
  Catch,
  ConflictException,
  ExceptionFilter,
} from '@nestjs/common';
import { TransicionInvalidaError } from '@erp/shared';

/**
 * Convierte `TransicionInvalidaError` (lanzado por la máquina de estados) en
 * 409, con el mismo cuerpo que cualquier `ConflictException`.
 */
@Catch(TransicionInvalidaError)
export class TransicionInvalidaFilter implements ExceptionFilter {
  catch(err: TransicionInvalidaError, host: ArgumentsHost): void {
    const exc = new ConflictException(err.message);
    host
      .switchToHttp()
      .getResponse<{
        status(c: number): { json(b: unknown): void };
      }>()
      .status(exc.getStatus())
      .json(exc.getResponse());
  }
}
