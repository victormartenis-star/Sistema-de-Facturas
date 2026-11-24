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
  userCompanyGrants,
  users,
  type ConsolidationAdjustment,
  type CorporateGroup,
  type CorporateGroupMember,
} from '@erp/db';
import {
  ajusteConsolidacionCreateSchema,
  anularAjusteSchema,
  consolidarEstados,
  eliminacionesIntragrupo,
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
import { cambiarEstado } from '../common/cambiar-estado';
import { verificarVersion } from '../common/version';
import { DbService } from '../db/db.service';

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
      miembros: ms.map(({ m, nombre, nif }): MiembroGrupoDto => ({
        id: m.id,
        companyId: m.memberCompanyId,
        nombre,
        nif,
        participacionPct: Number(m.ownershipPct),
        metodo: m.method as MetodoConsolidacion,
        fechaAlta: m.startDate,
        fechaBaja: m.endDate,
        accesible: accesibles.has(m.memberCompanyId),
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

  async integrarSociedad(groupId: string, input: MiembroCreateInput) {
    const d = miembroCreateSchema.parse(input);
    const g = await this.cargarGrupo(groupId);
    await this.exigirAcceso([d.companyId]);
    await this.dbs.db.transaction(async (tx) => {
      const [m] = await tx
        .insert(corporateGroupMembers)
        .values({
          groupId: g.id,
          memberCompanyId: d.companyId,
          ownershipPct: d.participacionPct.toFixed(2),
          method: d.metodo,
          startDate: d.fechaAlta,
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
    });
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
      const [nuevo] = await tx
        .update(corporateGroupMembers)
        .set({
          ...(d.participacionPct !== undefined && {
            ownershipPct: d.participacionPct.toFixed(2),
          }),
          ...(d.metodo !== undefined && { method: d.metodo }),
          ...(d.fechaBaja !== undefined && { endDate: d.fechaBaja ?? null }),
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

  private async calcularEstados(
    g: CorporateGroup,
    p: PeriodoConsolidacion,
  ): Promise<EstadosConsolidadosDto> {
    const ms = await this.perimetro(g, p);
    const ids = ms.map(({ m }) => m.memberCompanyId);
    const [saldos, ops, manuales] = await Promise.all([
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
    ]);
    const datos = new Map(ms.map(({ m }) => [m.memberCompanyId, m]));
    const pctDe = (id: string) =>
      datos.get(id)!.method === 'proporcional'
        ? toCents(datos.get(id)!.ownershipPct)
        : 10_000n;
    const { conciliacion, ajustes } = eliminacionesIntragrupo(
      ops.pares,
      (v, c) => {
        const min = pctDe(v) < pctDe(c) ? pctDe(v) : pctDe(c);
        return fromCents(min);
      },
    );
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
      ajustes: [...ajustes, ...ajustesManuales],
    });
    return {
      grupoId: g.id,
      desde: p.desde,
      hasta: p.hasta,
      generadoEn: new Date().toISOString(),
      sociedades: ms.map(({ m, nombre }) => ({
        companyId: m.memberCompanyId,
        nombre,
        metodo: m.method as MetodoConsolidacion,
        participacionPct: Number(m.ownershipPct),
      })),
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
    const ms = await this.perimetro(g, p);
    const ids = ms.map(({ m }) => m.memberCompanyId);
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
        const e = ops.externo.get(m.memberCompanyId)!;
        const liquidez = sumCents(
          (saldos.get(m.memberCompanyId) ?? [])
            .filter((s) => s.codigo.startsWith('57'))
            .map((s) => toCents(s.saldoDeudor)),
        );
        return {
          companyId: m.memberCompanyId,
          metodo: m.method as MetodoConsolidacion,
          participacionPct: m.ownershipPct,
          liquidez: fromCents(liquidez),
          cobrosExternos: fromCents(e.cobros),
          cobrosIntragrupo: fromCents(e.cobrosIg),
          pagosExternos: fromCents(e.pagos),
          pagosIntragrupo: fromCents(e.pagosIg),
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
        const contratado = toCents(r?.contratado ?? '0');
        const certificado = toCents(r?.certificado ?? '0');
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
