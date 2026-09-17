/**
 * Buscador global v1 (Fase 15): un único cajón de búsqueda sobre documentos
 * y facturas, con tolerancia a errores tipográficos vía trigramas
 * (`pg_trgm`, ver `packages/db/src/schema.ts` y la migración
 * `0026_search_trgm.sql`) en vez de un `ILIKE '%term%'` literal. `pgvector`
 * (búsqueda semántica v2) queda diferido, tal y como pedía el Roadmap.
 */

export const SEARCH_RESULT_TYPES = ['documento', 'factura'] as const;
export type SearchResultType = (typeof SEARCH_RESULT_TYPES)[number];

export interface SearchResultDto {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string;
  /** Ruta relativa del frontend a la que navegar al pulsar el resultado. */
  link: string;
  /** 0-1, similitud de trigramas — no una probabilidad, solo sirve para ordenar. */
  score: number;
}

/** Longitud mínima antes de disparar la búsqueda — evita escanear con 1 letra. */
export const SEARCH_MIN_QUERY_LENGTH = 2;
