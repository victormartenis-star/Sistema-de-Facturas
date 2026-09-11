import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { RequestContextInterceptor } from '../common/request-context.interceptor';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles';

/**
 * `JwtAuthGuard` y `RolesGuard` se registran aquí como `APP_GUARD`: se
 * aplican a **todos** los controladores del proceso (marca `@Public()` la
 * ruta que deba quedar abierta). `RequestContextInterceptor` publica
 * `req.user` para que `DbService.getCompanyId()` lo lea en cualquier capa.
 */
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAuthGuard,
    RolesGuard,
    RequestContextInterceptor,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
  ],
  exports: [AuthService],
})
export class AuthModule {}
