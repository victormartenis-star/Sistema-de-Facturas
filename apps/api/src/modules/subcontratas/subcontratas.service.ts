import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  type CertificacionSubcontrata,
  type ContratoSubcontrata,
  type DbOrTx,
  certificacionesSubcontrata,
  contratosSubcontrata,
  devolucionesGarantiaSubcontrata,
  projects,
  proveedores,
} from '@erp/db';
import {
  CERT_SUBCONTRATA_VIGENTES,
  CertSubcontrataInvalidaError,
  type CertSubcontrataAnularInput,
  type CertSubcontrataCreateInput,
  type CertSubcontrataDto,
  type CertSubcontrataPagarInput,
  type CertSubcontrataStatus,
  type CertSubcontrataUpdateInput,
  type ContratoSubcontrataResumenDto,
  type ContratosSubcontrataQuery,
  type DevolucionGarantiaCreateInput,
  type DevolucionGarantiaDto,
  type RetencionGarantiaDto,
  certSubcontrataAnularSchema,
  certSubcontrataCreateSchema,
  certSubcontrataPagarSchema,
  certSubcontrataUpdateSchema,
  computeCertSubcontrata,
  devolucionGarantiaCreateSchema,
  esCertSubcontrataVigente,
  motivoDevolucionInvalida,
  resumenRetencionGarantia,
} from '@erp/shared';
import { AuditService } from '../../audit/audit.service';
import { cambiarEstado } from '../../common/cambiar-estado';
import {
  condicionVersion,
  falloActualizacion,
  incrementarVersion,
  verificarVersion,
} from '../../common/version';
import { DbService } from '../../db/db.service';
import { ProveedoresService } from '../proveedores/proveedores.service';

function aDto(c: CertificacionSubcontrata): CertSubcontrataDto {
  return {
    id: c.id,
    version: c.version,
    contratoId: c.contratoId,
    numero: c.numero,
    fecha: c.fecha,
    periodoDesde: c.periodoDesde,
    periodoHasta: c.periodoHasta,
    importeOrigen: Number(c.importeOrigen),
    importeAnterior: Number(c.importeAnterior),
    importePeriodo: Number(c.importePeriodo),
    retencionPct: Number(c.retencionPct),
    retencionImporte: Number(c.retencionImporte),
    importeLiquido: Number(c.importeLiquido),
    status: c.status as CertSubcontrataStatus,
    aprobadaAt: c.aprobadaAt?.toISOString() ?? null,
    fechaPago: c.fechaPago,
    anuladaAt: c.anuladaAt?.toISOString() ?? null,
    motivoAnulacion: c.motivoAnulacion,
    notas: c.notas,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** Lo que se audita de una certificación (importes y estado). */
function instantanea(c: CertificacionSubcontrata) {
  const d = aDto(c);
  return {
    contratoId: d.contratoId,
    numero: d.numero,
    fecha: d.fecha,
    periodoDesde: d.periodoDesde,
    periodoHasta: d.periodoHasta,
    importeOrigen: d.importeOrigen,
    importeAnterior: d.importeAnterior,
    importePeriodo: d.importePeriodo,
    retencionPct: d.retencionPct,
    retencionImporte: d.retencionImporte,
    importeLiquido: d.importeLiquido,
    status: d.status,
  };
}

/** Cálculo puro → columnas `numeric` (o 422 si la medición no cuadra). */
function calcular(
  contrato: ContratoSubcontrata,
  importeOrigen: number,
  importeAnterior: number,
) {
  try {
    const r = computeCertSubcontrata(
      Number(contrato.importeTotal),
      importeOrigen,
      importeAnterior,
      Number(contrato.retencionGarantiaPct),
    );
    return {
      importeOrigen: r.importeOrigen.toFixed(2),
      importeAnterior: r.importeAnterior.toFixed(2),
      importePeriodo: r.importePeriodo.toFixed(2),
      retencionPct: Number(contrato.retencionGarantiaPct).toFixed(2),
      retencionImporte: r.retencionImporte.toFixed(2),
      importeLiquido: r.importeLiquido.toFixed(2),
      pctEjecutado: r.pctEjecutado,
    };
  } catch (e) {
    if (e instanceof CertSubcontrataInvalidaError) {
      throw new UnprocessableEntityException(e.message);
    }
    throw e;
  }
}

/**
 * Certificaciones de subcontrata y retención de garantía.
 *
 * Toda mutación bloquea primero la fila del CONTRATO (`FOR UPDATE`) y
 * después la de la certificación: así se serializan la numeración, el
 * "anterior a origen" y el saldo de garantía de un mismo contrato, y el
 * orden de bloqueo es siempre el mismo (sin interbloqueos). La auditoría se
 * registra dentro de la transacción y como última operación.
 */
@Injectable()
export class SubcontratasService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly proveedores: ProveedoresService,
  ) {}

  /* ─────────────────────────── contratos ─────────────────────────── */

  async listContratos(
    query: ContratosSubcontrataQuery,
  ): Promise<ContratoSubcontrataResumenDto[]> {
    const companyId = this.dbs.getCompanyId();
    const obras = await this.dbs.getObrasAccesibles();
    if (obras !== null && obras.length === 0) return [];
    const filas = await this.dbs.db
      .select({
        contrato: contratosSubcontrata,
        proveedorNombre: proveedores.razonSocial,
        proyectoCodigo: projects.code,
        proyectoNombre: projects.name,
      })
      .from(contratosSubcontrata)
      .innerJoin(
        proveedores,
        eq(proveedores.id, contratosSubcontrata.proveedorId),
      )
      .innerJoin(projects, eq(projects.id, contratosSubcontrata.proyectoId))
      .where(
        and(
          eq(contratosSubcontrata.companyId, companyId),
          isNull(contratosSubcontrata.deletedAt),
          query.proyectoId
            ? eq(contratosSubcontrata.proyectoId, query.proyectoId)
            : undefined,
          query.proveedorId
            ? eq(contratosSubcontrata.proveedorId, query.proveedorId)
            : undefined,
          obras !== null
            ? inArray(contratosSubcontrata.proyectoId, obras)
            : undefined,
        ),
      )
      .orderBy(asc(projects.code), asc(contratosSubcontrata.numeroContrato));
    if (filas.length === 0) return [];

    const ids = filas.map((f) => f.contrato.id);
    const certs = await this.dbs.db
      .select({
        contratoId: certificacionesSubcontrata.contratoId,
        status: certificacionesSubcontrata.status,
        retencionImporte: certificacionesSubcontrata.retencionImporte,
      })
      .from(certificacionesSubcontrata)
      .where(
        and(
          eq(certificacionesSubcontrata.companyId, companyId),
          inArray(certificacionesSubcontrata.contratoId, ids),
          isNull(certificacionesSubcontrata.deletedAt),
        ),
      );
    const devoluciones = await this.dbs.db
      .select({
        contratoId: devolucionesGarantiaSubcontrata.contratoId,
        importe: devolucionesGarantiaSubcontrata.importe,
      })
      .from(devolucionesGarantiaSubcontrata)
      .where(
        and(
          eq(devolucionesGarantiaSubcontrata.companyId, companyId),
          inArray(devolucionesGarantiaSubcontrata.contratoId, ids),
        ),
      );

    return filas.map(({ contrato: c, ...f }) => {
      const propias = certs.filter((x) => x.contratoId === c.id);
      const vigentes = propias.filter((x) =>
        esCertSubcontrataVigente(x.status as CertSubcontrataStatus),
      );
      const saldo = resumenRetencionGarantia(
        vigentes.map((x) => Number(x.retencionImporte)),
        devoluciones
          .filter((d) => d.contratoId === c.id)
          .map((d) => Number(d.importe)),
      );
      return {
        id: c.id,
        numeroContrato: c.numeroContrato,
        proveedorId: c.proveedorId,
        proveedorNombre: f.proveedorNombre,
        proyectoId: c.proyectoId,
        proyectoCodigo: f.proyectoCodigo,
        proyectoNombre: f.proyectoNombre,
        status: c.status,
        importeTotal: Number(c.importeTotal),
        importeEjecutado: Number(c.importeEjecutado),
        pctEjecutado: Number(c.pctEjecutado),
        retencionGarantiaPct: Number(c.retencionGarantiaPct),
        retencionPendiente: saldo.pendiente,
        certificacionesVigentes: vigentes.length,
        hayBorrador: propias.some((x) => x.status === 'borrador'),
      };
    });
  }

  /* ─────────────────────── certificaciones ─────────────────────── */

  async listCertificaciones(contratoId: string): Promise<CertSubcontrataDto[]> {
    await this.contrato(this.dbs.db, contratoId);
    const filas = await this.dbs.db
      .select()
      .from(certificacionesSubcontrata)
      .where(
        and(
          eq(certificacionesSubcontrata.companyId, this.dbs.getCompanyId()),
          eq(certificacionesSubcontrata.contratoId, contratoId),
          isNull(certificacionesSubcontrata.deletedAt),
        ),
      )
      .orderBy(asc(certificacionesSubcontrata.numero));
    return filas.map(aDto);
  }

  async getCertificacion(id: string): Promise<CertSubcontrataDto> {
    const cert = await this.cert(this.dbs.db, id);
    await this.contrato(this.dbs.db, cert.contratoId);
    return aDto(cert);
  }

  async create(
    contratoId: string,
    input: CertSubcontrataCreateInput,
  ): Promise<CertSubcontrataDto> {
    const data = certSubcontrataCreateSchema.parse(input);
    const companyId = this.dbs.getCompanyId();
    return this.dbs.db.transaction(async (tx) => {
      const contrato = await this.contrato(tx, contratoId, true);
      if (contrato.status !== 'activo') {
        throw new ConflictException(
          'Solo se certifica sobre contratos de subcontrata activos',
        );
      }
      const previas = await this.certsDelContrato(tx, contratoId);
      if (previas.some((c) => c.status === 'borrador')) {
        throw new ConflictException(
          'El contrato ya tiene una certificación en borrador: apruébala o elimínala antes de crear otra',
        );
      }
      const importes = calcular(
        contrato,
        data.importeOrigen,
        this.anteriorAOrigen(previas),
      );
      const numero = previas.reduce((m, c) => Math.max(m, c.numero), 0) + 1;
      const [creada] = await tx
        .insert(certificacionesSubcontrata)
        .values({
          companyId,
          contratoId,
          numero,
          fecha: data.fecha,
          periodoDesde: data.periodoDesde,
          periodoHasta: data.periodoHasta,
          importeOrigen: importes.importeOrigen,
          importeAnterior: importes.importeAnterior,
          importePeriodo: importes.importePeriodo,
          retencionPct: importes.retencionPct,
          retencionImporte: importes.retencionImporte,
          importeLiquido: importes.importeLiquido,
          notas: data.notas ?? null,
        })
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'cert_subcontrata',
        entityId: creada.id,
        action: 'create',
        newData: instantanea(creada),
      });
      return aDto(creada);
    });
  }

  async update(
    id: string,
    input: CertSubcontrataUpdateInput,
    versionEsperada?: number,
  ): Promise<CertSubcontrataDto> {
    const data = certSubcontrataUpdateSchema.parse(input);
    return this.dbs.db.transaction(async (tx) => {
      const { contrato, cert } = await this.bloquear(tx, id);
      verificarVersion(cert.version, versionEsperada);
      if (cert.status !== 'borrador') {
        throw new ConflictException(
          'Solo se editan certificaciones en borrador',
        );
      }
      const periodoDesde = data.periodoDesde ?? cert.periodoDesde;
      const periodoHasta = data.periodoHasta ?? cert.periodoHasta;
      if (periodoDesde > periodoHasta) {
        throw new UnprocessableEntityException(
          'El inicio del periodo no puede ser posterior al final',
        );
      }
      const previas = await this.certsDelContrato(tx, cert.contratoId);
      const importes = calcular(
        contrato,
        data.importeOrigen ?? Number(cert.importeOrigen),
        this.anteriorAOrigen(previas),
      );
      const { pctEjecutado: _pct, ...columnas } = importes;
      const [editada] = await tx
        .update(certificacionesSubcontrata)
        .set({
          ...columnas,
          ...(data.fecha !== undefined && { fecha: data.fecha }),
          periodoDesde,
          periodoHasta,
          ...(data.notas !== undefined && { notas: data.notas ?? null }),
          updatedAt: new Date(),
          version: incrementarVersion(certificacionesSubcontrata),
        })
        .where(
          and(
            eq(certificacionesSubcontrata.id, id),
            condicionVersion(certificacionesSubcontrata, versionEsperada),
          ),
        )
        .returning();
      if (!editada) {
        await falloActualizacion(
          tx,
          certificacionesSubcontrata,
          id,
          versionEsperada,
          () => new ConflictException('La certificación ha cambiado: recarga'),
          'Certificación no encontrada',
        );
      }
      await this.audit.registrar(tx, {
        entityType: 'cert_subcontrata',
        entityId: id,
        action: 'update',
        oldData: instantanea(cert),
        newData: instantanea(editada),
      });
      return aDto(editada);
    });
  }

  async remove(id: string, versionEsperada?: number): Promise<void> {
    await this.dbs.db.transaction(async (tx) => {
      const { cert } = await this.bloquear(tx, id);
      verificarVersion(cert.version, versionEsperada);
      if (cert.status !== 'borrador') {
        throw new ConflictException(
          'Solo se eliminan certificaciones en borrador: una aprobada se anula',
        );
      }
      await tx
        .update(certificacionesSubcontrata)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
          version: incrementarVersion(certificacionesSubcontrata),
        })
        .where(eq(certificacionesSubcontrata.id, id));
      await this.audit.registrar(tx, {
        entityType: 'cert_subcontrata',
        entityId: id,
        action: 'delete',
        oldData: instantanea(cert),
      });
    });
  }

  /**
   * borrador → aprobada. Recalcula con el contrato vigente (importe y % de
   * garantía pueden haber cambiado desde el borrador), exige que la
   * subcontrata esté apta por PRL y actualiza la producción ejecutada del
   * contrato.
   */
  async aprobar(
    id: string,
    versionEsperada?: number,
  ): Promise<CertSubcontrataDto> {
    return this.dbs.db.transaction(async (tx) => {
      const { contrato, cert } = await this.bloquear(tx, id);
      verificarVersion(cert.version, versionEsperada);
      if (cert.status !== 'borrador') {
        throw new ConflictException(
          'Solo se aprueban certificaciones en borrador',
        );
      }
      await this.exigirAptaPrl(contrato, 'aprobar la certificación');
      const previas = await this.certsDelContrato(tx, cert.contratoId);
      const { pctEjecutado, ...columnas } = calcular(
        contrato,
        Number(cert.importeOrigen),
        this.anteriorAOrigen(previas),
      );
      const aprobada = await cambiarEstado(
        tx,
        certificacionesSubcontrata,
        'cert_subcontrata',
        id,
        'borrador',
        'aprobada',
        { ...columnas, aprobadaAt: new Date() },
        versionEsperada,
      );
      await this.fijarEjecutado(
        tx,
        contrato,
        columnas.importeOrigen,
        pctEjecutado,
      );
      await this.audit.registrar(tx, {
        entityType: 'cert_subcontrata',
        entityId: id,
        action: 'update',
        oldData: instantanea(cert),
        newData: instantanea(aprobada),
        meta: { accion: 'aprobar' },
      });
      return aDto(aprobada);
    });
  }

  /** aprobada → pagada. Se vuelve a exigir PRL: es el momento del dinero. */
  async pagar(
    id: string,
    input: CertSubcontrataPagarInput,
    versionEsperada?: number,
  ): Promise<CertSubcontrataDto> {
    const { fechaPago } = certSubcontrataPagarSchema.parse(input);
    return this.dbs.db.transaction(async (tx) => {
      const { contrato, cert } = await this.bloquear(tx, id);
      verificarVersion(cert.version, versionEsperada);
      if (fechaPago < cert.fecha) {
        throw new UnprocessableEntityException(
          'La fecha de pago no puede ser anterior a la de la certificación',
        );
      }
      await this.exigirAptaPrl(contrato, 'pagar la certificación');
      const pagada = await cambiarEstado(
        tx,
        certificacionesSubcontrata,
        'cert_subcontrata',
        id,
        cert.status as CertSubcontrataStatus,
        'pagada',
        { fechaPago },
        versionEsperada,
      );
      await this.audit.registrar(tx, {
        entityType: 'cert_subcontrata',
        entityId: id,
        action: 'update',
        oldData: { status: cert.status },
        newData: { status: 'pagada', fechaPago },
        meta: { accion: 'pagar', importeLiquido: Number(cert.importeLiquido) },
      });
      return aDto(pagada);
    });
  }

  /**
   * borrador | aprobada → anulada. Una aprobada solo se anula si es la
   * ÚLTIMA vigente (las posteriores se calcularon sobre su a origen), si no
   * hay un borrador pendiente encima y si lo ya devuelto de garantía no
   * supera lo que quedaría retenido.
   */
  async anular(
    id: string,
    input: CertSubcontrataAnularInput,
    versionEsperada?: number,
  ): Promise<CertSubcontrataDto> {
    const { motivo } = certSubcontrataAnularSchema.parse(input);
    return this.dbs.db.transaction(async (tx) => {
      const { contrato, cert } = await this.bloquear(tx, id);
      verificarVersion(cert.version, versionEsperada);
      const de = cert.status as CertSubcontrataStatus;
      const resto = (await this.certsDelContrato(tx, cert.contratoId)).filter(
        (c) => c.id !== id,
      );
      if (de === 'aprobada') {
        if (
          resto.some((c) => c.numero > cert.numero && c.status !== 'anulada')
        ) {
          throw new ConflictException(
            'Solo se anula la última certificación del contrato: hay certificaciones posteriores',
          );
        }
        const quedaRetenido = resumenRetencionGarantia(
          resto
            .filter((c) =>
              esCertSubcontrataVigente(c.status as CertSubcontrataStatus),
            )
            .map((c) => Number(c.retencionImporte)),
          await this.devueltoDelContrato(tx, cert.contratoId),
        );
        if (quedaRetenido.pendiente < 0) {
          throw new ConflictException(
            'No se puede anular: ya se ha devuelto más garantía de la que quedaría retenida',
          );
        }
      }
      const anulada = await cambiarEstado(
        tx,
        certificacionesSubcontrata,
        'cert_subcontrata',
        id,
        de,
        'anulada',
        { anuladaAt: new Date(), motivoAnulacion: motivo },
        versionEsperada,
      );
      if (de === 'aprobada') {
        const origen = this.anteriorAOrigen(resto);
        const total = Number(contrato.importeTotal);
        await this.fijarEjecutado(
          tx,
          contrato,
          origen.toFixed(2),
          total > 0 ? Math.round((origen / total) * 10000) / 100 : 0,
        );
      }
      await this.audit.registrar(tx, {
        entityType: 'cert_subcontrata',
        entityId: id,
        action: 'update',
        oldData: { status: de },
        newData: { status: 'anulada' },
        meta: { accion: 'anular', motivo },
      });
      return aDto(anulada);
    });
  }

  /* ─────────────────────── garantía ─────────────────────── */

  async retenciones(contratoId: string): Promise<RetencionGarantiaDto> {
    const db = this.dbs.db;
    await this.contrato(db, contratoId);
    const certs = await this.certsDelContrato(db, contratoId);
    const devoluciones = await db
      .select()
      .from(devolucionesGarantiaSubcontrata)
      .where(
        and(
          eq(
            devolucionesGarantiaSubcontrata.companyId,
            this.dbs.getCompanyId(),
          ),
          eq(devolucionesGarantiaSubcontrata.contratoId, contratoId),
        ),
      )
      .orderBy(desc(devolucionesGarantiaSubcontrata.fecha));
    const saldo = resumenRetencionGarantia(
      certs
        .filter((c) =>
          esCertSubcontrataVigente(c.status as CertSubcontrataStatus),
        )
        .map((c) => Number(c.retencionImporte)),
      devoluciones.map((d) => Number(d.importe)),
    );
    return {
      contratoId,
      ...saldo,
      devoluciones: devoluciones.map((d): DevolucionGarantiaDto => ({
        id: d.id,
        contratoId: d.contratoId,
        fecha: d.fecha,
        importe: Number(d.importe),
        motivo: d.motivo,
        createdAt: d.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Devuelve (total o parcialmente) la garantía retenida. Solo con el
   * contrato completado: la garantía cubre la obra ya terminada.
   */
  async devolverGarantia(
    contratoId: string,
    input: DevolucionGarantiaCreateInput,
  ): Promise<RetencionGarantiaDto> {
    const data = devolucionGarantiaCreateSchema.parse(input);
    const { companyId, userId } = this.dbs.getContext();
    await this.dbs.db.transaction(async (tx) => {
      const contrato = await this.contrato(tx, contratoId, true);
      if (contrato.status !== 'completado') {
        throw new ConflictException(
          'La garantía solo se devuelve con el contrato de subcontrata completado',
        );
      }
      const certs = await this.certsDelContrato(tx, contratoId);
      const saldo = resumenRetencionGarantia(
        certs
          .filter((c) =>
            esCertSubcontrataVigente(c.status as CertSubcontrataStatus),
          )
          .map((c) => Number(c.retencionImporte)),
        await this.devueltoDelContrato(tx, contratoId),
      );
      const motivo = motivoDevolucionInvalida(data.importe, saldo.pendiente);
      if (motivo) throw new UnprocessableEntityException(motivo);
      const [devolucion] = await tx
        .insert(devolucionesGarantiaSubcontrata)
        .values({
          companyId,
          contratoId,
          fecha: data.fecha,
          importe: data.importe.toFixed(2),
          motivo: data.motivo,
          createdBy: userId,
        })
        .returning();
      await this.audit.registrar(tx, {
        entityType: 'devolucion_garantia',
        entityId: devolucion.id,
        action: 'create',
        newData: {
          contratoId,
          fecha: data.fecha,
          importe: data.importe,
          motivo: data.motivo,
        },
        meta: { pendienteAntes: saldo.pendiente },
      });
    });
    return this.retenciones(contratoId);
  }

  /* ─────────────────────── auxiliares ─────────────────────── */

  /** Contrato de la empresa (y de una obra accesible para el rol obra); 404 si no. */
  private async contrato(
    db: DbOrTx,
    id: string,
    paraActualizar = false,
  ): Promise<ContratoSubcontrata> {
    const consulta = db
      .select()
      .from(contratosSubcontrata)
      .where(
        and(
          eq(contratosSubcontrata.id, id),
          eq(contratosSubcontrata.companyId, this.dbs.getCompanyId()),
          isNull(contratosSubcontrata.deletedAt),
        ),
      );
    const [fila] = paraActualizar
      ? await consulta.for('update')
      : await consulta;
    const obras = fila ? await this.dbs.getObrasAccesibles() : null;
    if (!fila || (obras !== null && !obras.includes(fila.proyectoId))) {
      throw new NotFoundException('Contrato de subcontrata no encontrado');
    }
    return fila;
  }

  private async cert(
    db: DbOrTx,
    id: string,
    paraActualizar = false,
  ): Promise<CertificacionSubcontrata> {
    const consulta = db
      .select()
      .from(certificacionesSubcontrata)
      .where(
        and(
          eq(certificacionesSubcontrata.id, id),
          eq(certificacionesSubcontrata.companyId, this.dbs.getCompanyId()),
          isNull(certificacionesSubcontrata.deletedAt),
        ),
      );
    const [fila] = paraActualizar
      ? await consulta.for('update')
      : await consulta;
    if (!fila) throw new NotFoundException('Certificación no encontrada');
    return fila;
  }

  /** Orden de bloqueo fijo: contrato → certificación. */
  private async bloquear(tx: DbOrTx, id: string) {
    const previa = await this.cert(tx, id);
    const contrato = await this.contrato(tx, previa.contratoId, true);
    const cert = await this.cert(tx, id, true);
    return { contrato, cert };
  }

  private certsDelContrato(
    db: DbOrTx,
    contratoId: string,
  ): Promise<CertificacionSubcontrata[]> {
    return db
      .select()
      .from(certificacionesSubcontrata)
      .where(
        and(
          eq(certificacionesSubcontrata.companyId, this.dbs.getCompanyId()),
          eq(certificacionesSubcontrata.contratoId, contratoId),
          isNull(certificacionesSubcontrata.deletedAt),
        ),
      )
      .orderBy(asc(certificacionesSubcontrata.numero));
  }

  /** A origen de la última certificación vigente (0 si no hay ninguna). */
  private anteriorAOrigen(certs: CertificacionSubcontrata[]): number {
    const vigentes = certs
      .filter((c) =>
        CERT_SUBCONTRATA_VIGENTES.includes(c.status as CertSubcontrataStatus),
      )
      .sort((a, b) => b.numero - a.numero);
    return vigentes.length ? Number(vigentes[0].importeOrigen) : 0;
  }

  private async devueltoDelContrato(
    tx: DbOrTx,
    contratoId: string,
  ): Promise<number[]> {
    const filas = await tx
      .select({ importe: devolucionesGarantiaSubcontrata.importe })
      .from(devolucionesGarantiaSubcontrata)
      .where(
        and(
          eq(
            devolucionesGarantiaSubcontrata.companyId,
            this.dbs.getCompanyId(),
          ),
          eq(devolucionesGarantiaSubcontrata.contratoId, contratoId),
        ),
      );
    return filas.map((f) => Number(f.importe));
  }

  private async fijarEjecutado(
    tx: DbOrTx,
    contrato: ContratoSubcontrata,
    importeEjecutado: string,
    pctEjecutado: number,
  ): Promise<void> {
    await tx
      .update(contratosSubcontrata)
      .set({
        importeEjecutado,
        pctEjecutado: pctEjecutado.toFixed(2),
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(contratosSubcontrata.id, contrato.id),
          eq(contratosSubcontrata.companyId, contrato.companyId),
        ),
      );
  }

  private async exigirAptaPrl(
    contrato: ContratoSubcontrata,
    accion: string,
  ): Promise<void> {
    const { apto, razones } = await this.proveedores.validarAptoParaPago(
      contrato.proveedorId,
    );
    if (!apto) {
      throw new ConflictException(
        `No se puede ${accion}: la subcontrata no está apta por PRL. ${razones.join('; ')}.`,
      );
    }
  }
}
