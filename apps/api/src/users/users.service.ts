import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { User, refreshTokens, userProjectAccess, users } from '@erp/db';
import {
  UserCreateInput,
  UserDto,
  UserRole,
  UserUpdateInput,
  userCreateSchema,
  userUpdateSchema,
} from '@erp/shared';
import { DbService } from '../db/db.service';
import { hashPassword } from '../auth/password';

const UNIQUE_VIOLATION = '23505';

function toDto(row: User): UserDto {
  return {
    id: row.id,
    companyId: row.companyId,
    email: row.email,
    fullName: row.fullName,
    role: row.role as UserRole,
    contactId: row.contactId,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class UsersService {
  constructor(private readonly dbs: DbService) {}

  async list(): Promise<UserDto[]> {
    const companyId = this.dbs.getCompanyId();
    const rows = await this.dbs.db
      .select()
      .from(users)
      .where(and(eq(users.companyId, companyId), isNull(users.deletedAt)))
      .orderBy(asc(users.fullName));
    return rows.map(toDto);
  }

  async create(input: UserCreateInput): Promise<UserDto> {
    const companyId = this.dbs.getCompanyId();
    const data = userCreateSchema.parse(input);
    try {
      const [row] = await this.dbs.db
        .insert(users)
        .values({
          companyId,
          email: data.email,
          passwordHash: await hashPassword(data.password),
          fullName: data.fullName,
          role: data.role,
          contactId: data.contactId ?? null,
        })
        .returning();
      return toDto(row);
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new ConflictException('Ya existe un usuario con ese email');
      }
      throw err;
    }
  }

  async update(id: string, input: UserUpdateInput): Promise<UserDto> {
    const companyId = this.dbs.getCompanyId();
    const data = userUpdateSchema.parse(input);
    const [row] = await this.dbs.db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(users.id, id),
          eq(users.companyId, companyId),
          isNull(users.deletedAt),
        ),
      )
      .returning();
    if (!row) throw new NotFoundException('Usuario no encontrado');
    return toDto(row);
  }

  async remove(id: string): Promise<void> {
    const companyId = this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .update(users)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(users.id, id),
          eq(users.companyId, companyId),
          isNull(users.deletedAt),
        ),
      )
      .returning({ id: users.id });
    if (!row) throw new NotFoundException('Usuario no encontrado');
    // Revocar acceso a obras del usuario eliminado
    await this.dbs.db
      .delete(userProjectAccess)
      .where(eq(userProjectAccess.userId, id));
  }

  /** Lista los projectId a los que tiene acceso un usuario (rol obra). */
  async listAccess(userId: string): Promise<string[]> {
    await this.findRow(userId);
    const rows = await this.dbs.db
      .select({ projectId: userProjectAccess.projectId })
      .from(userProjectAccess)
      .where(eq(userProjectAccess.userId, userId));
    return rows.map((r) => r.projectId);
  }

  /** Reemplaza el acceso a obras de un usuario. */
  async setAccess(userId: string, projectIds: string[]): Promise<void> {
    await this.findRow(userId);
    await this.dbs.db
      .delete(userProjectAccess)
      .where(eq(userProjectAccess.userId, userId));
    if (projectIds.length > 0) {
      await this.dbs.db
        .insert(userProjectAccess)
        .values(projectIds.map((projectId) => ({ userId, projectId })));
    }
  }

  /**
   * Reset de contraseña por un admin: sin la actual, solo la nueva —
   * revoca también las sesiones abiertas del usuario, igual que el cambio
   * de contraseña propia (`AuthService.changePassword`).
   */
  async resetPassword(id: string, newPassword: string): Promise<void> {
    await this.findRow(id);
    await this.dbs.db
      .update(users)
      .set({
        passwordHash: await hashPassword(newPassword),
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));
    await this.dbs.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(refreshTokens.userId, id), isNull(refreshTokens.revokedAt)),
      );
  }

  /** Confirma que el usuario existe, no está borrado y es de la empresa del que llama. */
  private async findRow(id: string): Promise<User> {
    const companyId = this.dbs.getCompanyId();
    const [row] = await this.dbs.db
      .select()
      .from(users)
      .where(
        and(
          eq(users.id, id),
          eq(users.companyId, companyId),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Usuario no encontrado');
    return row;
  }
}
