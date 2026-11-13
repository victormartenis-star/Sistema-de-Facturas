import { z } from 'zod';

/**
 * Paginación en servidor (opt-in): si la petición trae `page`, el listado
 * responde `PaginaDto<T>`; si no, el array de siempre. Funciones puras, sin
 * base de datos.
 */
export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 100;

/** Parámetros de query de un listado paginado. Ambos opcionales. */
export const paginacionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).optional(),
});
export type PaginacionQuery = z.infer<typeof paginacionQuerySchema>;

export interface PaginaDto<T> {
  items: T[];
  /** Filas que cumplen el filtro (no las de la página). */
  total: number;
  page: number;
  pageSize: number;
  /** 0 si `total` = 0. */
  totalPages: number;
}

/** Página y tamaño efectivos (con los valores por defecto aplicados). */
export function normalizarPaginacion(query: PaginacionQuery): {
  page: number;
  pageSize: number;
} {
  return {
    page: query.page ?? 1,
    pageSize: query.pageSize ?? PAGE_SIZE_DEFAULT,
  };
}

/** `true` si la petición pide respuesta paginada (trae `page`). */
export function esModoPaginado(query: PaginacionQuery): boolean {
  return query.page !== undefined;
}

export function calcularOffset(page: number, pageSize: number): number {
  return (Math.max(1, page) - 1) * pageSize;
}

export function totalPaginas(total: number, pageSize: number): number {
  if (total <= 0 || pageSize <= 0) return 0;
  return Math.ceil(total / pageSize);
}

/** Arma la respuesta paginada a partir de las filas ya cortadas. */
export function construirPagina<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): PaginaDto<T> {
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: totalPaginas(total, pageSize),
  };
}

/** Corta un array en memoria (para pruebas y listas ya cargadas). */
export function paginarLista<T>(
  todas: readonly T[],
  page: number,
  pageSize: number,
): PaginaDto<T> {
  const offset = calcularOffset(page, pageSize);
  return construirPagina(
    todas.slice(offset, offset + pageSize),
    todas.length,
    page,
    pageSize,
  );
}

/** Recorta la página al rango válido (p. ej. tras borrar la última fila de la última página). */
export function ajustarPagina(
  page: number,
  total: number,
  pageSize: number,
): number {
  const ultima = Math.max(1, totalPaginas(total, pageSize));
  return Math.min(Math.max(1, page), ultima);
}

/** Rango mostrado ("26–50 de 137"); sin filas devuelve 0–0. */
export function rangoVisible(
  page: number,
  pageSize: number,
  total: number,
): { desde: number; hasta: number } {
  if (total <= 0) return { desde: 0, hasta: 0 };
  const desde = calcularOffset(page, pageSize) + 1;
  return { desde, hasta: Math.min(total, desde + pageSize - 1) };
}

/** Números de página a pintar, con `'elipsis'` en los huecos. */
export function paginasVisibles(
  page: number,
  totalPages: number,
  vecinos = 1,
): (number | 'elipsis')[] {
  if (totalPages <= 0) return [];
  const conjunto = new Set<number>([1, totalPages]);
  for (let p = page - vecinos; p <= page + vecinos; p++) {
    if (p >= 1 && p <= totalPages) conjunto.add(p);
  }
  const orden = [...conjunto].sort((a, b) => a - b);
  const salida: (number | 'elipsis')[] = [];
  orden.forEach((p, i) => {
    const previo = orden[i - 1];
    if (previo !== undefined && p - previo > 1) {
      // Un hueco de una sola página se pinta como número, no como elipsis.
      salida.push(p - previo === 2 ? p - 1 : 'elipsis');
    }
    salida.push(p);
  });
  return salida;
}
