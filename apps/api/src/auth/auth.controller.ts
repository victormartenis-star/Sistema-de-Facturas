import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import {
  AuthTokensDto,
  LoginInput,
  RefreshInput,
  RegisterInput,
  UserDto,
  loginSchema,
  refreshSchema,
  registerSchema,
} from '@erp/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import { AuthenticatedRequest } from './jwt-auth.guard';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
  ): Promise<AuthTokensDto> {
    return this.auth.register(body);
  }

  @Public()
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
}
