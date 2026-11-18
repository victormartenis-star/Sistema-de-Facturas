import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { IdempotenciaPurgaService } from './idempotencia/idempotencia-purga.service';
import { RequestIdMiddleware } from './middleware/request-id.middleware';

/**
 * Piezas transversales: filtro único de errores (RFC 7807), middleware de
 * `X-Request-Id` + log de acceso y purga de claves de idempotencia. El
 * middleware vive aquí (no en `AppModule`) para que también lo ejerciten los
 * módulos de prueba que importan este.
 */
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    IdempotenciaPurgaService,
  ],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Middleware, no interceptor: corre antes que los guards (401, 429).
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
