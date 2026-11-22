import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { DbOrTx, refreshTokens, User, users } from '@erp/db';
import {
  AccessTokenPayload,
  AuthTokensDto,
  LoginInput,
  RegisterInput,
  UserDto,
  UserRole,
} from '@erp/shared';
import { DbService } from '../db/db.service';
import { nowSeconds, signJwt, verifyJwt } from './jwt';
import { hashPassword, verifyPassword } from './password';

const ACCESS_TTL_SECONDS = Number(process.env.JWT_ACCESS_TTL ?? 15 * 60);
const REFRESH_TTL_SECONDS = Number(
  process.env.JWT_REFRESH_TTL ?? 30 * 24 * 60 * 60,
);
const UNIQUE_VIOLATION = '23505';
const MSG_REGISTRO_CERRADO =
  'El registro público está cerrado; pide a un administrador que cree tu cuenta';

export function toUserDto(row: User): UserDto {
  return {
    id: row.id,
    companyId: row.companyId,
    email: row.email,
    fullName: row.fullName,
    role: row.role as UserRole,
    contactId: row.contactId,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly secret: string;

  constructor(private readonly dbs: DbService) {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT_SECRET debe definirse (mínimo 32 caracteres)');
      }
      this.logger.warn(
        'JWT_SECRET no definido o demasiado corto: usando secreto de desarrollo',
      );
    }
    this.secret = secret ?? 'erp-dintel-dev-secret-no-usar-en-produccion';
  }

  /**
   * Registro público: solo sirve para el bootstrap. MVP monoempresa: cuelga
   * de la empresa por defecto. Si no hay usuarios activos, el primero se crea
   * como `admin`; si ya hay alguno, el registro está cerrado (403) y los
   * usuarios los crea un admin con `POST /users`. Nunca se acepta un rol.
   *
   * Concurrencia: el recuento y el alta van en una transacción cuya PRIMERA
   * sentencia es `pg_advisory_xact_lock` por empresa; el recuento que decide
   * se hace ya con el bloqueo, así que el perdedor de la carrera ve al admin
   * recién confirmado y recibe 403. El hash (lento) se calcula fuera, sin
   * retener el bloqueo, y los tokens se emiten tras el commit.
   * No cubre: `POST /users` (exige un admin ya existente).
   */
  async register(input: RegisterInput): Promise<AuthTokensDto> {
    const companyId = await this.dbs.getDefaultCompanyId();

    // Rechazo rápido (camino normal con el registro cerrado): sin hash ni bloqueo.
    if ((await this.contarUsuarios(this.dbs.db, companyId)) > 0) {
      throw new ForbiddenException({
        code: 'REGISTRATION_CLOSED',
        message: MSG_REGISTRO_CERRADO,
      });
    }
    const passwordHash = await hashPassword(input.password);
    const role: UserRole = 'admin';

    let user: User;
    try {
      user = await this.dbs.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${'bootstrap-registro:' + companyId}))`,
        );
        if ((await this.contarUsuarios(tx, companyId)) > 0) {
          throw new ForbiddenException({
            code: 'REGISTRATION_CLOSED',
            message: MSG_REGISTRO_CERRADO,
          });
        }
        const [row] = await tx
          .insert(users)
          .values({
            companyId,
            email: input.email,
            passwordHash,
            fullName: input.fullName,
            role,
          })
          .returning();
        return row;
      });
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new ConflictException({
          code: 'USER_EMAIL_DUPLICATED',
          message: 'Ya existe un usuario con ese email',
        });
      }
      throw err;
    }
    return this.issueTokens(user);
  }

  private async contarUsuarios(
    executor: DbOrTx,
    companyId: string,
  ): Promise<number> {
    const [{ count }] = await executor
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.companyId, companyId), isNull(users.deletedAt)));
    return count;
  }

  async login(input: LoginInput): Promise<AuthTokensDto> {
    const user = await this.findActiveByEmail(input.email);
    // Mismo mensaje exista o no el usuario: no revelar cuentas registradas
    const ok =
      user && (await verifyPassword(input.password, user.passwordHash));
    if (!user || !ok) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Email o contraseña incorrectos',
      });
    }
    await this.dbs.db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));
    return this.issueTokens(user);
  }

  /** Rotación: el refresh usado se revoca y se emite uno nuevo. */
  async refresh(refreshToken: string): Promise<AuthTokensDto> {
    const db = this.dbs.db;
    const [row] = await db
      .select({ token: refreshTokens, user: users })
      .from(refreshTokens)
      .innerJoin(users, eq(users.id, refreshTokens.userId))
      .where(
        and(
          eq(refreshTokens.tokenHash, sha256(refreshToken)),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date()),
          isNull(users.deletedAt),
          eq(users.isActive, true),
        ),
      )
      .limit(1);
    if (!row) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token no válido o caducado',
      });
    }
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, row.token.id));
    return this.issueTokens(row.user);
  }

  /** Revoca un refresh token concreto (cierre de sesión en ese dispositivo). */
  async logout(refreshToken: string): Promise<void> {
    await this.dbs.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.tokenHash, sha256(refreshToken)),
          isNull(refreshTokens.revokedAt),
        ),
      );
  }

  /** Valida un access token y devuelve sus claims, o lanza 401. */
  verifyAccessToken(token: string): AccessTokenPayload {
    const payload = verifyJwt<AccessTokenPayload>(token, this.secret);
    if (!payload?.sub) {
      throw new UnauthorizedException({
        code: 'INVALID_ACCESS_TOKEN',
        message: 'Token no válido o caducado',
      });
    }
    return payload;
  }

  async me(userId: string): Promise<UserDto> {
    const [user] = await this.dbs.db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    if (!user || !user.isActive) {
      throw new UnauthorizedException({
        code: 'USER_UNAVAILABLE',
        message: 'Usuario no disponible',
      });
    }
    return toUserDto(user);
  }

  /**
   * Cambio de contraseña propia: exige la actual y revoca el resto de
   * sesiones abiertas (refresh tokens), igual que un cambio de contraseña
   * normal en cualquier app — quien no tenga ya la nueva contraseña deja de
   * poder renovar su access token.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const [user] = await this.dbs.db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    if (!user || !user.isActive) {
      throw new UnauthorizedException({
        code: 'USER_UNAVAILABLE',
        message: 'Usuario no disponible',
      });
    }
    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException({
        code: 'CURRENT_PASSWORD_INCORRECT',
        message: 'La contraseña actual no es correcta',
      });
    }
    await this.dbs.db
      .update(users)
      .set({
        passwordHash: await hashPassword(newPassword),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    await this.dbs.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)),
      );
  }

  private async findActiveByEmail(email: string): Promise<User | undefined> {
    const [user] = await this.dbs.db
      .select()
      .from(users)
      .where(
        and(
          eq(sql`lower(${users.email})`, email.toLowerCase()),
          isNull(users.deletedAt),
          eq(users.isActive, true),
        ),
      )
      .limit(1);
    return user;
  }

  private async issueTokens(user: User): Promise<AuthTokensDto> {
    const iat = nowSeconds();
    const payload: AccessTokenPayload = {
      sub: user.id,
      companyId: user.companyId,
      role: user.role as UserRole,
      email: user.email,
      iat,
      exp: iat + ACCESS_TTL_SECONDS,
    };
    const accessToken = signJwt({ ...payload }, this.secret);

    const refreshToken = randomBytes(48).toString('base64url');
    await this.dbs.db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
    });

    return {
      accessToken,
      expiresIn: ACCESS_TTL_SECONDS,
      refreshToken,
      user: toUserDto(user),
    };
  }
}
