import { LoggerService } from '@nestjs/common';
import { logger } from './logger';

/** `LoggerService` de Nest sobre pino: los `new Logger(...)` salen en JSON. */
export class PinoNestLogger implements LoggerService {
  log(message: unknown, context?: string) {
    logger.info({ context }, this.texto(message));
  }
  error(message: unknown, ...resto: unknown[]) {
    const [traza, context] = resto as [string?, string?];
    logger.error({ context, trace: traza }, this.texto(message));
  }
  warn(message: unknown, context?: string) {
    logger.warn({ context }, this.texto(message));
  }
  debug(message: unknown, context?: string) {
    logger.debug({ context }, this.texto(message));
  }
  verbose(message: unknown, context?: string) {
    logger.trace({ context }, this.texto(message));
  }

  private texto(m: unknown): string {
    return typeof m === 'string' ? m : JSON.stringify(m);
  }
}
