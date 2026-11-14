import { UseInterceptors, applyDecorators } from '@nestjs/common';
import { IdempotenciaInterceptor } from './idempotencia.interceptor';

/**
 * Activa la idempotencia por cabecera `Idempotency-Key` en un endpoint POST.
 * Sin cabecera el endpoint se comporta exactamente igual que sin decorador.
 */
export const Idempotente = () =>
  applyDecorators(UseInterceptors(IdempotenciaInterceptor));
