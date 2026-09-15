import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  SignatureRequestCreateInput,
  SignerFirmarInput,
  SignerRechazarInput,
  signatureRequestCreateSchema,
  signerFirmarSchema,
  signerRechazarSchema,
} from '@erp/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ESignatureService } from './e-signature.service';

@Controller('e-signature')
export class ESignatureController {
  constructor(private readonly service: ESignatureService) {}

  @Get('requests')
  list(
    @Query('projectId') projectId?: string,
    @Query('entityTipo') entityTipo?: string,
    @Query('estado') estado?: string,
  ) {
    return this.service.list({ projectId, entityTipo, estado });
  }

  @Get('requests/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Post('requests')
  create(
    @Body(new ZodValidationPipe(signatureRequestCreateSchema))
    body: SignatureRequestCreateInput,
  ) {
    return this.service.create(body);
  }

  @Patch('requests/:id/cancelar')
  cancelar(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.cancelar(id);
  }

  @Post('requests/:id/firmantes/:signerId/firmar')
  firmar(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('signerId', ParseUUIDPipe) signerId: string,
    @Body(new ZodValidationPipe(signerFirmarSchema)) body: SignerFirmarInput,
    @Req() req: Request,
  ) {
    return this.service.firmar(id, signerId, body, req.ip ?? null);
  }

  @Post('requests/:id/firmantes/:signerId/rechazar')
  rechazar(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('signerId', ParseUUIDPipe) signerId: string,
    @Body(new ZodValidationPipe(signerRechazarSchema))
    body: SignerRechazarInput,
  ) {
    return this.service.rechazar(id, signerId, body);
  }
}
