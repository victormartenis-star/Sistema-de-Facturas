import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { User, projects, users } from '@erp/db';
import {
  ProjectAssignment,
  SessionDto,
  UserCreateInput,
  UserDto,
  UserRole,
  UserUpdateInput,
  capabilitiesOf,
  isProjectScoped,
  type LoginInput,
  userCreateSchema,
  userUpdateSchema,
} from '@erp/shared';
import { DbService } from '../db/db.service';
import type { AuthUser } from './auth.decorators';
import { hashPassword, verifyPassword } from './password';
import { TokenService } from './token.service';

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private cachedDummy: string | undefined;

  constructor(
    private readonly dbs: DbService,
    private readonly tokens: TokenService,
  ) {}

  async login(input: LoginInput): Promise<SessionDto> {
    const email = String(input.email).trim().toLowerCase();
    const [user] = await this.dbs.db
      .select()
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);

    // Mismo mensaje y coste parecido tanto si falla el email como la
    // contraseña: no se revela qué cuentas existen.
    const ok =
      user && user.isActive
        ? await verifyPassword(input.password, user.passwordHash)
        : await verifyPassword(input.password, await this.dummyHash());
    if (!user || !user.isActive || !ok) {
      throw new UnauthorizedException('Email o contraseña incorrectos');
    }

    await this.dbs.db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

    this.logger.log(`Sesión iniciada por ${user.email} (${user.role})`);
    return {
      token: this.tokens.sign({
        sub: user.id,
        email: user.email,
        role: user.role as UserRole,
        companyId: user.companyId,
      }),
      user: await this.toDto(user),
      capabilities: capabilitiesOf(user.role as UserRole),
    };
  }

  /** Datos del usuario para la guarda; null si ya no puede entrar. */
  async resolveUser(id: string): Promise<AuthUser | null> {
    const [user] = await this.dbs.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    if (!user || !user.isActive) return null;

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role as UserRole,
      companyId: user.companyId,
      projectIds: isProjectScoped(user.role as UserRole)
        ? ((await this.assignmentsOf([user.id]))
            .get(user.id)
            ?.map((a) => a.id) ?? [])
        : [],
    };
  }

  async me(
    id: string,
  ): Promise<SessionDto['user'] & { capabilities: string[] }> {
    const [user] = await this.dbs.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Sesión no válida');
    }
    return {
      ...(await this.toDto(user)),
      capabilities: capabilitiesOf(user.role as UserRole),
    };
  }

  async listUsers(): Promise<UserDto[]> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const rows = await this.dbs.db
      .select()
      .from(users)
      .where(and(eq(users.companyId, companyId), isNull(users.deletedAt)))
      .orderBy(asc(users.fullName));

    // Las asignaciones de todos, en una sola consulta (sin N+1).
    const assignments = await this.assignmentsOf(rows.map((r) => r.id));
    return rows.map((r) => this.buildDto(r, assignments.get(r.id) ?? []));
  }

  async createUser(input: UserCreateInput): Promise<UserDto> {
    const companyId = await this.dbs.getDefaultCompanyId();
    const data = userCreateSchema.parse(input);
    const email = data.email.trim().toLowerCase();
    try {
      const [row] = await this.dbs.db
        .insert(users)
        .values({
          companyId,
          email,
          fullName: data.fullName,
          role: data.role as UserRole,
          passwordHash: await hashPassword(data.password),
        })
        .returning();
      this.logger.log(`Usuario creado: ${email} (${data.role})`);
      return this.toDto(row);
    } catch (err) {
      if (
        err instanceof Error &&
        'code' in err &&
        (err as { code?: string }).code === UNIQUE_VIOLATION
      ) {
        throw new ConflictException(
          `Ya existe un usuario con el email ${email}`,
        );
      }
      throw err;
    }
  }

  async updateUser(id: string, input: UserUpdateInput): Promise<UserDto> {
    const user = await this.findUser(id);
    const data = userUpdateSchema.parse(input);

    await this.dbs.db
      .update(users)
      .set({
        ...(data.fullName !== undefined && { fullName: data.fullName }),
        ...(data.role !== undefined && { role: data.role as UserRole }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.password !== undefined && {
          passwordHash: await hashPassword(data.password),
        }),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
    return this.toDto(await this.findUser(id));
  }

  /* ────────────────────────── privados ────────────────────────── */

  /**
   * Obras asignadas a cada usuario, con el papel que ocupa en cada una. Salen
   * de las tres columnas de responsable de `projects`, que es donde el manual
   * dice que quede escrita la asignación.
   */
  private async assignmentsOf(
    userIds: string[],
  ): Promise<
    Map<string, { id: string; code: string; as: ProjectAssignment }[]>
  > {
    const map = new Map<
      string,
      { id: string; code: string; as: ProjectAssignment }[]
    >();
    if (userIds.length === 0) return map;

    const rows = await this.dbs.db
      .select({
        id: projects.id,
        code: projects.code,
        groupManagerId: projects.groupManagerId,
        siteManagerId: projects.siteManagerId,
        foremanId: projects.foremanId,
      })
      .from(projects)
      .where(
        and(
          isNull(projects.deletedAt),
          or(
            inArray(projects.groupManagerId, userIds),
            inArray(projects.siteManagerId, userIds),
            inArray(projects.foremanId, userIds),
          ),
        ),
      )
      .orderBy(asc(projects.code));

    const push = (
      userId: string | null,
      project: { id: string; code: string },
      as: ProjectAssignment,
    ) => {
      if (!userId || !userIds.includes(userId)) return;
      const list = map.get(userId) ?? [];
      list.push({ ...project, as });
      map.set(userId, list);
    };

    for (const r of rows) {
      const project = { id: r.id, code: r.code };
      push(r.groupManagerId, project, 'jefe_grupo');
      push(r.siteManagerId, project, 'jefe_obra');
      push(r.foremanId, project, 'encargado');
    }
    return map;
  }

  private async toDto(row: User): Promise<UserDto> {
    const assignments = await this.assignmentsOf([row.id]);
    return this.buildDto(row, assignments.get(row.id) ?? []);
  }

  private buildDto(
    row: User,
    projectsList: { id: string; code: string; as: ProjectAssignment }[],
  ): UserDto {
    return {
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      role: row.role as UserRole,
      isActive: row.isActive,
      projects: projectsList,
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async findUser(id: string): Promise<User> {
    const [row] = await this.dbs.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Usuario no encontrado');
    return row;
  }

  /** Hash de descarte para igualar el tiempo de un email inexistente. */
  private async dummyHash(): Promise<string> {
    this.cachedDummy ??= await hashPassword('contraseña-inexistente');
    return this.cachedDummy;
  }
}
