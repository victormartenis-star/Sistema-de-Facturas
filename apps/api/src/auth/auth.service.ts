import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { refreshTokens, User, users } from '@erp/db';
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

export function toUserDto(row: User): UserDto {
  return {
    id: row.id,
    companyId: row.companyId,
    email: row.email,
    fullName: row.fullName,
    role: row.role as UserRole,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
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
   * Alta de usuario. MVP monoempresa: cuelga de la empresa por defecto.
   * El primer usuario de la empresa es `admin` sea cual sea el rol pedido.
   */
  async register(input: RegisterInput): Promise<AuthTokensDto> {
    const db = this.dbs.db;
    const companyId = await this.dbs.getDefaultCompanyId();

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.companyId, companyId), isNull(users.deletedAt)));
    const role: UserRole = count === 0 ? 'admin' : (input.role ?? 'administracion');

    try {
      const [user] = await db
        .insert(users)
        .values({
          companyId,
          email: input.email,
          passwordHash: await hashPassword(input.password),
          fullName: input.fullName,
          role,
        })
        .returning();
      return this.issueTokens(user);
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new ConflictException('Ya existe un usuario con ese email');
      }
      throw err;
    }
  }

  async login(input: LoginInput): Promise<AuthTokensDto> {
    const user = await this.findActiveByEmail(input.email);
    // Mismo mensaje exista o no el usuario: no revelar cuentas registradas
    const ok =
      user && (await verifyPassword(input.password, user.passwordHash));
    if (!user || !ok) {
      throw new UnauthorizedException('Email o contraseña incorrectos');
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
      throw new UnauthorizedException('Refresh token no válido o caducado');
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
      throw new UnauthorizedException('Token no válido o caducado');
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
      throw new UnauthorizedException('Usuario no disponible');
    }
    return toUserDto(user);
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
