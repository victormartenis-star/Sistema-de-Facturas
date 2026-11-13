import { ApiError } from '@/lib/api';

export interface ErrorMostrable {
  titulo: string;
  detalle: string;
  reintentable: boolean;
}

/** Texto corto de un error cualquiera (para toasts y formularios). */
export function textoDeError(e: unknown): string {
  return e instanceof Error ? e.message : 'Error inesperado';
}

/** Traduce un error de carga a título, detalle y si tiene sentido reintentar. */
export function mensajeDeError(e: unknown): ErrorMostrable {
  if (e instanceof ApiError) {
    if (e.status >= 500) {
      return {
        titulo: 'El servidor ha fallado',
        detalle: e.message,
        reintentable: true,
      };
    }
    if (e.status === 403) {
      return {
        titulo: 'No tienes permiso para ver esto',
        detalle: e.message,
        reintentable: false,
      };
    }
    if (e.status === 404) {
      return {
        titulo: 'No encontrado',
        detalle: e.message,
        reintentable: false,
      };
    }
    return { titulo: e.message, detalle: '', reintentable: false };
  }
  if (e instanceof TypeError) {
    return {
      titulo: 'No se pudo conectar con el servidor',
      detalle: 'Comprueba tu conexión y que la API esté en marcha.',
      reintentable: true,
    };
  }
  return { titulo: textoDeError(e), detalle: '', reintentable: true };
}
