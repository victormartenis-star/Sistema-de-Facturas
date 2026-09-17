import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CopilotoService, type CopilotoMessage } from './copiloto.service';
import type { Request, Response } from 'express';

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

  /**
   * Igual que `query()` pero como Server-Sent Events: el texto llega según
   * el modelo lo genera, en vez de esperar a la respuesta completa. `@Res()`
   * directo (no el flujo normal de Nest, que espera un valor de retorno
   * serializable) porque una respuesta SSE se escribe de forma incremental
   * con `res.write()` y se cierra explícitamente con `res.end()`.
   */
  @Post('query/stream')
  async queryStream(
    @Body(new ZodValidationPipe(querySchema))
    body: { question: string; history: CopilotoMessage[] },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const authHeader = req.headers['authorization'] ?? '';
    const accessToken = authHeader.replace(/^Bearer\s+/i, '');

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    await this.service.queryStream(
      body.question,
      body.history,
      accessToken,
      (event) => res.write(`data: ${JSON.stringify(event)}\n\n`),
    );

    res.end();
  }
}
