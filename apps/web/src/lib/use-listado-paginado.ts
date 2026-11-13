'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PAGE_SIZE_DEFAULT, ajustarPagina, type PaginaDto } from '@erp/shared';
import { useDebouncedValue } from '@/lib/hooks';

export interface OpcionesListado<T, F extends Record<string, string>> {
  /** Prefijo de la queryKey ('invoices'…): las invalidaciones por prefijo siguen valiendo. */
  clave: string;
  filtrosIniciales: F;
  consulta: (
    p: F & { page: number; pageSize: number },
  ) => Promise<PaginaDto<T>>;
  /** Por ejemplo, exigir obra en presupuestos. */
  habilitada?: (filtros: F) => boolean;
  /** Campos de texto cuya petición se retarda (búsqueda). */
  camposConRetardo?: (keyof F)[];
  pageSizeInicial?: number;
}

/** Estado de un listado paginado en servidor con filtros. */
export function useListadoPaginado<T, F extends Record<string, string>>(
  opts: OpcionesListado<T, F>,
) {
  const { clave, filtrosIniciales, consulta, habilitada, camposConRetardo } =
    opts;
  const [filtros, setFiltros] = useState<F>(filtrosIniciales);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(
    opts.pageSizeInicial ?? PAGE_SIZE_DEFAULT,
  );

  // Los campos con retardo se envían ya asentados; el resto, al instante.
  const retardados = JSON.stringify(
    (camposConRetardo ?? []).map((k) => filtros[k]),
  );
  const retardadosAsentados = useDebouncedValue(retardados);
  const filtrosEfectivos = useMemo(() => {
    const efectivos = { ...filtros };
    const valores = JSON.parse(retardadosAsentados) as string[];
    (camposConRetardo ?? []).forEach((k, i) => {
      efectivos[k] = valores[i] as F[keyof F];
    });
    return efectivos;
  }, [filtros, retardadosAsentados]);

  const activa = habilitada ? habilitada(filtrosEfectivos) : true;
  const query = useQuery({
    queryKey: [clave, filtrosEfectivos, page, pageSize],
    queryFn: () => consulta({ ...filtrosEfectivos, page, pageSize }),
    enabled: activa,
    placeholderData: keepPreviousData,
  });

  // Si tras borrar la página queda fuera de rango, se recorta.
  useEffect(() => {
    if (!query.data || query.isPlaceholderData) return;
    const ajustada = ajustarPagina(page, query.data.total, pageSize);
    if (ajustada !== page) setPage(ajustada);
  }, [query.data, query.isPlaceholderData, page, pageSize]);

  const setFiltro = useCallback(<K extends keyof F>(k: K, v: F[K]) => {
    setFiltros((f) => ({ ...f, [k]: v }));
    setPage(1);
  }, []);
  const limpiarFiltros = useCallback(() => {
    setFiltros(filtrosIniciales);
    setPage(1);
  }, []);
  const setPageSize = useCallback((n: number) => {
    setPageSizeState(n);
    setPage(1);
  }, []);

  const hayFiltros = (Object.keys(filtros) as (keyof F)[]).some(
    (k) => filtros[k] !== filtrosIniciales[k],
  );

  return {
    filas: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    page,
    pageSize,
    filtros,
    setFiltro,
    limpiarFiltros,
    setPage,
    setPageSize,
    cargando: query.isLoading,
    actualizando: query.isFetching && !query.isLoading,
    error: query.error,
    reintentar: () => void query.refetch(),
    hayFiltros,
  };
}
