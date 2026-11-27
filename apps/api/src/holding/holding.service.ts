import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql, SQL } from 'drizzle-orm';
import {
  companies,
  consolidationAdjustments,
  consolidationClosings,
  corporateGroupMembers,
  corporateGroups,
  journalEntryLines,
  ledgerAccounts,
  userCompanyGrants,
  users,
  type Company,
  type ConsolidationAdjustment,
  type CorporateGroup,
  type CorporateGroupMember,
  type Tx,
} from '@erp/db';
import {
  CUENTA_INVERSION_GRUPO,
  ajusteConsolidacionCreateSchema,
  anularAjusteSchema,
  consolidarEstados,
  convertirImporte,
  convertirSaldosMoneda,
  eliminacionInversionPatrimonio,
  eliminacionesIntragrupo,
  patrimonioNetoDeSaldos,
  planContableBase,
  seleccionarTipoCambio,
  sociedadCreateSchema,
  sociedadUpdateSchema,
  type ConversionSociedadDto,
  type InversionPatrimonioDto,
  type SociedadCreateInput,
  type SociedadDto,
  type SociedadUpdateInput,
  type TipoCambioConsolidacion,
  type TipoCambioRegistro,
  type TiposCambioSociedad,
  grupoCreateSchema,
  grupoUpdateSchema,
  miembroCreateSchema,
  miembroUpdateSchema,
  periodoConsolidacionSchema,
  permisoConsolidacionSchema,
  posicionTesoreriaGrupo,
  toCents,
  fromCents,
  sumCents,
  type AjusteConsolidacion,
  type AjusteConsolidacionCreateInput,
  type AjusteConsolidacionDto,
  type AnularAjusteInput,
  type CierreConsolidacionDto,
  type EstadosConsolidadosDto,
  type GrupoCreateInput,
  type GrupoDto,
  type GrupoUpdateInput,
  type MetodoConsolidacion,
  type MiembroCreateInput,
  type MiembroGrupoDto,
  type MiembroUpdateInput,
  type OperacionesIntragrupo,
  type PeriodoConsolidacion,
  type PermisoConsolidacionDto,
  type PermisoConsolidacionInput,
  type SaldoCuenta,
  type SociedadAccesibleDto,
  type TesoreriaGrupoDto,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { hashPassword } from '../auth/password';
import { cambiarEstado } from '../common/cambiar-estado';
import { verificarVersion } from '../common/version';
import { DbService } from '../db/db.service';
import { TiposCambioService } from './tipos-cambio.service';

/** La matriz forma parte de su grupo desde siempre. */
const ALTA_MATRIZ = '1900-01-01';
/** Facturas que cuentan como operación registrada. */
const ESTADOS_FACTURA = sql`('aprobada', 'pagada', 'rectificada')`;
/** NIF normalizado (solo letras y dígitos, en mayúsculas). */
const nifNorm = (col: SQL) =>
  sql`upper(regexp_replace(coalesce(${col}, ''), '[^A-Za-z0-9]', '', 'g'))`;
function normalizarNif(nif: string): string {
  return nif.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}
const lista = (ids: readonly string[]) =>
  sql.join(
    ids.map((i) => sql`${i}`),
    sql`, `,
  );

const grupoNoEncontrado = () =>
  new NotFoundException({
    code: 'HOLDING_NOT_FOUND',
    message: 'Grupo no encontrado',
  });

interface MiembroCargado {
  m: CorporateGroupMember;
  nombre: string;
  nif: string;
  /** Moneda funcional de la sociedad. */
  moneda: string;
}

/** Campos de inversión–PN tal como llegan del alta o la edición. */
interface InversionInput {
  fechaAdquisicion?: string | null;
  costeInversion?: number | null;
  cuentaInversion?: string | null;
  patrimonioAdquisicion?: number | null;
}

const num2 = (v: number | null | undefined) =>
  v === null || v === undefined ? null : v.toFixed(2);
const numODto = (v: string | null) => (v === null ? null : Number(v));

const sociedadNoEncontrada = () =>
  new NotFoundException({
    code: 'GROUP_COMPANY_NOT_FOUND',
    message: 'Sociedad no encontrada o no gestionada por tu sociedad',
  });

/**
 * La puesta en equivalencia necesita el coste de la participación; la
 * cuenta o el PN de adquisición sin coste no tienen sentido.
 */
function validarInversion(metodo: MetodoConsolidacion, d: InversionInput) {
  const coste = d.costeInversion ?? null;
  if (metodo === 'puesta_equivalencia' && coste === null) {
    throw new UnprocessableEntityException({
      code: 'CONSOLIDATION_INVESTMENT_REQUIRED',
      message:
        'La puesta en equivalencia exige el coste de la inversión (costeInversion)',
    });
  }
  if (
    coste === null &&
    ((d.cuentaInversion ?? null) !== null ||
      (d.patrimonioAdquisicion ?? null) !== null)
  ) {
    throw new UnprocessableEntityException({
      code: 'CONSOLIDATION_INVESTMENT_INVALID',
      message:
        'La cuenta de inversión y el patrimonio de adquisición requieren el coste de la inversión',
    });
  }
}

/**
 * Consolidación de grupo / holding (SAP Group Reporting, Oracle FCC).
 *
 * Aislamiento: el grupo pertenece a la matriz (la empresa del usuario) y cada
 * sociedad integrada que no sea la propia exige un permiso de consolidación
 * vigente concedido por SU admin (`user_company_grants`). Se comprueba al
 * integrarla y en CADA lectura: un permiso revocado corta el acceso al
 * instante (`HOLDING_COMPANY_ACCESS_DENIED`, 403). Las lecturas filtran
 * explícitamente por `company_id` de las sociedades autorizadas.
 */
@Injectable()
export class HoldingService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly tiposCambio: TiposCambioService,
  ) {}

  private ctx() {
    return this.dbs.getContext();
  }

  /* ─────────────────────────── accesos ─────────────────────────── */

  async sociedadesAccesibles(): Promise<SociedadAccesibleDto[]> {
    const { userId, companyId } = this.ctx();
    const filas = await this.dbs.db
      .select({
        id: companies.id,
        nombre: companies.name,
        nif: companies.taxId,
        moneda: companies.functionalCurrency,
      })
      .from(companies)
      .where(
        sql`${companies.id} = ${companyId} OR ${companies.id} IN (
          select g.company_id from user_company_grants g
          where g.user_id = ${userId} and g.revoked_at is null)`,
      )
      .orderBy(asc(companies.name));
    return filas.map((c) => ({
      companyId: c.id,
      nombre: c.nombre,
      nif: c.nif,
      propia: c.id === companyId,
      monedaFuncional: c.moneda,
    }));
  }

  /** 403 si alguna sociedad no es la propia ni está autorizada. */
  private async exigirAcceso(ids: readonly string[]): Promise<void> {
    const accesibles = new Set(
      (await this.sociedadesAccesibles()).map((s) => s.companyId),
    );
    const faltan = [...new Set(ids)].filter((id) => !accesibles.has(id));
    if (faltan.length > 0) {
      throw new ForbiddenException({
        code: 'HOLDING_COMPANY_ACCESS_DENIED',
        message:
          'No tienes permiso de consolidación sobre todas las sociedades del grupo: pide al administrador de cada una que te lo conceda',
        sociedades: faltan,
      });
    }
  }

  async permisos(): Promise<PermisoConsolidacionDto[]> {
    const { companyId } = this.ctx();
    const filas = await this.dbs.db
      .select({
        g: userCompanyGrants,
        email: users.email,
        nombre: users.fullName,
        sociedad: companies.name,
      })
      .from(userCompanyGrants)
      .innerJoin(users, eq(users.id, userCompanyGrants.userId))
      .innerJoin(companies, eq(companies.id, users.companyId))
      .where(eq(userCompanyGrants.companyId, companyId))
      .orderBy(desc(userCompanyGrants.grantedAt));
    return filas.map((f) => ({
      id: f.g.id,
      userId: f.g.userId,
      email: f.email,
      nombreUsuario: f.nombre,
      sociedadUsuario: f.sociedad,
      concedidoEn: f.g.grantedAt.toISOString(),
      revocadoEn: f.g.revokedAt?.toISOString() ?? null,
    }));
  }

  /** El admin de la sociedad concede a un usuario de OTRA sociedad acceso a la suya. */
  async conceder(input: PermisoConsolidacionInput) {
    const { email } = permisoConsolidacionSchema.parse(input);
    const { companyId, userId } = this.ctx();
    await this.dbs.db.transaction(async (tx) => {
      const [u] = await tx
        .select({ id: users.id, companyId: users.companyId })
        .from(users)
        .where(
          and(
            sql`lower(${users.email}) = lower(${email})`,
            isNull(users.deletedAt),
          ),
        )
        .limit(1);
      if (!u) {
        throw new UnprocessableEntityException({
          code: 'USER_NOT_FOUND',
          message: 'No existe ningún usuario con ese email',
        });
      }
      if (u.companyId === companyId) {
        throw new UnprocessableEntityException({
          code: 'GRANT_SAME_COMPANY',
          message: 'Los usuarios de la propia sociedad ya acceden a sus datos',
        });
      }
      const [g] = await tx
        .insert(userCompanyGrants)
        .values({ companyId, userId: u.id, grantedBy: userId })
        .onConflictDoNothing()
        .returning();
      if (!g) {
        throw new ConflictException({
          code: 'GRANT_DUPLICATE',
          message: 'Ese usuario ya tiene permiso de consolidación vigente',
        });
      }
      await this.audit.registrar(tx, {
        entityType: 'user_company_grant',
        entityId: g.id,
        action: 'create',
        newData: g,
      });
    });
    return this.permisos();
  }

  async revocar(id: string) {
    const { companyId, userId } = this.ctx();
    await this.dbs.db.transaction(async (tx) => {
      const [g] = await tx
        .update(userCompanyGrants)
        .set({ revokedAt: new Date(), revokedBy: userId })
        .where(
          and(
            eq(userCompanyGrants.id, id),
            eq(userCompanyGrants.companyId, companyId),
            isNull(userCompanyGrants.revokedAt),
          ),
        )
        .returning();
      if (!g) {
        throw new NotFoundException({
          code: 'GRANT_NOT_FOUND',
          message: 'Permiso no encontrado o ya revocado',
        });
      }
      await this.audit.registrar(tx, {
        entityType: 'user_company_grant',
        entityId: id,
        action: 'update',
        newData: { revocado: true, revokedAt: g.revokedAt },
      });
    });
    return this.permisos();
  }

  /* ─────────────────── alta de sociedades del grupo ─────────────────── */

  private sociedadDto(c: Company): SociedadDto {
    return {
      id: c.id,
      nombre: c.name,
      nif: c.taxId,
      monedaFuncional: c.functionalCurrency,
      altaPorCompanyId: c.createdByCompanyId,
      creadaEn: c.createdAt.toISOString(),
      version: c.version,
    };
  }

  /** La propia sociedad y las que ella ha dado de alta. */
  async sociedadesGestionadas(): Promise<SociedadDto[]> {
    const { companyId } = this.ctx();
    const filas = await this.dbs.db
      .select()
      .from(companies)
      .where(
        sql`${companies.id} = ${companyId} OR ${companies.createdByCompanyId} = ${companyId}`,
      )
      .orderBy(asc(companies.name));
    return filas.map((c) => this.sociedadDto(c));
  }

  /**
   * Alta controlada de una sociedad (admin de la matriz). En una sola
   * transacción: la sociedad con su moneda funcional, su PGC base, el
   * permiso de consolidación para quien la crea, su primer administrador
   * (opcional) y su integración en un grupo de la matriz (opcional). Se
   * audita en la cadena de la creadora y abre la cadena de la nueva.
   */
  async crearSociedad(input: SociedadCreateInput): Promise<SociedadDto> {
    const d = sociedadCreateSchema.parse(input);
    const { companyId, userId } = this.ctx();
    const g = d.grupo ? await this.cargarGrupo(d.grupo.grupoId) : null;
    if (d.grupo) validarInversion(d.grupo.metodo, d.grupo);
    const nif = normalizarNif(d.nif);
    const passwordHash = d.administrador
      ? await hashPassword(d.administrador.password)
      : null;
    const r = await this.dbs.db.transaction(async (tx) => {
      // Serializa las altas con el mismo NIF (sin índice único heredado).
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`company-nif:${nif}`}))`,
      );
      const [dup] = await tx
        .select({ id: companies.id })
        .from(companies)
        .where(sql`${nifNorm(sql`${companies.taxId}`)} = ${nif}`)
        .limit(1);
      if (dup) {
        throw new ConflictException({
          code: 'GROUP_COMPANY_NIF_DUPLICATE',
          message: `Ya existe una sociedad con el NIF ${d.nif}`,
        });
      }
      if (d.administrador) {
        const [u] = await tx
          .select({ id: users.id })
          .from(users)
          .where(sql`lower(${users.email}) = lower(${d.administrador.email})`)
          .limit(1);
        if (u) {
          throw new ConflictException({
            code: 'USER_EMAIL_DUPLICATED',
            message: 'Ya existe un usuario con ese email',
          });
        }
      }
      const [c] = await tx
        .insert(companies)
        .values({
          name: d.nombre,
          taxId: d.nif,
          functionalCurrency: d.monedaFuncional,
          createdByCompanyId: companyId,
        })
        .returning();
      const cuentas = d.inicializarPlan
        ? await tx
            .insert(ledgerAccounts)
            .values(
              planContableBase().map((cu) => ({
                companyId: c.id,
                code: cu.codigo,
                name: cu.nombre,
                type: cu.tipo,
                postable: cu.imputable,
              })),
            )
            .onConflictDoNothing()
            .returning({ id: ledgerAccounts.id })
        : [];
      // Quien la crea puede consolidarla desde el primer momento.
      const [grant] = await tx
        .insert(userCompanyGrants)
        .values({ companyId: c.id, userId, grantedBy: userId })
        .returning();
      let admin: { userId: string; email: string } | null = null;
      if (d.administrador && passwordHash) {
        const [u] = await tx
          .insert(users)
          .values({
            companyId: c.id,
            email: d.administrador.email,
            passwordHash,
            fullName: d.administrador.fullName,
            role: 'admin',
          })
          .returning({ id: users.id, email: users.email });
        admin = { userId: u.id, email: u.email };
      }
      const miembro =
        g && d.grupo
          ? await this.insertarMiembro(tx, g, { ...d.grupo, companyId: c.id })
          : null;
      const alta = {
        id: c.id,
        nombre: c.name,
        nif: c.taxId,
        monedaFuncional: c.functionalCurrency,
        altaPor: companyId,
        planContable: cuentas.length,
      };
      await this.audit.registrar(tx, [
        {
          entityType: 'company',
          entityId: c.id,
          action: 'create',
          newData: alta,
        },
        {
          entityType: 'user_company_grant',
          entityId: grant.id,
          action: 'create',
          newData: grant,
        },
      ]);
      // Génesis de la cadena de la nueva sociedad.
      await this.audit.registrar(
        tx,
        [
          {
            entityType: 'company',
            entityId: c.id,
            action: 'create',
            newData: alta,
          },
          ...(admin
            ? [
                {
                  entityType: 'user',
                  entityId: admin.userId,
                  action: 'create' as const,
                  newData: { email: admin.email, role: 'admin' },
                },
              ]
            : []),
        ],
        { companyId: c.id },
      );
      return {
        ...this.sociedadDto(c),
        administrador: admin,
        miembroId: miembro?.id ?? null,
      };
    });
    return r;
  }

  /**
   * Edita nombre o moneda funcional de la propia sociedad o de una dada de
   * alta por ella. La moneda no cambia si ya hay asientos (cambiaría el
   * significado de todo su mayor).
   */
  async actualizarSociedad(
    id: string,
    input: SociedadUpdateInput,
    version?: number,
  ): Promise<SociedadDto> {
    const d = sociedadUpdateSchema.parse(input);
    const { companyId } = this.ctx();
    return this.dbs.db.transaction(async (tx) => {
      const [actual] = await tx
        .select()
        .from(companies)
        .where(
          and(
            eq(companies.id, id),
            sql`(${companies.id} = ${companyId} OR ${companies.createdByCompanyId} = ${companyId})`,
          ),
        )
        .for('update');
      if (!actual) throw sociedadNoEncontrada();
      verificarVersion(actual.version, version);
      if (
        d.monedaFuncional !== undefined &&
        d.monedaFuncional !== actual.functionalCurrency
      ) {
        const [linea] = await tx
          .select({ id: journalEntryLines.id })
          .from(journalEntryLines)
          .where(eq(journalEntryLines.companyId, id))
          .limit(1);
        if (linea) {
          throw new UnprocessableEntityException({
            code: 'GROUP_COMPANY_CURRENCY_LOCKED',
            message:
              'La sociedad ya tiene asientos: su moneda funcional no se puede cambiar',
          });
        }
      }
      const [nuevo] = await tx
        .update(companies)
        .set({
          ...(d.nombre !== undefined && { name: d.nombre }),
          ...(d.monedaFuncional !== undefined && {
            functionalCurrency: d.monedaFuncional,
          }),
          version: actual.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(companies.id, id))
        .returning();
      const resumen = (c: Company) => ({
        nombre: c.name,
        monedaFuncional: c.functionalCurrency,
        version: c.version,
      });
      await this.audit.registrar(tx, {
        entityType: 'company',
        entityId: id,
        action: 'update',
        oldData: resumen(actual),
        newData: resumen(nuevo),
      });
      return this.sociedadDto(nuevo);
    });
  }

  /* ──────────────────────────── grupos ──────────────────────────── */

  private async cargarGrupo(id: string): Promise<CorporateGroup> {
    const [g] = await this.dbs.db
      .select()
      .from(corporateGroups)
      .where(
        and(
          eq(corporateGroups.id, id),
          eq(corporateGroups.companyId, this.ctx().companyId),
        ),
      );
    if (!g) throw grupoNoEncontrado();
    return g;
  }

  private async miembros(
    groupIds: string | string[],
  ): Promise<MiembroCargado[]> {
    const ids = Array.isArray(groupIds) ? groupIds : [groupIds];
    if (ids.length === 0) return [];
    const filas = await this.dbs.db
      .select({
        m: corporateGroupMembers,
        nombre: companies.name,
        nif: companies.taxId,
        moneda: companies.functionalCurrency,
      })
      .from(corporateGroupMembers)
      .innerJoin(
        companies,
        eq(companies.id, corporateGroupMembers.memberCompanyId),
      )
      .where(inArray(corporateGroupMembers.groupId, ids))
      .orderBy(asc(corporateGroupMembers.startDate), asc(companies.name));
    return filas;
  }

  /** DTO de varios grupos con dos consultas en total (miembros y accesos). */
  private async gruposDto(gs: CorporateGroup[]): Promise<GrupoDto[]> {
    if (gs.length === 0) return [];
    const [todos, acc] = await Promise.all([
      this.miembros(gs.map((g) => g.id)),
      this.sociedadesAccesibles(),
    ]);
    const accesibles = new Set(acc.map((s) => s.companyId));
    return gs.map((g) =>
      this.componerGrupo(
        g,
        todos.filter(({ m }) => m.groupId === g.id),
        accesibles,
      ),
    );
  }

  private async grupoDto(g: CorporateGroup): Promise<GrupoDto> {
    return (await this.gruposDto([g]))[0];
  }

  private componerGrupo(
    g: CorporateGroup,
    ms: MiembroCargado[],
    accesibles: Set<string>,
  ): GrupoDto {
    return {
      id: g.id,
      nombre: g.name,
      monedaBase: g.baseCurrency,
      matrizId: g.companyId,
      version: g.version,
      miembros: ms.map(({ m, nombre, nif, moneda }): MiembroGrupoDto => ({
        id: m.id,
        companyId: m.memberCompanyId,
        nombre,
        nif,
        participacionPct: Number(m.ownershipPct),
        metodo: m.method as MetodoConsolidacion,
        fechaAlta: m.startDate,
        fechaBaja: m.endDate,
        accesible: accesibles.has(m.memberCompanyId),
        monedaFuncional: moneda,
        fechaAdquisicion: m.acquisitionDate,
        costeInversion: numODto(m.investmentCost),
        cuentaInversion: m.investmentAccount,
        patrimonioAdquisicion: numODto(m.equityAtAcquisition),
        version: m.version,
      })),
    };
  }

  async grupos(): Promise<GrupoDto[]> {
    const gs = await this.dbs.db
      .select()
      .from(corporateGroups)
      .where(eq(corporateGroups.companyId, this.ctx().companyId))
      .orderBy(asc(corporateGroups.name));
    return this.gruposDto(gs);
  }

  async grupo(id: string): Promise<GrupoDto> {
    return this.grupoDto(await this.cargarGrupo(id));
  }

  async crearGrupo(input: GrupoCreateInput): Promise<GrupoDto> {
    const d = grupoCreateSchema.parse(input);
    const { companyId, userId } = this.ctx();
    const id = await this.dbs.db.transaction(async (tx) => {
      const [g] = await tx
        .insert(corporateGroups)
        .values({
          companyId,
          name: d.nombre,
          baseCurrency: d.monedaBase,
          createdBy: userId,
        })
        .onConflictDoNothing()
        .returning();
      if (!g) {
        throw new ConflictException({
          code: 'HOLDING_NAME_DUPLICATE',
          message: `Ya existe el grupo «${d.nombre}»`,
        });
      }
      // La matriz se integra al 100 % por integración global.
      const [m] = await tx
        .insert(corporateGroupMembers)
        .values({
          groupId: g.id,
          memberCompanyId: companyId,
          ownershipPct: '100.00',
          method: 'global',
          startDate: ALTA_MATRIZ,
        })
        .returning();
      await this.audit.registrar(tx, [
        {
          entityType: 'corporate_group',
          entityId: g.id,
          action: 'create',
          newData: g,
        },
        {
          entityType: 'corporate_group_member',
          entityId: m.id,
          action: 'create',
          newData: m,
        },
      ]);
      return g.id;
    });
    return this.grupo(id);
  }

  async actualizarGrupo(id: string, input: GrupoUpdateInput, version?: number) {
    const d = grupoUpdateSchema.parse(input);
    const g = await this.cargarGrupo(id);
    await this.dbs.db.transaction(async (tx) => {
      const [actual] = await tx
        .select()
        .from(corporateGroups)
        .where(eq(corporateGroups.id, g.id))
        .for('update');
      verificarVersion(actual.version, version);
      const [nuevo] = await tx
        .update(corporateGroups)
        .set({
          name: d.nombre,
          version: actual.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(corporateGroups.id, g.id))
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'corporate_group',
        entityId: g.id,
        action: 'update',
        oldData: actual,
        newData: nuevo,
      });
    });
    return this.grupo(id);
  }

  /** Inserta el miembro (con sus parámetros de inversión–PN) y lo audita. */
  private async insertarMiembro(
    tx: Tx,
    g: CorporateGroup,
    d: {
      companyId: string;
      participacionPct: number;
      metodo: MetodoConsolidacion;
      fechaAlta: string;
    } & InversionInput,
  ): Promise<CorporateGroupMember> {
    validarInversion(d.metodo, d);
    const coste = d.costeInversion ?? null;
    const [m] = await tx
      .insert(corporateGroupMembers)
      .values({
        groupId: g.id,
        memberCompanyId: d.companyId,
        ownershipPct: d.participacionPct.toFixed(2),
        method: d.metodo,
        startDate: d.fechaAlta,
        acquisitionDate: d.fechaAdquisicion ?? null,
        investmentCost: num2(coste),
        investmentAccount:
          coste === null ? null : (d.cuentaInversion ?? CUENTA_INVERSION_GRUPO),
        equityAtAcquisition: num2(d.patrimonioAdquisicion),
      })
      .onConflictDoNothing()
      .returning();
    if (!m) {
      throw new ConflictException({
        code: 'HOLDING_MEMBER_DUPLICATE',
        message: 'La sociedad ya está integrada (activa) en el grupo',
      });
    }
    await this.audit.registrar(tx, {
      entityType: 'corporate_group_member',
      entityId: m.id,
      action: 'create',
      newData: m,
    });
    return m;
  }

  async integrarSociedad(groupId: string, input: MiembroCreateInput) {
    const d = miembroCreateSchema.parse(input);
    const g = await this.cargarGrupo(groupId);
    await this.exigirAcceso([d.companyId]);
    await this.dbs.db.transaction((tx) => this.insertarMiembro(tx, g, d));
    return this.grupo(groupId);
  }

  async actualizarMiembro(
    groupId: string,
    memberId: string,
    input: MiembroUpdateInput,
    version?: number,
  ) {
    const d = miembroUpdateSchema.parse(input);
    const g = await this.cargarGrupo(groupId);
    await this.dbs.db.transaction(async (tx) => {
      const [m] = await tx
        .select()
        .from(corporateGroupMembers)
        .where(
          and(
            eq(corporateGroupMembers.id, memberId),
            eq(corporateGroupMembers.groupId, g.id),
          ),
        )
        .for('update');
      if (!m) {
        throw new NotFoundException({
          code: 'HOLDING_MEMBER_NOT_FOUND',
          message: 'Sociedad miembro no encontrada',
        });
      }
      verificarVersion(m.version, version);
      if (m.memberCompanyId === g.companyId) {
        throw new UnprocessableEntityException({
          code: 'HOLDING_PARENT_IMMUTABLE',
          message:
            'La matriz se integra siempre al 100 % por integración global',
        });
      }
      if (d.fechaBaja && d.fechaBaja < m.startDate) {
        throw new UnprocessableEntityException({
          code: 'HOLDING_MEMBER_DATES_INVALID',
          message: 'La baja no puede ser anterior al alta',
        });
      }
      // Estado resultante de la inversión: quitar el coste la desactiva entera.
      const coste =
        d.costeInversion !== undefined
          ? (d.costeInversion ?? null)
          : numODto(m.investmentCost);
      const inversion: InversionInput =
        coste === null
          ? { costeInversion: null }
          : {
              costeInversion: coste,
              cuentaInversion:
                d.cuentaInversion !== undefined
                  ? (d.cuentaInversion ?? CUENTA_INVERSION_GRUPO)
                  : (m.investmentAccount ?? CUENTA_INVERSION_GRUPO),
              patrimonioAdquisicion:
                d.patrimonioAdquisicion !== undefined
                  ? (d.patrimonioAdquisicion ?? null)
                  : numODto(m.equityAtAcquisition),
            };
      validarInversion(
        d.metodo ?? (m.method as MetodoConsolidacion),
        inversion,
      );
      const [nuevo] = await tx
        .update(corporateGroupMembers)
        .set({
          ...(d.participacionPct !== undefined && {
            ownershipPct: d.participacionPct.toFixed(2),
          }),
          ...(d.metodo !== undefined && { method: d.metodo }),
          ...(d.fechaBaja !== undefined && { endDate: d.fechaBaja ?? null }),
          ...(d.fechaAdquisicion !== undefined && {
            acquisitionDate: d.fechaAdquisicion ?? null,
          }),
          investmentCost: num2(inversion.costeInversion),
          investmentAccount: inversion.cuentaInversion ?? null,
          equityAtAcquisition: num2(inversion.patrimonioAdquisicion),
          version: m.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(corporateGroupMembers.id, memberId))
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'corporate_group_member',
        entityId: memberId,
        action: 'update',
        oldData: m,
        newData: nuevo,
      });
    });
    return this.grupo(groupId);
  }

  /* ───────────────────────── consolidación ───────────────────────── */

  /** Miembros vigentes en el periodo, con acceso exigido a todos. */
  private async perimetro(
    g: CorporateGroup,
    p: PeriodoConsolidacion,
  ): Promise<MiembroCargado[]> {
    const ms = (await this.miembros(g.id)).filter(
      ({ m }) => m.startDate <= p.hasta && (!m.endDate || m.endDate >= p.desde),
    );
    await this.exigirAcceso(ms.map(({ m }) => m.memberCompanyId));
    return ms;
  }

  /** Saldos deudores por sociedad y cuenta del mayor; PyG previa a `desde` a remanente. */
  private async saldos(
    ids: string[],
    p: PeriodoConsolidacion,
  ): Promise<Map<string, SaldoCuenta[]>> {
    const r = await this.dbs.db.execute(sql`
      select jl.company_id as company, la.code as codigo,
        coalesce(sum(jl.debit - jl.credit), 0)::text as hasta,
        coalesce(sum(jl.debit - jl.credit) filter (where je.entry_date < ${p.desde}), 0)::text as antes
      from journal_entry_lines jl
      join ledger_accounts la on la.id = jl.account_id
      join journal_entries je on je.id = jl.entry_id
      where jl.company_id in (${lista(ids)}) and je.entry_date <= ${p.hasta}
      group by jl.company_id, la.code`);
    const out = new Map<string, SaldoCuenta[]>(ids.map((id) => [id, []]));
    const remanente = new Map<string, bigint>();
    for (const row of r.rows as {
      company: string;
      codigo: string;
      hasta: string;
      antes: string;
    }[]) {
      const pyg = row.codigo.startsWith('6') || row.codigo.startsWith('7');
      const hasta = toCents(row.hasta);
      const antes = toCents(row.antes);
      const saldo = pyg ? hasta - antes : hasta;
      if (pyg && antes !== 0n) {
        remanente.set(row.company, (remanente.get(row.company) ?? 0n) + antes);
      }
      if (saldo !== 0n) {
        out
          .get(row.company)!
          .push({ codigo: row.codigo, saldoDeudor: fromCents(saldo) });
      }
    }
    for (const [company, v] of remanente) {
      out.get(company)!.push({ codigo: '1200', saldoDeudor: fromCents(v) });
    }
    return out;
  }

  /**
   * Operaciones y saldos por sociedad y contraparte (por NIF del contacto):
   * base facturada en el periodo y pendiente a `hasta`, separando lo
   * intragrupo (contraparte = otra sociedad del perímetro) de lo externo.
   */
  private async operaciones(ms: MiembroCargado[], p: PeriodoConsolidacion) {
    const ids = ms.map(({ m }) => m.memberCompanyId);
    const nifDe = new Map(
      ms.map(({ m, nif }) => [normalizarNif(nif), m.memberCompanyId]),
    );
    const nifs = [...nifDe.keys()].filter(Boolean);
    const facturado = await this.dbs.db.execute(sql`
      select i.company_id as company, i.kind as kind, ${nifNorm(sql`c.tax_id`)} as nif,
        coalesce(sum(i.base_amount), 0)::text as base
      from invoices i join contacts c on c.id = i.contact_id
      where i.company_id in (${lista(ids)}) and i.deleted_at is null
        and i.status in ${ESTADOS_FACTURA}
        and i.issue_date between ${p.desde} and ${p.hasta}
        and ${nifNorm(sql`c.tax_id`)} in (${nifs.length ? lista(nifs) : sql`''`})
      group by 1, 2, 3`);
    const pendiente = await this.dbs.db.execute(sql`
      select i.company_id as company, pm.direction as direction, ${nifNorm(sql`c.tax_id`)} as nif,
        coalesce(sum(pm.amount - coalesce((select sum(ps.amount) from payment_settlements ps
          where ps.milestone_id = pm.id and ps.status = 'vigente' and ps.settled_on <= ${p.hasta}), 0)), 0)::text as pendiente
      from payment_milestones pm
      join invoices i on i.id = pm.invoice_id
      join contacts c on c.id = i.contact_id
      where i.company_id in (${lista(ids)}) and i.deleted_at is null
        and i.status in ${ESTADOS_FACTURA} and i.issue_date <= ${p.hasta}
      group by 1, 2, 3`);
    // Contraparte intragrupo: otra sociedad del perímetro (no la propia).
    const contraparte = (company: string, nif: string) => {
      const otra = nifDe.get(nif);
      return otra && otra !== company ? otra : null;
    };
    const ventas = new Map<string, bigint>();
    const compras = new Map<string, bigint>();
    for (const r of facturado.rows as {
      company: string;
      kind: string;
      nif: string;
      base: string;
    }[]) {
      const otra = contraparte(r.company, r.nif);
      if (!otra) continue;
      const k = `${r.company}|${otra}`;
      const mapa = r.kind === 'venta' ? ventas : compras;
      mapa.set(k, (mapa.get(k) ?? 0n) + toCents(r.base));
    }
    const cobrar = new Map<string, bigint>();
    const pagar = new Map<string, bigint>();
    const externo = new Map<
      string,
      { cobros: bigint; pagos: bigint; cobrosIg: bigint; pagosIg: bigint }
    >(
      ids.map((id) => [
        id,
        { cobros: 0n, pagos: 0n, cobrosIg: 0n, pagosIg: 0n },
      ]),
    );
    for (const r of pendiente.rows as {
      company: string;
      direction: string;
      nif: string;
      pendiente: string;
    }[]) {
      const v = toCents(r.pendiente);
      const otra = contraparte(r.company, r.nif);
      const e = externo.get(r.company)!;
      if (otra) {
        const k = `${r.company}|${otra}`;
        const mapa = r.direction === 'cobro' ? cobrar : pagar;
        mapa.set(k, (mapa.get(k) ?? 0n) + v);
        if (r.direction === 'cobro') e.cobrosIg += v;
        else e.pagosIg += v;
      } else if (r.direction === 'cobro') e.cobros += v;
      else e.pagos += v;
    }
    const pares: OperacionesIntragrupo[] = [];
    for (const v of ids) {
      for (const c of ids) {
        if (v === c) continue;
        const o = {
          vendedor: v,
          comprador: c,
          ventas: fromCents(ventas.get(`${v}|${c}`) ?? 0n),
          compras: fromCents(compras.get(`${c}|${v}`) ?? 0n),
          cobrar: fromCents(cobrar.get(`${v}|${c}`) ?? 0n),
          pagar: fromCents(pagar.get(`${c}|${v}`) ?? 0n),
        };
        if (o.ventas || o.compras || o.cobrar || o.pagar) pares.push(o);
      }
    }
    return { pares, externo };
  }

  private ajusteDto(a: ConsolidationAdjustment): AjusteConsolidacionDto {
    return {
      id: a.id,
      fecha: a.adjustmentDate,
      concepto: a.description,
      cuentaDebe: a.debitAccount,
      cuentaHaber: a.creditAccount,
      importe: Number(a.amount),
      companyId: a.memberCompanyId,
      estado: a.status as 'vigente' | 'anulado',
      motivoAnulacion: a.cancelReason,
      version: a.version,
    };
  }

  /**
   * Tipos de cambio de cada sociedad cuya moneda funcional no es la de
   * presentación del grupo. Si falta alguno: 422 `FX_RATE_MISSING` con la
   * lista completa (el consolidado nunca sale con un tipo inventado).
   */
  private async tiposPerimetro(
    g: CorporateGroup,
    ms: MiembroCargado[],
    p: PeriodoConsolidacion,
    necesarios: readonly TipoCambioConsolidacion[],
  ): Promise<Map<string, TiposCambioSociedad>> {
    const out = new Map<string, TiposCambioSociedad>();
    const extranjeras = ms.filter(({ moneda }) => moneda !== g.baseCurrency);
    if (extranjeras.length === 0) return out;
    const registros: TipoCambioRegistro[] = await this.tiposCambio.registros(g);
    const faltan: {
      companyId: string;
      moneda: string;
      tipo: TipoCambioConsolidacion;
      fecha: string;
    }[] = [];
    for (const { m, moneda } of extranjeras) {
      const busca = (
        tipo: TipoCambioConsolidacion,
        desde: string,
        hasta: string,
      ) => seleccionarTipoCambio(registros, { moneda, tipo, desde, hasta });
      // Histórico: el de la toma de control; si no lo hay, el último del periodo.
      const ref = m.acquisitionDate ?? m.startDate;
      const encontrados: Record<
        TipoCambioConsolidacion,
        TipoCambioRegistro | null
      > = {
        cierre: busca('cierre', p.desde, p.hasta),
        medio: busca('medio', p.desde, p.hasta),
        historico:
          busca('historico', ref, ref) ?? busca('historico', p.desde, p.hasta),
      };
      for (const tipo of necesarios) {
        if (!encontrados[tipo]) {
          faltan.push({
            companyId: m.memberCompanyId,
            moneda,
            tipo,
            fecha:
              tipo === 'medio'
                ? `${p.desde}/${p.hasta}`
                : tipo === 'historico'
                  ? ref
                  : p.hasta,
          });
        }
      }
      out.set(m.memberCompanyId, {
        cierre: encontrados.cierre?.tasa ?? '1',
        medio: encontrados.medio?.tasa ?? '1',
        historico: encontrados.historico?.tasa ?? '1',
      });
    }
    if (faltan.length > 0) {
      throw new UnprocessableEntityException({
        code: 'FX_RATE_MISSING',
        message: `Faltan tipos de cambio de consolidación: ${faltan
          .map((f) => `${f.moneda} ${f.tipo} (${f.fecha})`)
          .join(', ')}`,
        faltan,
      });
    }
    return out;
  }

  /** Saldos deudores acumulados a una fecha (todo el histórico del mayor). */
  private async saldosAFecha(
    ids: string[],
    fecha: string,
  ): Promise<Map<string, SaldoCuenta[]>> {
    const out = new Map<string, SaldoCuenta[]>(ids.map((id) => [id, []]));
    if (ids.length === 0) return out;
    const r = await this.dbs.db.execute(sql`
      select jl.company_id as company, la.code as codigo,
        coalesce(sum(jl.debit - jl.credit), 0)::text as saldo
      from journal_entry_lines jl
      join ledger_accounts la on la.id = jl.account_id
      join journal_entries je on je.id = jl.entry_id
      where jl.company_id in (${lista(ids)}) and je.entry_date <= ${fecha}
      group by jl.company_id, la.code`);
    for (const row of r.rows as {
      company: string;
      codigo: string;
      saldo: string;
    }[]) {
      out
        .get(row.company)
        ?.push({ codigo: row.codigo, saldoDeudor: row.saldo });
    }
    return out;
  }

  /**
   * Eliminación inversión–patrimonio neto de las sociedades con coste de
   * inversión informado y toma de control no posterior al periodo. El PN a
   * la toma de control es el informado o, si no, el de su mayor a esa fecha;
   * en moneda extranjera se convierte al tipo histórico.
   */
  private async inversiones(
    ms: MiembroCargado[],
    p: PeriodoConsolidacion,
    saldos: Map<string, SaldoCuenta[]>,
    tipos: Map<string, TiposCambioSociedad>,
  ): Promise<{
    dto: InversionPatrimonioDto[];
    ajustes: AjusteConsolidacion[];
  }> {
    const conInversion = ms.filter(
      ({ m }) =>
        m.investmentCost !== null &&
        (m.acquisitionDate ?? m.startDate) <= p.hasta,
    );
    const pnMayor = new Map<string, number>();
    const porFecha = new Map<string, string[]>();
    for (const { m } of conInversion) {
      if (m.equityAtAcquisition !== null) continue;
      const f = m.acquisitionDate ?? m.startDate;
      porFecha.set(f, [...(porFecha.get(f) ?? []), m.memberCompanyId]);
    }
    for (const [f, idsF] of porFecha) {
      const s = await this.saldosAFecha(idsF, f);
      for (const id of idsF) {
        const pn = patrimonioNetoDeSaldos(s.get(id) ?? []);
        pnMayor.set(
          id,
          fromCents(toCents(pn.patrimonio) + toCents(pn.resultado)),
        );
      }
    }
    const dto: InversionPatrimonioDto[] = [];
    const ajustes: AjusteConsolidacion[] = [];
    for (const { m, nombre } of conInversion) {
      const id = m.memberCompanyId;
      const fechaAdquisicion = m.acquisitionDate ?? m.startDate;
      const cuentaInversion = m.investmentAccount ?? CUENTA_INVERSION_GRUPO;
      const pnFuncional = m.equityAtAcquisition ?? pnMayor.get(id) ?? 0;
      const t = tipos.get(id);
      const cierre = patrimonioNetoDeSaldos(saldos.get(id) ?? []);
      const r = eliminacionInversionPatrimonio({
        companyId: id,
        nombre,
        metodo: m.method as MetodoConsolidacion,
        participacionPct: m.ownershipPct,
        costeInversion: m.investmentCost!,
        cuentaInversion,
        patrimonioAdquisicion: t
          ? convertirImporte(pnFuncional, t.historico)
          : pnFuncional,
        patrimonioCierre: cierre.patrimonio,
        resultadoPeriodo: cierre.resultado,
        adquisicionEnPeriodo:
          fechaAdquisicion >= p.desde && fechaAdquisicion <= p.hasta,
      });
      ajustes.push(...r.ajustes);
      dto.push({
        ...r,
        nombre,
        cuentaInversion,
        fechaAdquisicion,
        patrimonioDelMayor: m.equityAtAcquisition === null,
        ajustes: r.ajustes.map((a) => ({
          concepto: a.concepto,
          lineas: a.lineas.map((l) => ({
            cuenta: l.cuenta,
            debe: Number(l.debe),
            haber: Number(l.haber),
          })),
        })),
      });
    }
    return { dto, ajustes };
  }

  private async calcularEstados(
    g: CorporateGroup,
    p: PeriodoConsolidacion,
  ): Promise<EstadosConsolidadosDto> {
    const ms = await this.perimetro(g, p);
    const ids = ms.map(({ m }) => m.memberCompanyId);
    const [saldosFuncionales, ops, manuales, tipos] = await Promise.all([
      this.saldos(ids, p),
      this.operaciones(ms, p),
      this.dbs.db
        .select()
        .from(consolidationAdjustments)
        .where(
          and(
            eq(consolidationAdjustments.groupId, g.id),
            eq(consolidationAdjustments.status, 'vigente'),
            sql`${consolidationAdjustments.adjustmentDate} between ${p.desde} and ${p.hasta}`,
          ),
        )
        .orderBy(asc(consolidationAdjustments.adjustmentDate)),
      this.tiposPerimetro(g, ms, p, ['cierre', 'medio', 'historico']),
    ]);

    // 1. Conversión a la moneda de presentación (con su CTA en 1350).
    const conversion: ConversionSociedadDto[] = [];
    const saldos = new Map<string, SaldoCuenta[]>();
    for (const { m, nombre, moneda } of ms) {
      const id = m.memberCompanyId;
      const propios = saldosFuncionales.get(id) ?? [];
      const t = tipos.get(id);
      if (!t) {
        saldos.set(id, propios);
        continue;
      }
      const c = convertirSaldosMoneda(propios, t);
      saldos.set(id, c.saldos);
      conversion.push({
        companyId: id,
        nombre,
        monedaFuncional: moneda,
        tasas: {
          cierre: Number(t.cierre),
          medio: Number(t.medio),
          historico: Number(t.historico),
        },
        diferenciaConversion: c.diferenciaConversion,
        porMasa: c.porMasa,
      });
    }

    // 2. Intragrupo entre sociedades integradas, convertido: operaciones al
    //    tipo medio y saldos al de cierre de la moneda de cada lado.
    const datos = new Map(ms.map(({ m }) => [m.memberCompanyId, m]));
    const integrada = (id: string) =>
      datos.get(id)!.method !== 'puesta_equivalencia';
    const conv = (id: string, tipo: 'cierre' | 'medio', v: number | string) => {
      const t = tipos.get(id);
      return t ? convertirImporte(v, t[tipo]) : v;
    };
    const pares = ops.pares
      .filter((o) => integrada(o.vendedor) && integrada(o.comprador))
      .map((o) => ({
        ...o,
        ventas: conv(o.vendedor, 'medio', o.ventas),
        compras: conv(o.comprador, 'medio', o.compras),
        cobrar: conv(o.vendedor, 'cierre', o.cobrar),
        pagar: conv(o.comprador, 'cierre', o.pagar),
      }));
    const pctDe = (id: string) =>
      datos.get(id)!.method === 'proporcional'
        ? toCents(datos.get(id)!.ownershipPct)
        : 10_000n;
    const { conciliacion, ajustes } = eliminacionesIntragrupo(pares, (v, c) => {
      const min = pctDe(v) < pctDe(c) ? pctDe(v) : pctDe(c);
      return fromCents(min);
    });

    // 3. Inversión–patrimonio neto, socios externos y fondo de comercio.
    const inversiones = await this.inversiones(ms, p, saldos, tipos);
    const ajustesManuales: AjusteConsolidacion[] = manuales.map((a) => ({
      concepto: a.description,
      origen: 'manual',
      lineas: [
        { cuenta: a.debitAccount, debe: a.amount, haber: '0' },
        { cuenta: a.creditAccount, debe: '0', haber: a.amount },
      ],
    }));
    const calculo = consolidarEstados({
      sociedades: ms.map(({ m, nombre }) => ({
        companyId: m.memberCompanyId,
        nombre,
        metodo: m.method as MetodoConsolidacion,
        participacionPct: m.ownershipPct,
        saldos: saldos.get(m.memberCompanyId) ?? [],
      })),
      ajustes: [...ajustes, ...inversiones.ajustes, ...ajustesManuales],
    });
    const total = (vs: number[]) =>
      fromCents(sumCents(vs.map((v) => toCents(v))));
    return {
      grupoId: g.id,
      desde: p.desde,
      hasta: p.hasta,
      generadoEn: new Date().toISOString(),
      sociedades: ms.map(({ m, nombre, moneda }) => ({
        companyId: m.memberCompanyId,
        nombre,
        metodo: m.method as MetodoConsolidacion,
        participacionPct: Number(m.ownershipPct),
        monedaFuncional: moneda,
      })),
      monedaPresentacion: g.baseCurrency,
      conversion,
      diferenciaConversion: total(
        conversion.map((c) => c.diferenciaConversion),
      ),
      inversionPatrimonio: inversiones.dto,
      fondoComercio: total(inversiones.dto.map((i) => i.fondoComercio)),
      diferenciaNegativa: total(
        inversiones.dto.map((i) => i.diferenciaNegativa),
      ),
      ...calculo,
      conciliacionIntragrupo: conciliacion,
      descuadreIntercompania: conciliacion.some((c) => c.descuadre),
      eliminacionesAutomaticas: fromCents(
        sumCents(ajustes.flatMap((a) => a.lineas.map((l) => toCents(l.debe)))),
      ),
      ajustesManuales: manuales.map((a) => this.ajusteDto(a)),
      cerrado: false,
    };
  }

  /** Estados consolidados; un periodo cerrado devuelve su snapshot. */
  async estados(
    groupId: string,
    input: PeriodoConsolidacion,
  ): Promise<EstadosConsolidadosDto> {
    const p = periodoConsolidacionSchema.parse(input);
    const g = await this.cargarGrupo(groupId);
    const [cierre] = await this.dbs.db
      .select()
      .from(consolidationClosings)
      .where(
        and(
          eq(consolidationClosings.groupId, g.id),
          eq(consolidationClosings.periodFrom, p.desde),
          eq(consolidationClosings.periodTo, p.hasta),
        ),
      );
    if (cierre) {
      const snap = cierre.snapshot as EstadosConsolidadosDto;
      // El snapshot también exige acceso actual a sus sociedades.
      await this.exigirAcceso(snap.sociedades.map((s) => s.companyId));
      return { ...snap, cerrado: true };
    }
    return this.calcularEstados(g, p);
  }

  async intercompania(groupId: string, input: PeriodoConsolidacion) {
    const e = await this.estados(groupId, input);
    return {
      grupoId: e.grupoId,
      desde: e.desde,
      hasta: e.hasta,
      descuadre: e.descuadreIntercompania,
      conciliacion: e.conciliacionIntragrupo,
    };
  }

  async tesoreria(groupId: string, hasta: string): Promise<TesoreriaGrupoDto> {
    const p = periodoConsolidacionSchema.parse({ desde: hasta, hasta });
    const g = await this.cargarGrupo(groupId);
    // Las puestas en equivalencia no integran tesorería ni cartera.
    const ms = (await this.perimetro(g, p)).filter(
      ({ m }) => m.method !== 'puesta_equivalencia',
    );
    const ids = ms.map(({ m }) => m.memberCompanyId);
    const tipos = await this.tiposPerimetro(g, ms, p, ['cierre']);
    // Moneda extranjera: todo al tipo de cierre de `hasta`.
    const aCierre = (id: string, cents: bigint) => {
      const t = tipos.get(id);
      return t ? toCents(convertirImporte(fromCents(cents), t.cierre)) : cents;
    };
    const [saldos, ops, cartera] = await Promise.all([
      this.saldos(ids, { desde: '1900-01-01', hasta }),
      this.operaciones(ms, p),
      this.dbs.db.execute(sql`
        select p.company_id as company,
          count(*) filter (where p.status in ('adjudicada', 'en_curso'))::int as activas,
          coalesce(sum(p.contract_amount) filter (where p.status in ('adjudicada', 'en_curso')), 0)::text as contratado,
          coalesce(sum(uc.cum) filter (where p.status in ('adjudicada', 'en_curso')), 0)::text as certificado
        from projects p
        left join lateral (select c.cumulative_amount as cum from certifications c
          where c.project_id = p.id and c.deleted_at is null order by c.seq desc limit 1) uc on true
        where p.company_id in (${lista(ids)}) and p.deleted_at is null
        group by p.company_id`),
    ]);
    const nombre = new Map(
      ms.map(({ m, nombre: n }) => [m.memberCompanyId, n]),
    );
    const pos = posicionTesoreriaGrupo(
      ms.map(({ m }) => {
        const id = m.memberCompanyId;
        const e = ops.externo.get(id)!;
        const liquidez = sumCents(
          (saldos.get(id) ?? [])
            .filter((s) => s.codigo.startsWith('57'))
            .map((s) => toCents(s.saldoDeudor)),
        );
        return {
          companyId: id,
          metodo: m.method as MetodoConsolidacion,
          participacionPct: m.ownershipPct,
          liquidez: fromCents(aCierre(id, liquidez)),
          cobrosExternos: fromCents(aCierre(id, e.cobros)),
          cobrosIntragrupo: fromCents(aCierre(id, e.cobrosIg)),
          pagosExternos: fromCents(aCierre(id, e.pagos)),
          pagosIntragrupo: fromCents(aCierre(id, e.pagosIg)),
        };
      }),
    );
    const filasCartera = new Map(
      (
        cartera.rows as {
          company: string;
          activas: number;
          contratado: string;
          certificado: string;
        }[]
      ).map((r) => [r.company, r]),
    );
    return {
      grupoId: g.id,
      hasta,
      ...pos,
      porSociedad: pos.porSociedad.map((s) => ({
        ...s,
        nombre: nombre.get(s.companyId)!,
      })),
      cartera: ids.map((id) => {
        const r = filasCartera.get(id);
        const contratado = aCierre(id, toCents(r?.contratado ?? '0'));
        const certificado = aCierre(id, toCents(r?.certificado ?? '0'));
        return {
          companyId: id,
          nombre: nombre.get(id)!,
          obrasActivas: Number(r?.activas ?? 0),
          contratado: fromCents(contratado),
          certificado: fromCents(certificado),
          pendienteCertificar: fromCents(contratado - certificado),
        };
      }),
    };
  }

  /* ─────────────────────── ajustes y cierres ─────────────────────── */

  private async exigirPeriodoAbierto(groupId: string, fecha: string) {
    const [c] = await this.dbs.db
      .select({
        desde: consolidationClosings.periodFrom,
        hasta: consolidationClosings.periodTo,
      })
      .from(consolidationClosings)
      .where(
        and(
          eq(consolidationClosings.groupId, groupId),
          sql`${fecha} between ${consolidationClosings.periodFrom} and ${consolidationClosings.periodTo}`,
        ),
      )
      .limit(1);
    if (c) {
      throw new ConflictException({
        code: 'CONSOLIDATION_PERIOD_CLOSED',
        message: `La consolidación del periodo ${c.desde} – ${c.hasta} está cerrada`,
      });
    }
  }

  async ajustes(groupId: string): Promise<AjusteConsolidacionDto[]> {
    const g = await this.cargarGrupo(groupId);
    const filas = await this.dbs.db
      .select()
      .from(consolidationAdjustments)
      .where(eq(consolidationAdjustments.groupId, g.id))
      .orderBy(desc(consolidationAdjustments.adjustmentDate));
    return filas.map((a) => this.ajusteDto(a));
  }

  async crearAjuste(groupId: string, input: AjusteConsolidacionCreateInput) {
    const d = ajusteConsolidacionCreateSchema.parse(input);
    const g = await this.cargarGrupo(groupId);
    if (d.companyId) await this.exigirAcceso([d.companyId]);
    await this.exigirPeriodoAbierto(g.id, d.fecha);
    const { userId } = this.ctx();
    const a = await this.dbs.db.transaction(async (tx) => {
      const [nuevo] = await tx
        .insert(consolidationAdjustments)
        .values({
          companyId: g.companyId,
          groupId: g.id,
          adjustmentDate: d.fecha,
          description: d.concepto,
          debitAccount: d.cuentaDebe,
          creditAccount: d.cuentaHaber,
          amount: d.importe.toFixed(2),
          memberCompanyId: d.companyId ?? null,
          createdBy: userId,
        })
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'consolidation_adjustment',
        entityId: nuevo.id,
        action: 'create',
        newData: nuevo,
      });
      return nuevo;
    });
    return this.ajusteDto(a);
  }

  async anularAjuste(
    groupId: string,
    id: string,
    input: AnularAjusteInput,
    version?: number,
  ) {
    const { motivo } = anularAjusteSchema.parse(input);
    const g = await this.cargarGrupo(groupId);
    const a = await this.dbs.db.transaction(async (tx) => {
      const [actual] = await tx
        .select()
        .from(consolidationAdjustments)
        .where(
          and(
            eq(consolidationAdjustments.id, id),
            eq(consolidationAdjustments.groupId, g.id),
          ),
        )
        .for('update');
      if (!actual) {
        throw new NotFoundException({
          code: 'CONSOLIDATION_ADJUSTMENT_NOT_FOUND',
          message: 'Ajuste no encontrado',
        });
      }
      verificarVersion(actual.version, version);
      if (actual.status === 'anulado') {
        throw new ConflictException({
          code: 'CONSOLIDATION_ADJUSTMENT_CANCELLED',
          message: 'El ajuste ya está anulado',
        });
      }
      await this.exigirPeriodoAbierto(g.id, actual.adjustmentDate);
      const nuevo = (await cambiarEstado(
        tx,
        consolidationAdjustments,
        'consolidation_adjustment',
        id,
        'vigente',
        'anulado',
        { cancelReason: motivo },
        version,
      )) as ConsolidationAdjustment;
      await this.audit.registrar(tx, {
        entityType: 'consolidation_adjustment',
        entityId: id,
        action: 'update',
        oldData: { status: actual.status },
        newData: { status: 'anulado', motivo },
      });
      return nuevo;
    });
    return this.ajusteDto(a);
  }

  async cierres(groupId: string): Promise<CierreConsolidacionDto[]> {
    const g = await this.cargarGrupo(groupId);
    const filas = await this.dbs.db
      .select()
      .from(consolidationClosings)
      .where(eq(consolidationClosings.groupId, g.id))
      .orderBy(desc(consolidationClosings.periodTo));
    return filas.map((c) => ({
      id: c.id,
      desde: c.periodFrom,
      hasta: c.periodTo,
      resultado: (c.snapshot as EstadosConsolidadosDto).totales.resultado,
      cerradoEn: c.createdAt.toISOString(),
      cerradoPor: c.createdBy,
    }));
  }

  /**
   * Cierra (congela) un periodo: guarda el snapshot de los estados. No cierra
   * con descuadres intercompañía salvo `forzar` (queda auditado).
   */
  async cerrar(
    groupId: string,
    input: PeriodoConsolidacion & { forzar?: boolean },
  ) {
    const p = periodoConsolidacionSchema.parse(input);
    const g = await this.cargarGrupo(groupId);
    const estados = await this.calcularEstados(g, p);
    if (estados.descuadreIntercompania && !input.forzar) {
      throw new ConflictException({
        code: 'INTERCOMPANY_MISMATCH',
        message:
          'Hay descuadres intercompañía en el periodo: concílialos (o ajústalos) antes de cerrar, o fuerza el cierre',
        conciliacion: estados.conciliacionIntragrupo.filter((c) => c.descuadre),
      });
    }
    const { userId } = this.ctx();
    await this.dbs.db.transaction(async (tx) => {
      const [c] = await tx
        .insert(consolidationClosings)
        .values({
          companyId: g.companyId,
          groupId: g.id,
          periodFrom: p.desde,
          periodTo: p.hasta,
          snapshot: { ...estados, cerrado: true },
          createdBy: userId,
        })
        .onConflictDoNothing()
        .returning();
      if (!c) {
        throw new ConflictException({
          code: 'CONSOLIDATION_PERIOD_CLOSED',
          message: 'Ese periodo ya está cerrado',
        });
      }
      await this.audit.registrar(tx, {
        entityType: 'consolidation_closing',
        entityId: c.id,
        action: 'create',
        newData: {
          desde: p.desde,
          hasta: p.hasta,
          resultado: estados.totales.resultado,
          forzado: Boolean(input.forzar && estados.descuadreIntercompania),
        },
      });
    });
    return this.cierres(groupId);
  }
}
