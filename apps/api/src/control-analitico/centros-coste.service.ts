import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import {
  costCenterAccounts,
  costCenters,
  users,
  type CostCenter,
  type Tx,
} from '@erp/db';
import {
  centroCosteCreateSchema,
  centroCosteUpdateSchema,
  periodoRepartoSchema,
  type CentroCosteCreateInput,
  type CentroCosteDto,
  type CentroCosteUpdateInput,
  type PeriodoReparto,
  type SaldoCentroDto,
  type TipoCentroCoste,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { verificarVersion } from '../common/version';
import { DbService } from '../db/db.service';
import { saldosCentros } from './analitica';

export const centroNoEncontrado = () =>
  new NotFoundException({
    code: 'COST_CENTER_NOT_FOUND',
    message: 'Centro de coste no encontrado',
  });

/**
 * Centros de coste (SAP CO-OM KS01/KS02, jerarquía estándar): código único
 * por empresa, jerarquía sin ciclos, responsable de la empresa y cuentas de
 * gasto asignadas (un prefijo pertenece a un solo centro).
 */
@Injectable()
export class CentrosCosteService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  private async dtos(filas: CostCenter[]): Promise<CentroCosteDto[]> {
    if (filas.length === 0) return [];
    const ids = filas.map((c) => c.id);
    const [cuentas, responsables] = await Promise.all([
      this.dbs.db
        .select()
        .from(costCenterAccounts)
        .where(inArray(costCenterAccounts.costCenterId, ids))
        .orderBy(asc(costCenterAccounts.accountPrefix)),
      this.dbs.db
        .select({ id: users.id, nombre: users.fullName })
        .from(users)
        .where(
          inArray(
            users.id,
            filas
              .map((c) => c.responsibleUserId)
              .filter((x): x is string => !!x)
              .concat(['00000000-0000-0000-0000-000000000000']),
          ),
        ),
    ]);
    const nombre = new Map(responsables.map((u) => [u.id, u.nombre]));
    return filas.map((c) => ({
      id: c.id,
      codigo: c.code,
      nombre: c.name,
      tipo: c.kind as TipoCentroCoste,
      padreId: c.parentId,
      responsableId: c.responsibleUserId,
      responsableNombre: c.responsibleUserId
        ? (nombre.get(c.responsibleUserId) ?? null)
        : null,
      activo: c.isActive,
      notas: c.notes,
      cuentas: cuentas
        .filter((a) => a.costCenterId === c.id)
        .map((a) => a.accountPrefix),
      version: c.version,
    }));
  }

  async listar(): Promise<CentroCosteDto[]> {
    const filas = await this.dbs.db
      .select()
      .from(costCenters)
      .where(eq(costCenters.companyId, this.dbs.getCompanyId()))
      .orderBy(asc(costCenters.code));
    return this.dtos(filas);
  }

  async obtener(id: string): Promise<CentroCosteDto> {
    const [c] = await this.dbs.db
      .select()
      .from(costCenters)
      .where(
        and(
          eq(costCenters.id, id),
          eq(costCenters.companyId, this.dbs.getCompanyId()),
        ),
      );
    if (!c) throw centroNoEncontrado();
    return (await this.dtos([c]))[0];
  }

  private async exigirResponsable(tx: Tx, userId: string | null | undefined) {
    if (!userId) return;
    const [u] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(eq(users.id, userId), eq(users.companyId, this.dbs.getCompanyId())),
      );
    if (!u) {
      throw new UnprocessableEntityException({
        code: 'USER_NOT_FOUND',
        message: 'El responsable no es un usuario de la empresa',
      });
    }
  }

  /** El padre existe en la empresa y no es descendiente del propio centro. */
  private async exigirPadre(
    tx: Tx,
    padreId: string | null | undefined,
    propioId?: string,
  ) {
    if (!padreId) return;
    const companyId = this.dbs.getCompanyId();
    const todos = await tx
      .select({ id: costCenters.id, padre: costCenters.parentId })
      .from(costCenters)
      .where(eq(costCenters.companyId, companyId));
    const padreDe = new Map(todos.map((c) => [c.id, c.padre]));
    if (!padreDe.has(padreId)) throw centroNoEncontrado();
    let cursor: string | null | undefined = padreId;
    const vistos = new Set<string>();
    while (cursor) {
      if (cursor === propioId || vistos.has(cursor)) {
        throw new UnprocessableEntityException({
          code: 'COST_CENTER_HIERARCHY_CYCLE',
          message:
            'El centro padre no puede ser el propio centro ni un descendiente suyo',
        });
      }
      vistos.add(cursor);
      cursor = padreDe.get(cursor);
    }
  }

  /** Sustituye las cuentas asignadas; un prefijo de otro centro → 409. */
  private async asignarCuentas(tx: Tx, centroId: string, prefijos: string[]) {
    const companyId = this.dbs.getCompanyId();
    const unicos = [...new Set(prefijos)];
    if (unicos.length > 0) {
      const ocupadas = await tx
        .select({ prefijo: costCenterAccounts.accountPrefix })
        .from(costCenterAccounts)
        .where(
          and(
            eq(costCenterAccounts.companyId, companyId),
            inArray(costCenterAccounts.accountPrefix, unicos),
            ne(costCenterAccounts.costCenterId, centroId),
          ),
        );
      if (ocupadas.length > 0) {
        throw new ConflictException({
          code: 'COST_CENTER_ACCOUNT_TAKEN',
          message: `Cuentas ya asignadas a otro centro: ${ocupadas.map((o) => o.prefijo).join(', ')}`,
        });
      }
    }
    await tx
      .delete(costCenterAccounts)
      .where(eq(costCenterAccounts.costCenterId, centroId));
    if (unicos.length > 0) {
      await tx.insert(costCenterAccounts).values(
        unicos.map((accountPrefix) => ({
          companyId,
          costCenterId: centroId,
          accountPrefix,
        })),
      );
    }
    return unicos.sort();
  }

  async crear(input: CentroCosteCreateInput): Promise<CentroCosteDto> {
    const d = centroCosteCreateSchema.parse(input);
    const { companyId, userId } = this.dbs.getContext();
    const id = await this.dbs.db.transaction(async (tx) => {
      await this.exigirPadre(tx, d.padreId);
      await this.exigirResponsable(tx, d.responsableId);
      const [c] = await tx
        .insert(costCenters)
        .values({
          companyId,
          code: d.codigo,
          name: d.nombre,
          kind: d.tipo,
          parentId: d.padreId ?? null,
          responsibleUserId: d.responsableId ?? null,
          notes: d.notas ?? null,
          createdBy: userId,
        })
        .onConflictDoNothing()
        .returning();
      if (!c) {
        throw new ConflictException({
          code: 'COST_CENTER_CODE_DUPLICATE',
          message: `Ya existe el centro de coste ${d.codigo}`,
        });
      }
      const cuentas = await this.asignarCuentas(tx, c.id, d.cuentas);
      await this.audit.registrar(tx, {
        entityType: 'cost_center',
        entityId: c.id,
        action: 'create',
        newData: { ...c, cuentas },
      });
      return c.id;
    });
    return this.obtener(id);
  }

  async actualizar(
    id: string,
    input: CentroCosteUpdateInput,
    version?: number,
  ): Promise<CentroCosteDto> {
    const d = centroCosteUpdateSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    await this.dbs.db.transaction(async (tx) => {
      const [actual] = await tx
        .select()
        .from(costCenters)
        .where(
          and(eq(costCenters.id, id), eq(costCenters.companyId, companyId)),
        )
        .for('update');
      if (!actual) throw centroNoEncontrado();
      verificarVersion(actual.version, version);
      if (d.padreId !== undefined) await this.exigirPadre(tx, d.padreId, id);
      if (d.responsableId !== undefined)
        await this.exigirResponsable(tx, d.responsableId);
      const antes = (
        await tx
          .select({ p: costCenterAccounts.accountPrefix })
          .from(costCenterAccounts)
          .where(eq(costCenterAccounts.costCenterId, id))
      )
        .map((r) => r.p)
        .sort();
      const cuentas =
        d.cuentas !== undefined
          ? await this.asignarCuentas(tx, id, d.cuentas)
          : antes;
      const [nuevo] = await tx
        .update(costCenters)
        .set({
          ...(d.nombre !== undefined && { name: d.nombre }),
          ...(d.tipo !== undefined && { kind: d.tipo }),
          ...(d.padreId !== undefined && { parentId: d.padreId ?? null }),
          ...(d.responsableId !== undefined && {
            responsibleUserId: d.responsableId ?? null,
          }),
          ...(d.notas !== undefined && { notes: d.notas ?? null }),
          ...(d.activo !== undefined && { isActive: d.activo }),
          version: actual.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(costCenters.id, id))
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'cost_center',
        entityId: id,
        action: 'update',
        oldData: { ...actual, cuentas: antes },
        newData: { ...nuevo, cuentas },
      });
    });
    return this.obtener(id);
  }

  async saldos(input: PeriodoReparto): Promise<SaldoCentroDto[]> {
    const p = periodoRepartoSchema.parse(input);
    return saldosCentros(this.dbs.db, this.dbs.getCompanyId(), p);
  }
}
