/**
 * Módulo de pruebas con controladores que provocan cada tipo de error, para
 * `request-id` y `problem-details` (sin auth ni negocio). Incluye throttler
 * real para el 429. No es un spec.
 */
import {
  Body,
  Controller,
  ConflictException,
  ForbiddenException,
  Get,
  HttpException,
  Module,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  SkipThrottle,
  Throttle,
  ThrottlerGuard,
  ThrottlerModule,
} from '@nestjs/throttler';
import { z } from 'zod';
import { TransicionInvalidaError } from '@erp/shared';
import { CommonModule } from '../../src/common/common.module';
import { conflictoVersion } from '../../src/common/version';
import { ZodValidationPipe } from '../../src/common/zod-validation.pipe';

export const MENSAJE_SECRETO = 'SELECT secreto FROM tabla_interna password=abc';

@SkipThrottle()
@Controller('probe')
class ProbeController {
  @Get('ok')
  ok() {
    return { ok: true };
  }
  @Get('boom')
  boom() {
    throw new Error(MENSAJE_SECRETO);
  }
  @Get('401')
  unauthorized() {
    throw new UnauthorizedException();
  }
  @Get('403')
  forbidden() {
    throw new ForbiddenException('No tienes permiso');
  }
  @Get('zod')
  zod() {
    z.object({ a: z.string() }).parse({});
  }
  @Post('pipe')
  pipe(@Body(new ZodValidationPipe(z.object({ n: z.number() }))) b: unknown) {
    return b;
  }
  @Get('version')
  version() {
    throw conflictoVersion(7);
  }
  @Get('transicion')
  transicion() {
    throw new TransicionInvalidaError('invoice' as never, 'draft', 'paid');
  }
  @Get('idem')
  idem(
    @Res({ passthrough: true }) res: { setHeader(k: string, v: string): void },
  ) {
    res.setHeader('Retry-After', '1');
    throw new ConflictException({
      code: 'IDEMPOTENCY_IN_PROGRESS',
      message: 'Hay una petición con esta Idempotency-Key en curso',
    });
  }
  @Get('428')
  precondition() {
    throw new HttpException(
      { code: 'PRECONDITION_REQUIRED', message: 'Falta If-Match' },
      428,
    );
  }
  @Get('503')
  audit() {
    throw new HttpException(
      { code: 'AUDIT_CHAIN_BUSY', message: 'ocupada' },
      503,
    );
  }
}

@Controller('limited')
class LimitedController {
  @Get()
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  get() {
    return { ok: true };
  }
}

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    CommonModule,
  ],
  controllers: [ProbeController, LimitedController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class ProblemProbeModule {}
