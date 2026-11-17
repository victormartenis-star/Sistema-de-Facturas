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
  Query,
} from '@nestjs/common';
import {
  type CertSubcontrataAnularInput,
  type CertSubcontrataCreateInput,
  type CertSubcontrataFacturarInput,
  type CertSubcontrataPagarInput,
  type CertSubcontrataUpdateInput,
  type ContratosSubcontrataQuery,
  type DevolucionGarantiaCreateInput,
  certSubcontrataAnularSchema,
  certSubcontrataCreateSchema,
  certSubcontrataFacturarSchema,
  certSubcontrataPagarSchema,
  certSubcontrataUpdateSchema,
  contratosSubcontrataQuerySchema,
  devolucionGarantiaCreateSchema,
} from '@erp/shared';
import { Roles } from '../../auth/roles';
import { Idempotente } from '../../common/idempotencia/idempotente.decorator';
import { VersionEsperada } from '../../common/version';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { SubcontratasService } from './subcontratas.service';

/** Mide la producción (borradores): también el jefe de obra. */
const ROLES_MEDICION = ['admin', 'gerente', 'administracion', 'obra'] as const;
/** Compromete dinero (aprobar, pagar, anular, devolver garantía). */
const ROLES_FINANZAS = ['admin', 'gerente', 'administracion'] as const;

/**
 * Certificaciones de subcontrata y retención de garantía.
 * Lecturas: cualquier rol interno (el rol obra, solo sus obras).
 */
@Controller('subcontratas')
export class SubcontratasController {
  constructor(private readonly service: SubcontratasService) {}

  @Get('contratos')
  listContratos(
    @Query(new ZodValidationPipe(contratosSubcontrataQuerySchema))
    query: ContratosSubcontrataQuery,
  ) {
    return this.service.listContratos(query);
  }

  @Get('contratos/:contratoId/certificaciones')
  listCertificaciones(@Param('contratoId', ParseUUIDPipe) contratoId: string) {
    return this.service.listCertificaciones(contratoId);
  }

  @Post('contratos/:contratoId/certificaciones')
  @Roles(...ROLES_MEDICION)
  @Idempotente()
  create(
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
    @Body(new ZodValidationPipe(certSubcontrataCreateSchema))
    body: CertSubcontrataCreateInput,
  ) {
    return this.service.create(contratoId, body);
  }

  @Get('contratos/:contratoId/retenciones')
  retenciones(@Param('contratoId', ParseUUIDPipe) contratoId: string) {
    return this.service.retenciones(contratoId);
  }

  @Post('contratos/:contratoId/devoluciones-garantia')
  @Roles(...ROLES_FINANZAS)
  @Idempotente()
  devolverGarantia(
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
    @Body(new ZodValidationPipe(devolucionGarantiaCreateSchema))
    body: DevolucionGarantiaCreateInput,
  ) {
    return this.service.devolverGarantia(contratoId, body);
  }

  @Get('certificaciones/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getCertificacion(id);
  }

  @Patch('certificaciones/:id')
  @Roles(...ROLES_MEDICION)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(certSubcontrataUpdateSchema))
    body: CertSubcontrataUpdateInput,
    @VersionEsperada({ exigible: true }) version?: number,
  ) {
    return this.service.update(id, body, version);
  }

  @Delete('certificaciones/:id')
  @Roles(...ROLES_MEDICION)
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @VersionEsperada({ exigible: true }) version?: number,
  ) {
    await this.service.remove(id, version);
  }

  @Post('certificaciones/:id/aprobar')
  @Roles(...ROLES_FINANZAS)
  aprobar(
    @Param('id', ParseUUIDPipe) id: string,
    @VersionEsperada() version?: number,
  ) {
    return this.service.aprobar(id, version);
  }

  @Post('certificaciones/:id/pagar')
  @Roles(...ROLES_FINANZAS)
  pagar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(certSubcontrataPagarSchema))
    body: CertSubcontrataPagarInput,
    @VersionEsperada() version?: number,
  ) {
    return this.service.pagar(id, body, version);
  }

  /**
   * Genera y aprueba la factura de compra del subcontratista desde una
   * certificación aprobada o pagada. If-Match opcional (versión de la
   * certificación); Idempotency-Key para reintentos seguros.
   */
  @Post('certificaciones/:id/factura-compra')
  @Roles(...ROLES_FINANZAS)
  @Idempotente()
  facturar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(certSubcontrataFacturarSchema))
    body: CertSubcontrataFacturarInput,
    @VersionEsperada() version?: number,
  ) {
    return this.service.facturar(id, body, version);
  }

  @Post('certificaciones/:id/anular')
  @Roles(...ROLES_FINANZAS)
  anular(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(certSubcontrataAnularSchema))
    body: CertSubcontrataAnularInput,
    @VersionEsperada() version?: number,
  ) {
    return this.service.anular(id, body, version);
  }
}
