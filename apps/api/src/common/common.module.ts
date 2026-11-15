import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { RequestIdMiddleware } from './middleware/request-id.middleware';

/**
 * Piezas transversales: filtro único de errores (RFC 7807) y middleware de
 * `X-Request-Id` + log de acceso. El middleware vive aquí (no en `AppModule`)
 * para que también lo ejerciten los módulos de prueba que importan este.
 */
@Module({
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Middleware, no interceptor: corre antes que los guards (401, 429).
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
