/**
 * Lógica pura para las métricas Prometheus de `apps/api` (Fase 8): cómo se
 * etiqueta y agrupa lo que se registra, sin `prom-client`, sin Nest y sin
 * Node — así se prueba con datos de mentira, sin levantar la API. El glue
 * real (interceptor, histograma, `pool.query` instrumentado) vive en
 * `apps/api/src/metrics/` y `packages/db/src/index.ts`.
 */

const UNMATCHED_ROUTE = 'sin_ruta';
const ANONYMOUS_ROLE = 'anonimo';
const UNKNOWN_SQL_OPERATION = 'desconocida';

/**
 * Etiquetas de `http_requests_total` y `http_request_duration_seconds`.
 * Lleva `[key: string]: string` además de los 4 campos nombrados: sin eso,
 * `Counter<string>#inc()`/`Histogram<string>#observe()` de `prom-client`
 * (que piden `Partial<Record<string, string | number>>`) rechazan pasarle
 * una variable de este tipo — una interfaz sin firma de índice no es
 * asignable a `Record<string, X>` aunque todas sus propiedades lo sean.
 * Descubierto con `apps/api`'s `test:integration:coverage`: force-compila
 * todos los ficheros de `src/` (`collectCoverageFrom`), incluso los que
 * ningún test importa, así que lo hizo saltar aunque `tsc --noEmit` normal
 * (que solo comprueba lo que la app real importa) nunca lo había pillado.
 */
export interface HttpRequestMetricLabels {
  method: string;
  /** Patrón de ruta de Express (`/invoices/:id`), nunca la URL resuelta. */
  route: string;
  status_code: string;
  role: string;
  [key: string]: string;
}

/**
 * Construye las etiquetas de una petición HTTP completada. `routePattern`
 * es el patrón registrado en Express (`req.route?.path`), nunca la URL ya
 * resuelta (`/invoices/123`) — así el número de series de tiempo no crece
 * con cada ID que pasa por la API. Cuando Express no llegó a resolver una
 * ruta (404 antes de enrutar, error muy temprano) se usa `"sin_ruta"` por
 * el mismo motivo: la URL cruda tendría la misma cardinalidad sin límite.
 * `role` es `"anonimo"` en rutas `@Public()` o si el usuario no llegó a
 * autenticarse.
 */
export function buildHttpRequestLabels(input: {
  method: string;
  routePattern: string | null | undefined;
  statusCode: number;
  role: string | null | undefined;
}): HttpRequestMetricLabels {
  const trimmedRoute = input.routePattern?.trim();
  return {
    method: input.method,
    route: trimmedRoute ? trimmedRoute : UNMATCHED_ROUTE,
    status_code: String(input.statusCode),
    role: input.role ?? ANONYMOUS_ROLE,
  };
}

/**
 * Primera palabra de una sentencia SQL, en mayúsculas (`SELECT`, `INSERT`,
 * `WITH`…), para etiquetar `db_queries_duration_seconds` sin la
 * cardinalidad de la consulta completa (que llevaría IDs, filtros...).
 * `"desconocida"` si no hay ninguna palabra reconocible al principio.
 */
export function extractSqlOperation(sql: string | null | undefined): string {
  const match = /^\s*([A-Za-z]+)/.exec(sql ?? '');
  return match ? match[1].toUpperCase() : UNKNOWN_SQL_OPERATION;
}
