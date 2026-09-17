import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  ResetPasswordInput,
  UserCreateInput,
  UserUpdateInput,
  resetPasswordSchema,
  userCreateSchema,
  userUpdateSchema,
} from '@erp/shared';
import { Roles } from '../auth/roles';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { UsersService } from './users.service';
import { z } from 'zod';

const projectIdsSchema = z.object({
  projectIds: z.array(z.string().uuid()).default([]),
});

/**
 * Gestión de usuarios: altas, bajas, roles y contraseñas de terceros son
 * cosa de `admin` — a diferencia de la mayoría de controladores del ERP, que
 * dejan pasar a cualquier rol interno cuando no anotan `@Roles`, aquí sí
 * hace falta anotarlo explícitamente porque el propio endpoint permite
 * escalar privilegios (asignar el rol `admin` a otro usuario, o resetearle
 * la contraseña).
 */
@Controller('users')
export class UsersController {
  constructor(private readonly service: UsersService) {}

  /** Lista todos los usuarios de la empresa. */
  @Get()
  @Roles('admin', 'gerente')
  list() {
    return this.service.list();
  }

  /** Crea un usuario nuevo (admin asigna contraseña inicial). */
  @Post()
  @Roles('admin')
  create(
    @Body(new ZodValidationPipe(userCreateSchema))
    body: UserCreateInput,
  ) {
    return this.service.create(body);
  }

  /** Actualiza nombre, rol o estado activo de un usuario. */
  @Patch(':id')
  @Roles('admin')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(userUpdateSchema)) body: UserUpdateInput,
  ) {
    return this.service.update(id, body);
  }

  /** Borrado lógico del usuario. */
  @Delete(':id')
  @HttpCode(204)
  @Roles('admin')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.remove(id);
  }

  /** Resetea la contraseña de otro usuario (sin pedir la actual) y cierra sus sesiones abiertas. */
  @Patch(':id/password')
  @HttpCode(204)
  @Roles('admin')
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(resetPasswordSchema))
    body: ResetPasswordInput,
  ) {
    await this.service.resetPassword(id, body.newPassword);
  }

  /** Lista de obras a las que tiene acceso el usuario (rol obra). */
  @Get(':id/acceso-obras')
  @Roles('admin', 'gerente')
  listAccess(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.listAccess(id);
  }

  /** Reemplaza el acceso a obras de un usuario (rol obra). */
  @Put(':id/acceso-obras')
  @HttpCode(204)
  @Roles('admin')
  async setAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(projectIdsSchema))
    body: { projectIds: string[] },
  ) {
    await this.service.setAccess(id, body.projectIds);
  }
}
