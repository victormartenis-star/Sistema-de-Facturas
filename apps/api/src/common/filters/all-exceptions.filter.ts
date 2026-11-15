import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  CODIGO_POR_ESTADO,
  ErrorCampo,
  MENSAJE_CONFLICTO_VERSION,
  MENSAJE_ERROR_INTERNO,
  ProblemDetails,
  TITULO_POR_CODIGO,
  TransicionInvalidaError,
} from '@erp/shared';
import { logger } from '../logging/logger';
import { getCorrelationId } from '../request-context';

const RESERVADOS = new Set([
  'type',
  'title',
  'status',
  'detail',
  'instance',
  'errorCode',
  'correlationId',
  'timestamp',
]);

interface Normalizado {
  status: number;
  errorCode: string;
  detail: string;
  errors: ErrorCampo[];
  extras: Record<string, unknown>;
  interno: boolean;
}

function esZodError(
  e: unknown,
): e is { issues: { path: (string | number)[]; message: string }[] } {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { name?: unknown }).name === 'ZodError' &&
    Array.isArray((e as { issues?: unknown }).issues)
  );
}

function normalizar(exception: unknown): Normalizado {
  if (exception instanceof TransicionInvalidaError) {
    return {
      status: 409,
      errorCode: 'INVALID_TRANSITION',
      detail: exception.message,
      errors: [],
      extras: { error: 'Conflict' },
      interno: false,
    };
  }
  if (esZodError(exception)) {
    return {
      status: 400,
      errorCode: 'VALIDATION_ERROR',
      detail: 'Datos no válidos',
      errors: exception.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      })),
      extras: {},
      interno: false,
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const resp = exception.getResponse();
    const cuerpo: Record<string, unknown> =
      typeof resp === 'string'
        ? { message: resp }
        : { ...(resp as Record<string, unknown>) };
    const code =
      typeof cuerpo.code === 'string'
        ? cuerpo.code
        : (CODIGO_POR_ESTADO[status] ?? `HTTP_${status}`);
    let errors: ErrorCampo[] = Array.isArray(cuerpo.errors)
      ? (cuerpo.errors as ErrorCampo[])
      : [];
    let detail: string;
    let errorCode = code;
    if (Array.isArray(cuerpo.message)) {
      // class-validator: message: string[]
      const msgs = cuerpo.message.map(String);
      errors = msgs.map((message) => ({ field: '', message }));
      detail = msgs.join('; ');
      if (typeof cuerpo.code !== 'string' && status === 400) {
        errorCode = 'VALIDATION_ERROR';
      }
    } else if (typeof cuerpo.message === 'string') {
      detail = cuerpo.message;
    } else if (code === 'VERSION_CONFLICT') {
      detail = MENSAJE_CONFLICTO_VERSION;
    } else {
      detail = TITULO_POR_CODIGO[code] ?? exception.message;
    }
    if (
      typeof cuerpo.code !== 'string' &&
      status === 400 &&
      errors.length > 0
    ) {
      errorCode = 'VALIDATION_ERROR';
    }
    delete cuerpo.message;
    delete cuerpo.errors;
    return {
      status,
      errorCode,
      detail,
      errors,
      extras: cuerpo,
      interno: false,
    };
  }
  // Errores de middleware de Express (body-parser: 413, JSON mal formado).
  const e = exception as {
    status?: unknown;
    expose?: unknown;
    message?: unknown;
  };
  if (
    typeof e?.status === 'number' &&
    e.status >= 400 &&
    e.status < 500 &&
    e.expose === true
  ) {
    return {
      status: e.status,
      errorCode: CODIGO_POR_ESTADO[e.status] ?? `HTTP_${e.status}`,
      detail: String(e.message),
      errors: [],
      extras: {},
      interno: false,
    };
  }
  return {
    status: 500,
    errorCode: 'INTERNAL_ERROR',
    detail: MENSAJE_ERROR_INTERNO,
    errors: [],
    extras: {},
    interno: true,
  };
}

/**
 * ÚNICO filtro global. Todas las respuestas de error salen como
 * `application/problem+json` (RFC 7807) con `correlationId`, y conservan los
 * miembros de compatibilidad (`message`, `code`, `statusCode`, `errors`,
 * `versionActual`…) que consumen los clientes actuales.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { id?: string }>();
    const res = http.getResponse<Response>();
    const n = normalizar(exception);
    const correlationId =
      req.id ??
      (res.getHeader('x-request-id') as string | undefined) ??
      getCorrelationId();
    const instance = (req.originalUrl ?? req.url ?? '').split('?')[0];

    const log = {
      correlationId,
      status: n.status,
      errorCode: n.errorCode,
      method: req.method,
      instance,
    };
    if (n.interno || n.status >= 500) {
      logger.error({ ...log, err: exception }, 'http.error');
    } else {
      logger.warn(log, 'http.error');
    }

    if (res.headersSent) {
      // Streaming ya iniciado (SSE): no se puede reescribir la respuesta.
      res.end();
      return;
    }

    const extras = Object.fromEntries(
      Object.entries(n.extras).filter(([k]) => !RESERVADOS.has(k)),
    );
    const cuerpo: ProblemDetails = {
      ...extras,
      type: `https://erp-dintel/errores/${n.errorCode}`,
      title:
        TITULO_POR_CODIGO[n.errorCode] ??
        TITULO_POR_CODIGO[CODIGO_POR_ESTADO[n.status] ?? ''] ??
        'Error',
      status: n.status,
      detail: n.detail,
      instance,
      errorCode: n.errorCode,
      correlationId: correlationId ?? null,
      timestamp: new Date().toISOString(),
      errors: n.errors,
      message: n.detail,
      code: n.errorCode,
      statusCode: n.status,
    };
    res.setHeader('Content-Type', 'application/problem+json; charset=utf-8');
    res.status(n.status).send(JSON.stringify(cuerpo));
  }
}
