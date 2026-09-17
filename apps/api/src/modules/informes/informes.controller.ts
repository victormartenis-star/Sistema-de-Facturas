import { Body, Controller, Post, Query } from '@nestjs/common';
import {
  InformeEmailInput,
  InformeMensualQuery,
  informeEmailSchema,
  informeMensualQuerySchema,
} from '@erp/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { EmailService } from '../../alerts/email.service';
import { InformesService } from './informes.service';

@Controller('informes')
export class InformesController {
  constructor(
    private readonly service: InformesService,
    private readonly email: EmailService,
  ) {}

  /**
   * Informe mensual redactado por IA. `POST`, no `GET`, porque cada llamada
   * es una generación bajo demanda (una llamada a Claude, coste real) — no
   * un dato que tenga sentido cachear ni al que apunte un enlace.
   */
  @Post('mensual')
  generar(
    @Query(new ZodValidationPipe(informeMensualQuerySchema))
    query: InformeMensualQuery,
  ) {
    return this.service.generarMensual(query.mes, query.projectId);
  }

  /**
   * Envía por email un informe ya generado — recibe el markdown ya
   * redactado (no vuelve a llamar a Claude) para no gastar una segunda
   * generación solo por reenviar el mismo texto.
   */
  @Post('mensual/email')
  async enviarEmail(
    @Body(new ZodValidationPipe(informeEmailSchema)) body: InformeEmailInput,
  ) {
    const sent = await this.email.send({
      to: body.to,
      subject: `Informe mensual ${body.mes}`,
      body: body.markdown,
    });
    return { sent };
  }
}
