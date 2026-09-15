import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Body,
} from '@nestjs/common';
import {
  AccessTokenPayload,
  ContractAuditRequestInput,
  contractAuditRequestSchema,
} from '@erp/shared';
import { CurrentUser, Roles } from '../../auth/roles';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ContractAiService } from './contract-ai.service';

@Controller('contract-ai')
export class ContractAiController {
  constructor(private readonly service: ContractAiService) {}

  @Post('auditar')
  @Roles('admin', 'gerente', 'administracion')
  auditar(
    @Body(new ZodValidationPipe(contractAuditRequestSchema))
    body: ContractAuditRequestInput,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.service.auditar(body, user.sub);
  }

  @Get('auditorias')
  @Roles('admin', 'gerente', 'administracion')
  list(
    @Query('projectId', new ParseUUIDPipe({ optional: true }))
    projectId?: string,
  ) {
    return this.service.list(projectId);
  }

  @Get('auditorias/:id')
  @Roles('admin', 'gerente', 'administracion')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }
}
