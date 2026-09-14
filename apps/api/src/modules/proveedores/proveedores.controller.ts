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
  ContratoSubcontrataCreateInput,
  ContratoSubcontrataUpdateInput,
  DocumentoPRLUploadInput,
  ProveedorCreateInput,
  ProveedorUpdateInput,
  contratoSubcontrataCreateSchema,
  contratoSubcontrataUpdateSchema,
  documentoPRLUploadSchema,
  proveedorCreateSchema,
  proveedorUpdateSchema,
} from '@erp/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ProveedoresService } from './proveedores.service';

@Controller('proveedores')
export class ProveedoresController {
  constructor(private readonly service: ProveedoresService) {}

  /** Lista proveedores con filtro opcional por activo/inactivo. */
  @Get()
  list(@Query('activo') activo?: string) {
    return this.service.list(
      activo === undefined ? undefined : activo === 'true',
    );
  }

  /** Obtiene un proveedor por ID. */
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  /** Crea un nuevo proveedor o subcontrata. */
  @Post()
  create(
    @Body(new ZodValidationPipe(proveedorCreateSchema))
    body: ProveedorCreateInput,
  ) {
    return this.service.create(body);
  }

  /** Actualiza datos del proveedor. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(proveedorUpdateSchema))
    body: ProveedorUpdateInput,
  ) {
    return this.service.update(id, body);
  }

  /** Elimina lógicamente un proveedor (si no tiene contratos activos). */
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }

  /** Lista los contratos de subcontrata del proveedor. */
  @Get(':id/contratos')
  listContratos(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.listContratosProveedor(id);
  }

  /** Crea un contrato de subcontrata para el proveedor. */
  @Post(':id/contratos')
  createContrato(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(contratoSubcontrataCreateSchema))
    body: ContratoSubcontrataCreateInput,
  ) {
    return this.service.createContrato(id, body);
  }

  /** Actualiza un contrato de subcontrata. */
  @Patch('contratos/:contratoId')
  updateContrato(
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
    @Body(new ZodValidationPipe(contratoSubcontrataUpdateSchema))
    body: ContratoSubcontrataUpdateInput,
  ) {
    return this.service.updateContrato(contratoId, body);
  }

  /** Lista la documentación PRL del proveedor. */
  @Get(':id/documentos-prl')
  listDocumentosPRL(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.listDocumentosPRL(id);
  }

  /** Sube documentación PRL para un proveedor. */
  @Post(':id/documentos-prl')
  uploadDocumentoPRL(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(documentoPRLUploadSchema))
    body: DocumentoPRLUploadInput,
  ) {
    return this.service.uploadDocumentoPRL(id, body);
  }

  /** Valida si el proveedor está apto para recibir pagos. */
  @Get(':id/validar-pago')
  validarAptoParaPago(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.validarAptoParaPago(id);
  }
}
