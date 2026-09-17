'use client';

/**
 * Buscador global (Fase 15): un único cajón para documentos y facturas,
 * tolerante a erratas vía trigramas (`GET /search`, `pg_trgm` en Postgres,
 * no un simple `ILIKE`). Sin resultados semánticos (pgvector) — eso queda
 * diferido, ver `Módulo Informes & Dashboard` en Obsidian.
 */

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SearchResultDto } from '@erp/shared';
import { searchApi } from '@/lib/api';
import { IconFileText, IconReceipt, IconSearch, IconX } from './icons';

const TYPE_ICON: Record<SearchResultDto['type'], typeof IconFileText> = {
  documento: IconFileText,
  factura: IconReceipt,
};

const TYPE_LABEL: Record<SearchResultDto['type'], string> = {
  documento: 'Documentos',
  factura: 'Facturas',
};

export function GlobalSearch() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [raw, setRaw] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setQuery(raw.trim()), 300);
    return () => clearTimeout(id);
  }, [raw]);

  const searchQuery = useQuery({
    queryKey: ['global-search', query],
    queryFn: () => searchApi.search(query),
    enabled: query.length >= 2,
    staleTime: 15_000,
  });

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const results = searchQuery.data ?? [];
  const grouped = results.reduce<Record<string, SearchResultDto[]>>(
    (acc, r) => {
      (acc[r.type] ??= []).push(r);
      return acc;
    },
    {},
  );

  const goTo = (result: SearchResultDto) => {
    setOpen(false);
    setRaw('');
    router.push(result.link);
  };

  return (
    <div ref={containerRef} className="fixed top-4 right-16 z-40 w-64">
      <div className="relative">
        <IconSearch
          size={14}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-gray-400"
        />
        <input
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar documentos, facturas…"
          className="w-full rounded-full border border-gray-200 bg-white py-2 pr-8 pl-9 text-sm shadow-sm transition focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
        />
        {raw && (
          <button
            onClick={() => {
              setRaw('');
              setOpen(false);
            }}
            className="absolute top-1/2 right-2.5 -translate-y-1/2 text-gray-400 hover:text-gray-700"
          >
            <IconX size={13} />
          </button>
        )}
      </div>

      {open && query.length >= 2 && (
        <div className="absolute top-11 right-0 max-h-96 w-80 overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-2xl">
          {searchQuery.isLoading && (
            <p className="px-4 py-6 text-center text-sm text-gray-400">
              Buscando…
            </p>
          )}
          {!searchQuery.isLoading && results.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-gray-400">
              Sin resultados para «{query}»
            </p>
          )}
          {Object.entries(grouped).map(([type, items]) => {
            const Icon = TYPE_ICON[type as SearchResultDto['type']];
            return (
              <div key={type}>
                <p className="border-b border-gray-50 bg-gray-50/60 px-4 py-1.5 text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
                  {TYPE_LABEL[type as SearchResultDto['type']]}
                </p>
                <ul className="divide-y divide-gray-50">
                  {items.map((r) => (
                    <li key={`${r.type}-${r.id}`}>
                      <button
                        onClick={() => goTo(r)}
                        className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left hover:bg-gray-50/40"
                      >
                        <Icon
                          size={15}
                          className="mt-0.5 shrink-0 text-gray-400"
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-gray-900">
                            {r.title}
                          </span>
                          <span className="block truncate text-xs text-gray-500">
                            {r.subtitle}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
