import { describe, expect, it } from 'vitest';
import { toCsv, toExportJson, type ExportColumn } from './exportacion';

interface Fila {
  nombre: string | null;
  importe: string | number | null;
  activo: boolean;
  fecha: string | null;
}

const columnas: ExportColumn<Fila>[] = [
  { key: 'nombre', header: 'Nombre', type: 'texto', value: (r) => r.nombre },
  {
    key: 'importe',
    header: 'Importe',
    type: 'importe',
    value: (r) => r.importe,
  },
  { key: 'activo', header: 'Activo', type: 'booleano', value: (r) => r.activo },
  { key: 'fecha', header: 'Fecha', type: 'fecha', value: (r) => r.fecha },
];

const fila = (p: Partial<Fila> = {}): Fila => ({
  nombre: 'Ana',
  importe: '10.5',
  activo: true,
  fecha: '2026-01-31',
  ...p,
});

describe('toCsv', () => {
  it('empieza con BOM UTF-8, usa ; y CRLF, y cabecera + filas', () => {
    const csv = toCsv(columnas, [fila()]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.slice(1)).toBe(
      'Nombre;Importe;Activo;Fecha\r\nAna;10.50;sí;2026-01-31\r\n',
    );
  });

  it('sin BOM cuando se pide', () => {
    expect(toCsv(columnas, [], { bom: false })).toBe(
      'Nombre;Importe;Activo;Fecha\r\n',
    );
  });

  it('escapa comillas, separador y saltos de línea', () => {
    const csv = toCsv(columnas, [fila({ nombre: 'Dijo "hola"; adiós\nfin' })], {
      bom: false,
    });
    expect(csv).toContain('"Dijo ""hola""; adiós\nfin"');
  });

  it('con separador coma, el punto y coma ya no obliga a entrecomillar', () => {
    const csv = toCsv(columnas, [fila({ nombre: 'a;b' })], {
      bom: false,
      separador: ',',
    });
    expect(csv).toContain('a;b,10.50');
  });

  it('coma decimal opcional en importes', () => {
    const csv = toCsv(columnas, [fila({ importe: '1234.5' })], {
      bom: false,
      decimal: 'coma',
    });
    expect(csv).toContain(';1234,50;');
  });

  it('null sale vacío', () => {
    const csv = toCsv(
      columnas,
      [fila({ nombre: null, importe: null, fecha: null })],
      {
        bom: false,
      },
    );
    expect(csv.split('\r\n')[1]).toBe(';;sí;');
  });

  it('neutraliza fórmulas en texto pero no toca importes negativos', () => {
    const csv = toCsv(
      columnas,
      [fila({ nombre: '=SUM(A1)', importe: '-20.10' })],
      { bom: false },
    );
    expect(csv.split('\r\n')[1]).toBe("'=SUM(A1);-20.10;sí;2026-01-31");
    for (const peligroso of ['+1', '-1', '@x']) {
      expect(
        toCsv(columnas, [fila({ nombre: peligroso })], { bom: false }),
      ).toContain(`'${peligroso}`);
    }
  });

  it('el importe no pasa por float: texto exacto de 2 decimales', () => {
    const csv = toCsv(
      columnas,
      [fila({ importe: '0.1' }), fila({ importe: 0.3 })],
      {
        bom: false,
      },
    );
    expect(csv).toContain(';0.10;');
    expect(csv).toContain(';0.30;');
  });
});

describe('toExportJson', () => {
  it('devuelve un array de objetos con importes como number y null conservado', () => {
    const json = toExportJson(columnas, [
      fila({ importe: '10.5' }),
      fila({ nombre: null, importe: null }),
    ]);
    expect(json).toEqual([
      { nombre: 'Ana', importe: 10.5, activo: true, fecha: '2026-01-31' },
      { nombre: null, importe: null, activo: true, fecha: '2026-01-31' },
    ]);
  });

  it('no neutraliza fórmulas (no es CSV) y es serializable', () => {
    const json = toExportJson(columnas, [fila({ nombre: '=1+1' })]);
    expect(json[0].nombre).toBe('=1+1');
    expect(() => JSON.stringify(json)).not.toThrow();
  });
});
