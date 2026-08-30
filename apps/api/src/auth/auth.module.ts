import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

/**
 * Global para que la guarda pueda resolver el usuario desde cualquier módulo
 * sin que cada uno tenga que importar el de autenticación.
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    // Guarda global: todo endpoint queda protegido salvo los marcados @Public
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
