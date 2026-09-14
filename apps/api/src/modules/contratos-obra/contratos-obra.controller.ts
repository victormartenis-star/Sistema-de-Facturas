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
  ContratoObraAnexoCreateInput,
  ContratoObraCreateInput,
  ContratoObraEstadoFirma,
  ContratoObraUpdateInput,
  contratoObraAnexoCreateSchema,
  contratoObraCreateSchema,
  contratoObraUpdateSchema,
} from '@erp/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ContratosObraService } from './contratos-obra.service';

@Controller('contratos-obra')
export class ContratosObraController {
  constructor(private readonly service: ContratosObraService) {}

  @Get()
  list(
    @Query('projectId') projectId?: string,
    @Query('estadoFirma') estadoFirma?: ContratoObraEstadoFirma,
  ) {
    return this.service.list(projectId, estadoFirma);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(contratoObraCreateSchema))
    body: ContratoObraCreateInput,
  ) {
    return this.service.create(body);
  }

  /** Actualiza el contrato; pasar `estadoFirma: 'firmado'` valida PDF + fecha + CAE. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(contratoObraUpdateSchema))
    body: ContratoObraUpdateInput,
  ) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }

  @Get(':id/anexos')
  listAnexos(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.listAnexos(id);
  }

  @Post(':id/anexos')
  addAnexo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(contratoObraAnexoCreateSchema))
    body: ContratoObraAnexoCreateInput,
  ) {
    return this.service.addAnexo(id, body);
  }

  /** Ficha de homologación CAE del contacto ligado al contrato. */
  @Get(':id/cae')
  validarDocumentacionCAE(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.validarDocumentacionCAE(id);
  }
}
