import { Body, Controller, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CopilotoService, type CopilotoMessage } from './copiloto.service';
import type { Request } from 'express';

const querySchema = z.object({
  question: z.string().trim().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      }),
    )
    .max(20)
    .default([]),
});

@Controller('copiloto')
export class CopilotoController {
  constructor(private readonly service: CopilotoService) {}

  /**
   * Consulta en lenguaje natural sobre el ERP.
   * El copiloto usa las herramientas disponibles (dashboard, obras, certs…)
   * para responder de forma contextualizada.
   */
  @Post('query')
  async query(
    @Body(new ZodValidationPipe(querySchema))
    body: { question: string; history: CopilotoMessage[] },
    @Req() req: Request,
  ) {
    // Extraer el access token del header Authorization para que el
    // copiloto pueda llamar a la API en nombre del usuario autenticado.
    const authHeader = req.headers['authorization'] ?? '';
    const accessToken = authHeader.replace(/^Bearer\s+/i, '');

    return this.service.query(body.question, body.history, accessToken);
  }
}
