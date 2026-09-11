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
  UserCreateInput,
  UserUpdateInput,
  userCreateSchema,
  userUpdateSchema,
} from '@erp/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { UsersService } from './users.service';
import { z } from 'zod';

const projectIdsSchema = z.object({
  projectIds: z.array(z.string().uuid()).default([]),
});

@Controller('users')
export class UsersController {
  constructor(private readonly service: UsersService) {}

  /** Lista todos los usuarios de la empresa. */
  @Get()
  list() {
    return this.service.list();
  }

  /** Crea un usuario nuevo (admin asigna contraseña inicial). */
  @Post()
  create(
    @Body(new ZodValidationPipe(userCreateSchema))
    body: UserCreateInput,
  ) {
    return this.service.create(body);
  }

  /** Actualiza nombre, rol o estado activo de un usuario. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(userUpdateSchema)) body: UserUpdateInput,
  ) {
    return this.service.update(id, body);
  }

  /** Borrado lógico del usuario. */
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.remove(id);
  }

  /** Lista de obras a las que tiene acceso el usuario (rol obra). */
  @Get(':id/acceso-obras')
  listAccess(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.listAccess(id);
  }

  /** Reemplaza el acceso a obras de un usuario (rol obra). */
  @Put(':id/acceso-obras')
  @HttpCode(204)
  async setAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(projectIdsSchema))
    body: { projectIds: string[] },
  ) {
    await this.service.setAccess(id, body.projectIds);
  }
}
