import { describe, expect, it } from 'vitest';
import {
  PAGE_SIZE_DEFAULT,
  ajustarPagina,
  paginasVisibles,
  rangoVisible,
  calcularOffset,
  construirPagina,
  esModoPaginado,
  normalizarPaginacion,
  paginacionQuerySchema,
  paginarLista,
  totalPaginas,
} from './paginacion';

describe('paginacion', () => {
  it('calcula el offset', () => {
    expect(calcularOffset(1, 25)).toBe(0);
    expect(calcularOffset(3, 25)).toBe(50);
    expect(calcularOffset(0, 25)).toBe(0);
  });

  it('calcula el total de páginas', () => {
    expect(totalPaginas(0, 25)).toBe(0);
    expect(totalPaginas(25, 25)).toBe(1);
    expect(totalPaginas(26, 25)).toBe(2);
  });

  it('construye la página sin alterar los items', () => {
    const items = [1, 2];
    const p = construirPagina(items, 5, 2, 2);
    expect(p).toEqual({
      items: [1, 2],
      total: 5,
      page: 2,
      pageSize: 2,
      totalPages: 3,
    });
    expect(p.items).toBe(items);
  });

  it('corta una lista y deja items vacíos fuera de rango', () => {
    const todas = [1, 2, 3, 4, 5];
    expect(paginarLista(todas, 1, 2).items).toEqual([1, 2]);
    expect(paginarLista(todas, 3, 2).items).toEqual([5]);
    const fuera = paginarLista(todas, 9, 2);
    expect(fuera.items).toEqual([]);
    expect(fuera.total).toBe(5);
  });

  it('normaliza y detecta el modo paginado', () => {
    expect(normalizarPaginacion({})).toEqual({
      page: 1,
      pageSize: PAGE_SIZE_DEFAULT,
    });
    expect(normalizarPaginacion({ page: 2, pageSize: 10 })).toEqual({
      page: 2,
      pageSize: 10,
    });
    expect(esModoPaginado({})).toBe(false);
    expect(esModoPaginado({ pageSize: 10 })).toBe(false);
    expect(esModoPaginado({ page: 1 })).toBe(true);
  });

  it('el esquema coacciona cadenas y rechaza valores inválidos', () => {
    expect(paginacionQuerySchema.parse({ page: '2', pageSize: '50' })).toEqual({
      page: 2,
      pageSize: 50,
    });
    expect(paginacionQuerySchema.parse({})).toEqual({});
    for (const mal of [
      { page: '0' },
      { page: '-1' },
      { page: '1.5' },
      { page: 'abc' },
      { pageSize: '0' },
      { pageSize: '101' },
    ]) {
      expect(paginacionQuerySchema.safeParse(mal).success).toBe(false);
    }
  });
});

describe('paginacion (vista)', () => {
  it('ajusta la página al rango válido', () => {
    expect(ajustarPagina(5, 30, 25)).toBe(2);
    expect(ajustarPagina(3, 0, 25)).toBe(1);
    expect(ajustarPagina(2, 30, 25)).toBe(2);
    expect(ajustarPagina(0, 30, 25)).toBe(1);
  });

  it('calcula el rango visible', () => {
    expect(rangoVisible(1, 25, 137)).toEqual({ desde: 1, hasta: 25 });
    expect(rangoVisible(6, 25, 137)).toEqual({ desde: 126, hasta: 137 });
    expect(rangoVisible(1, 25, 0)).toEqual({ desde: 0, hasta: 0 });
  });

  it('calcula las páginas visibles', () => {
    expect(paginasVisibles(1, 0)).toEqual([]);
    expect(paginasVisibles(1, 1)).toEqual([1]);
    expect(paginasVisibles(2, 3)).toEqual([1, 2, 3]);
    expect(paginasVisibles(1, 10)).toEqual([1, 2, 'elipsis', 10]);
    expect(paginasVisibles(5, 10)).toEqual([
      1,
      'elipsis',
      4,
      5,
      6,
      'elipsis',
      10,
    ]);
    expect(paginasVisibles(10, 10)).toEqual([1, 'elipsis', 9, 10]);
    expect(paginasVisibles(3, 10)).toEqual([1, 2, 3, 4, 'elipsis', 10]);
  });
});
