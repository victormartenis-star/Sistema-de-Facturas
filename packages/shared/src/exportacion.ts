import { z } from 'zod';
import { centsToNumeric, fromCents, toCents } from './dinero';

/**
 * Serializador puro de exportaciones (CSV y JSON). Sin base de datos ni reloj:
 * el servicio de `apps/api/src/exports` le pasa las filas ya leídas.
 *
 * - CSV: RFC 4180, UTF-8 con BOM (Excel en español lo abre bien), separador
 *   `;` por defecto, CRLF, una fila de cabecera, vacío para `null`.
 * - Los importes se formatean desde el texto del `numeric` de Postgres con
 *   aritmética entera (`dinero.ts`): nunca pasan por coma flotante.
 * - JSON: array de objetos con la `key` de cada columna; importes como number.
 */

export type ExportColumnType =
  'texto' | 'importe' | 'numero' | 'fecha' | 'booleano';

export interface ExportColumn<T> {
  key: string;
  header: string;
  type: ExportColumnType;
  value: (row: T) => string | number | boolean | null | undefined;
}

export interface CsvOptions {
  separador?: ';' | ',';
  decimal?: 'punto' | 'coma';
  bom?: boolean;
}

export type ExportJsonRow = Record<string, string | number | boolean | null>;

/** Prefijos que Excel interpreta como fórmula (inyección CSV). */
const PREFIJOS_FORMULA = ['=', '+', '-', '@', '\t', '\r'];

function neutralizarFormula(texto: string): string {
  return texto.length > 0 && PREFIJOS_FORMULA.includes(texto[0])
    ? `'${texto}`
    : texto;
}

function celdaCsv(
  tipo: ExportColumnType,
  valor: string | number | boolean | null | undefined,
  decimal: 'punto' | 'coma',
): string {
  if (valor === null || valor === undefined || valor === '') return '';
  switch (tipo) {
    case 'importe': {
      const texto = centsToNumeric(toCents(valor as string | number));
      return decimal === 'coma' ? texto.replace('.', ',') : texto;
    }
    case 'numero': {
      const texto = String(valor);
      return decimal === 'coma' ? texto.replace('.', ',') : texto;
    }
    case 'booleano':
      return valor ? 'sí' : 'no';
    case 'fecha':
      return String(valor);
    case 'texto':
      return neutralizarFormula(String(valor));
  }
}

function escaparCampo(campo: string, separador: string): string {
  return campo.includes(separador) || /["\r\n]/.test(campo)
    ? `"${campo.replace(/"/g, '""')}"`
    : campo;
}

export function toCsv<T>(
  columns: ExportColumn<T>[],
  rows: T[],
  options: CsvOptions = {},
): string {
  const separador = options.separador ?? ';';
  const decimal = options.decimal ?? 'punto';
  const bom = options.bom ?? true;

  const lineas = [
    columns.map((c) => escaparCampo(c.header, separador)).join(separador),
    ...rows.map((row) =>
      columns
        .map((c) =>
          escaparCampo(celdaCsv(c.type, c.value(row), decimal), separador),
        )
        .join(separador),
    ),
  ];
  return (bom ? '﻿' : '') + lineas.join('\r\n') + '\r\n';
}

export function toExportJson<T>(
  columns: ExportColumn<T>[],
  rows: T[],
): ExportJsonRow[] {
  return rows.map((row) => {
    const obj: ExportJsonRow = {};
    for (const c of columns) {
      const v = c.value(row);
      if (v === null || v === undefined || v === '') {
        obj[c.key] = null;
      } else if (c.type === 'importe') {
        obj[c.key] = fromCents(toCents(v as string | number));
      } else if (c.type === 'numero') {
        obj[c.key] = Number(v);
      } else if (c.type === 'booleano') {
        obj[c.key] = Boolean(v);
      } else {
        obj[c.key] = String(v);
      }
    }
    return obj;
  });
}

/* ───────────────────────── contrato de la API ───────────────────────── */

export const EXPORT_RECURSOS = [
  'obras',
  'presupuesto-partidas',
  'albaranes',
  'facturas',
  'facturas-lineas',
  'certificaciones',
  'partes-personal',
  'partes-maquinaria',
  'vencimientos',
  'economia-desviaciones',
  'economia-resumen',
  'economia-iva',
] as const;
export type ExportRecurso = (typeof EXPORT_RECURSOS)[number];

/** Recursos de visión de empresa: no los puede exportar el rol `obra`. */
export const EXPORT_RECURSOS_EMPRESA: readonly ExportRecurso[] = [
  'economia-resumen',
  'economia-iva',
];

/** Tope de filas por exportación (sin paginación ni streaming en esta fase). */
export const EXPORT_MAX_FILAS = 50_000;

const fechaIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha no válida (AAAA-MM-DD)');

export const exportQuerySchema = z.object({
  format: z.enum(['csv', 'json']).default('csv'),
  projectId: z.string().uuid().optional(),
  budgetId: z.string().uuid().optional(),
  from: fechaIso.optional(),
  to: fechaIso.optional(),
  /** Trimestre de IVA AAAA-T1..AAAA-T4 (economia-iva); deriva from/to. */
  periodo: z.string().trim().min(1).max(20).optional(),
  status: z.string().trim().min(1).max(30).optional(),
  kind: z.enum(['compra', 'venta']).optional(),
  sep: z.enum([';', ',']).default(';'),
  decimal: z.enum(['punto', 'coma']).default('punto'),
});
export type ExportQuery = z.infer<typeof exportQuerySchema>;
