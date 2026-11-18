import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  AuthTokensDto,
  ChangePasswordInput,
  LoginInput,
  RefreshInput,
  RegisterInput,
  UserDto,
  changePasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
} from '@erp/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import { AuthenticatedRequest } from './jwt-auth.guard';
import { Public } from './public.decorator';
import { PermiteLector } from './read-only.guard';

/**
 * Límite estricto para los dos puntos de entrada de credenciales: 5/min por IP
 * en vez de los 100/min globales. `AUTH_LOGIN_RATE_LIMIT` lo cambia solo para
 * entornos de prueba que hacen muchos logins desde una misma IP (E2E de
 * Playwright); en producción se deja sin definir. Un valor no válido cae al 5.
 */
const LIMITE_LOGIN_POR_DEFECTO = 5;
const limiteLogin = Number(process.env.AUTH_LOGIN_RATE_LIMIT);
const AUTH_THROTTLE = {
  default: {
    limit:
      Number.isInteger(limiteLogin) && limiteLogin > 0
        ? limiteLogin
        : LIMITE_LOGIN_POR_DEFECTO,
    ttl: 60_000,
  },
};

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
  ): Promise<AuthTokensDto> {
    return this.auth.register(body);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(200)
  login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
  ): Promise<AuthTokensDto> {
    return this.auth.login(body);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(
    @Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput,
  ): Promise<AuthTokensDto> {
    return this.auth.refresh(body.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput,
  ): Promise<void> {
    await this.auth.logout(body.refreshToken);
  }

  /** Ya protegido por el `JwtAuthGuard` global (no es `@Public()`). */
  @Get('me')
  me(@Req() req: AuthenticatedRequest): Promise<UserDto> {
    return this.auth.me(req.user.sub);
  }

  /** Cambio de contraseña propia (exige la actual). Ver `changePassword` en el servicio. */
  @PermiteLector()
  @Patch('password')
  @HttpCode(204)
  async changePassword(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(changePasswordSchema))
    body: ChangePasswordInput,
  ): Promise<void> {
    await this.auth.changePassword(
      req.user.sub,
      body.currentPassword,
      body.newPassword,
    );
  }
}
