import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  LoginInput,
  UserCreateInput,
  UserUpdateInput,
  loginSchema,
  userCreateSchema,
  userUpdateSchema,
} from '@erp/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import {
  CurrentUser,
  Public,
  RequireCapability,
  type AuthUser,
} from './auth.decorators';

@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput) {
    return this.service.login(body);
  }

  /** Quién soy y qué puedo hacer; lo usa la interfaz al recargar. */
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.service.me(user.id);
  }

  @Get('users')
  @RequireCapability('usuarios.gestionar')
  listUsers() {
    return this.service.listUsers();
  }

  @Post('users')
  @RequireCapability('usuarios.gestionar')
  createUser(
    @Body(new ZodValidationPipe(userCreateSchema)) body: UserCreateInput,
  ) {
    return this.service.createUser(body);
  }

  @Patch('users/:id')
  @RequireCapability('usuarios.gestionar')
  updateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(userUpdateSchema)) body: UserUpdateInput,
  ) {
    return this.service.updateUser(id, body);
  }
}
