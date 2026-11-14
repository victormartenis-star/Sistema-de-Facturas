#!/usr/bin/env node
/**
 * Seed de datos para pruebas de campo (prefijo `CAMPO-`).
 *
 * Habla SOLO por la API HTTP (como `apps/e2e/seed.ts` y el servidor MCP): los
 * datos nacen con el cálculo real (IVA, retención, vencimientos, 3-way match).
 *
 * Por defecto SOLO SIMULA: imprime lo que crearía y no hace ninguna petición.
 * Escribe únicamente con `--confirmar`. Siempre exige `--bd erp_dev` y que
 * coincida con el nombre de la base de `DATABASE_URL`; si no, aborta. La API
 * debería apuntar a esa misma base (el script no puede comprobarlo).
 *
 *   npm run seed:campo -- --bd erp_dev                       (simulación)
 *   npm run seed:campo -- --bd erp_dev --api http://localhost:3001 --confirmar
 *   npm run seed:campo -- --bd erp_dev --limpiar              (lista qué borraría)
 *   npm run seed:campo -- --bd erp_dev --limpiar --api http://localhost:3001 --confirmar
 *
 * Credenciales de un admin existente: SEED_EMAIL y SEED_PASSWORD (entorno).
 * Además crea 3 usuarios de prueba (campo-*@erp.test: un lector y dos perfiles
 * de obra) con contraseñas aleatorias; sus credenciales se guardan SOLO en el
 * fichero de SEED_CAMPO_CREDENCIALES (obligatoria al escribir; fuera del repo).
 * No se reejecuta sobre datos previos: si ya existe la obra CAMPO-A aborta y
 * pide `--limpiar`. Dentro de una ejecución, cada entidad se busca por clave natural.
 *
 * `--limpiar` borra de la base (conexión DATABASE_URL, en una transacción: todo
 * o nada) SOLO filas con identificador `CAMPO-` y los usuarios campo-*@erp.test;
 * si una fila que no es de campo depende de una de campo, aborta sin borrar.
 * También borra de `audit_log` (sin FK a las entidades) SOLO las filas cuyo
 * `entity_id` es el id de una fila CAMPO- ya leída y cuyo `company_id` es el de
 * las empresas de esas filas (projects/contacts/users CAMPO-): una fila con
 * `entity_id` de campo pero otra empresa no se toca. Se borra antes que las
 * entidades, en la misma transacción, y el recuento se verifica como el resto.
 * Sin `--confirmar` solo cuenta por tabla lo que borraría (transacción de solo
 * lectura). Con `--confirmar`, el orden es: validar entorno, API y login ->
 * limpiar -> sembrar, todo en la misma invocación (así no se borra sin poder
 * volver a sembrar). Es la única parte del script que habla con Postgres.
 * Requiere Node >= 22.18 (ejecuta TypeScript directamente) y `build:packages`.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { Client } from 'pg';
import {
  BLOCKING_COMPLIANCE_DOC_TYPES,
  ORDEN_BORRADO_CAMPO,
  columnasIdentificador,
  condicionSqlCampo,
  exigirSoloFilasCampo,
  exigirSoloAuditoriaCampo,
  idsAuditoriaCampo,
  TABLA_AUDITORIA_CAMPO,
  motivoAbortoPorDependientes,
  resumenLimpieza,
  validarOrdenBorrado,
  type BloqueoLimpiezaCampo,
  PERFILES_USUARIO_CAMPO,
  conPrefijoCampo,
  decidirEjecucionSeedCampo,
  exigirEscritura,
  generarPasswordCampo,
  motivoAbortoPorExistentes,
  parsearArgsSeedCampo,
  validarAsignacionesCampo,
  type ModoSeedCampo,
} from '@erp/shared';

// ─── Datos (importes redondos para comprobar a ojo el dashboard) ────────────

const P = conPrefijoCampo;

interface Prov {
  legalName: string;
  taxId: string;
}
const CLIENTE: Prov = { legalName: P('Promotora SL'), taxId: 'B99900001' };
const PROV_HORMIGON: Prov = {
  legalName: P('Hormigones SL'),
  taxId: 'B99900002',
};
const PROV_ESTRUCT: Prov = {
  legalName: P('Estructuras SL'),
  taxId: 'B99900003',
};

const OBRAS = [
  { code: P('A'), name: P('Obra A'), contractAmount: 500000, retentionPct: 5 },
  { code: P('B'), name: P('Obra B'), contractAmount: 200000, retentionPct: 5 },
];

/** Partidas (`capítulo.partida`). A tiene presupuesto activo; B solo importes en partida. */
const PARTIDAS: Record<
  string,
  { code: string; name: string; importe: number }[]
> = {
  [P('A')]: [
    { code: P('01.01'), name: 'Cimentación', importe: 200000 },
    { code: P('01.02'), name: 'Estructura', importe: 150000 },
    { code: P('02.01'), name: 'Cerramientos', importe: 50000 },
  ],
  [P('B')]: [
    { code: P('01.01'), name: 'Cimentación', importe: 100000 },
    { code: P('01.02'), name: 'Estructura', importe: 50000 },
    { code: P('02.01'), name: 'Cerramientos', importe: 20000 },
  ],
};

/** `dias`: retención liberable relativa a hoy (vencida / próxima / lejana). */
const CERTIFICACIONES = [
  { obra: P('A'), pct: 20, factura: P('F-A-001'), facturar: true, dias: -30 },
  { obra: P('A'), pct: 45, factura: P('F-A-002'), facturar: true, dias: 30 },
  { obra: P('A'), pct: 60, factura: P('F-A-003'), facturar: false, dias: 0 },
  { obra: P('B'), pct: 30, factura: P('F-B-001'), facturar: true, dias: 400 },
];

interface Pedido {
  clave: string;
  obra: string;
  prov: Prov;
  importe: number;
}
interface Albaran {
  numero: string;
  pedido: string | null;
  obra: string;
  prov: Prov;
  importe: number;
  validar: boolean;
}
interface FacturaCompra {
  numero: string;
  prov: Prov;
  isp: boolean;
  retentionPct: number;
  dias: number | null;
  borrador: boolean;
  lineas: { obra: string; base: number }[];
  albaranes: string[];
}

const PEDIDOS: Pedido[] = [
  { clave: P('PED-A1'), obra: P('A'), prov: PROV_HORMIGON, importe: 30000 },
  { clave: P('PED-A2'), obra: P('A'), prov: PROV_HORMIGON, importe: 5000 },
  { clave: P('PED-B1'), obra: P('B'), prov: PROV_HORMIGON, importe: 20000 },
  { clave: P('PED-X1'), obra: P('A'), prov: PROV_ESTRUCT, importe: 6000 },
  { clave: P('PED-X2'), obra: P('B'), prov: PROV_ESTRUCT, importe: 4000 },
  { clave: P('PED-X3'), obra: P('A'), prov: PROV_ESTRUCT, importe: 3000 },
  { clave: P('PED-X4'), obra: P('B'), prov: PROV_ESTRUCT, importe: 1000 },
  { clave: P('PED-X5'), obra: P('A'), prov: PROV_ESTRUCT, importe: 2000 },
  { clave: P('PED-X6'), obra: P('B'), prov: PROV_ESTRUCT, importe: 1500 },
];

const alb = (
  n: string,
  pedido: string | null,
  obra: string,
  prov: Prov,
  importe: number,
  validar: boolean,
): Albaran => ({ numero: P(n), pedido, obra: P(obra), prov, importe, validar });

const ALBARANES: Albaran[] = [
  alb('ALB-001', P('PED-A1'), 'A', PROV_HORMIGON, 12000, true),
  alb('ALB-002', P('PED-A1'), 'A', PROV_HORMIGON, 8000, true),
  alb('ALB-003', P('PED-A1'), 'A', PROV_HORMIGON, 10000, false),
  alb('ALB-004', null, 'A', PROV_HORMIGON, 1500, false),
  alb('ALB-005', P('PED-B1'), 'B', PROV_HORMIGON, 20000, true),
  alb('ALB-006', P('PED-X1'), 'A', PROV_ESTRUCT, 6000, true),
  alb('ALB-007', P('PED-X2'), 'B', PROV_ESTRUCT, 4000, true),
  alb('ALB-008', P('PED-X3'), 'A', PROV_ESTRUCT, 3000, true),
  alb('ALB-009', P('PED-X4'), 'B', PROV_ESTRUCT, 1000, true),
  // Cruzados A/B: un mismo proveedor sirve a las dos obras y factura junto.
  alb('ALB-010', P('PED-X5'), 'A', PROV_ESTRUCT, 2000, true),
  alb('ALB-011', P('PED-X6'), 'B', PROV_ESTRUCT, 1500, true),
];

const fac = (
  n: string,
  prov: Prov,
  opts: Partial<FacturaCompra>,
  lineas: [string, number][],
  albaranes: string[],
): FacturaCompra => ({
  numero: P(n),
  prov,
  isp: false,
  retentionPct: 0,
  dias: null,
  borrador: false,
  ...opts,
  lineas: lineas.map(([obra, base]) => ({ obra: P(obra), base })),
  albaranes: albaranes.map((a) => P(a)),
});

const FACTURAS_COMPRA: FacturaCompra[] = [
  fac('C-A-001', PROV_HORMIGON, {}, [['A', 12000]], ['ALB-001']),
  fac('C-B-001', PROV_HORMIGON, {}, [['B', 20000]], ['ALB-005']),
  // Cruzada A/B con retención de cabecera (prorrateo de retención e IVA).
  fac(
    'C-X-001',
    PROV_ESTRUCT,
    { retentionPct: 5, dias: 60 },
    [
      ['A', 6000],
      ['B', 4000],
    ],
    ['ALB-006', 'ALB-007'],
  ),
  // Cruzada con inversión del sujeto pasivo.
  fac(
    'C-X-002',
    PROV_ESTRUCT,
    { isp: true },
    [
      ['A', 3000],
      ['B', 1000],
    ],
    ['ALB-008', 'ALB-009'],
  ),
  // Factura que junta los dos albaranes cruzados ALB-010 (A) y ALB-011 (B).
  fac(
    'C-X-003',
    PROV_ESTRUCT,
    {},
    [
      ['A', 2000],
      ['B', 1500],
    ],
    ['ALB-010', 'ALB-011'],
  ),
  // Borrador: aparece como «sin aprobar» en el KPI de costes.
  fac('C-A-002', PROV_HORMIGON, { borrador: true }, [['A', 2500]], []),
];

/** Rectificativas sobre ventas aprobadas (se dejan en borrador). */
const RECTIFICATIVAS: {
  original: string;
  clase: 'total' | 'diferencias';
  motivo: string;
  obra?: string;
  delta?: number;
}[] = [
  // Total: la API deriva las líneas negadas de la original (aprobarla la marcaría rectificada).
  {
    original: P('F-B-001'),
    clase: 'total',
    motivo: P('Rectificación total de prueba'),
  },
  // Parcial por diferencias: delta negativo de 5000 EUR en la obra A.
  {
    original: P('F-A-002'),
    clase: 'diferencias',
    motivo: P('Rectificación parcial de prueba'),
    obra: P('A'),
    delta: -5000,
  },
];

interface ParteP {
  obra: string;
  partida: string;
  operario: string;
  dias: number;
  ord: number;
  extra: number;
  tarifa: number;
  tarifaExtra: number;
}
interface ParteM {
  obra: string;
  partida: string;
  maquina: string;
  propiedad: 'propia' | 'alquilada';
  dias: number;
  horas: number;
  tarifa: number;
}
const pp = (
  obra: string,
  partida: string,
  operario: string,
  dias: number,
  ord: number,
  extra: number,
  tarifa: number,
): ParteP => ({
  obra: P(obra),
  partida: P(partida),
  operario: P(operario),
  dias,
  ord,
  extra,
  tarifa,
  tarifaExtra: tarifa * 1.5,
});
const PARTES_PERSONAL: ParteP[] = [
  pp('A', '01.01', 'Operario 1', -6, 8, 0, 20),
  pp('A', '01.01', 'Operario 2', -5, 8, 2, 22),
  pp('A', '01.02', 'Operario 3', -4, 8, 1, 25),
  pp('A', '02.01', 'Operario 4', -3, 6, 0, 18),
  pp('B', '01.01', 'Operario 5', -6, 8, 0, 20),
  pp('B', '01.02', 'Operario 6', -5, 8, 2, 22),
  pp('B', '02.01', 'Operario 7', -4, 7, 0, 18),
  pp('B', '01.01', 'Operario 8', -3, 8, 1, 25),
];
const PARTES_MAQUINARIA: ParteM[] = [
  {
    obra: P('A'),
    partida: P('01.01'),
    maquina: P('Excavadora'),
    propiedad: 'propia',
    dias: -6,
    horas: 8,
    tarifa: 60,
  },
  {
    obra: P('A'),
    partida: P('01.02'),
    maquina: P('Grúa torre'),
    propiedad: 'alquilada',
    dias: -4,
    horas: 6,
    tarifa: 45,
  },
  {
    obra: P('B'),
    partida: P('01.01'),
    maquina: P('Retroexcavadora'),
    propiedad: 'alquilada',
    dias: -5,
    horas: 7,
    tarifa: 50,
  },
  {
    obra: P('B'),
    partida: P('01.02'),
    maquina: P('Camión grúa'),
    propiedad: 'propia',
    dias: -3,
    horas: 5,
    tarifa: 40,
  },
];

// ─── Simulación ─────────────────────────────────────────────────────────────

const suma = (xs: { importe: number }[]) =>
  xs.reduce((s, x) => s + x.importe, 0);

function imprimirPlan(): void {
  console.log('Plan (nada se escribe):');
  console.log(
    `  Contactos: ${[CLIENTE, PROV_HORMIGON, PROV_ESTRUCT].map((c) => c.legalName).join(', ')}`,
  );
  for (const o of OBRAS) {
    console.log(
      `  Obra ${o.code}: contrato ${o.contractAmount} EUR, retención ${o.retentionPct} %`,
    );
    for (const p of PARTIDAS[o.code]) {
      console.log(`    partida ${p.code} ${p.name}: ${p.importe} EUR`);
    }
  }
  console.log(
    `  Presupuesto activo ${P('Presupuesto A')} en ${P('A')}: ${suma(PARTIDAS[P('A')])} EUR (margen previsto esperado 100000)`,
  );
  console.log(
    `  ${P('B')}: sin presupuesto activo, partidas ${suma(PARTIDAS[P('B')])} EUR (fallback, previsto 30000)`,
  );
  for (const c of CERTIFICACIONES) {
    console.log(
      `  Certificación ${c.obra} al ${c.pct} %${c.facturar ? ` -> venta ${c.factura} (retención liberable en ${c.dias} días)` : ' (borrador)'}`,
    );
  }
  for (const p of PEDIDOS) {
    console.log(
      `  Pedido ${p.clave} ${p.obra} ${p.prov.legalName}: ${p.importe} EUR`,
    );
  }
  for (const a of ALBARANES) {
    console.log(
      `  Albarán ${a.numero} ${a.obra}: ${a.importe} EUR${a.pedido ? ` (${a.pedido})` : ' sin pedido'}${a.validar ? ' validado' : ' pendiente'}`,
    );
  }
  for (const f of FACTURAS_COMPRA) {
    console.log(
      `  Factura compra ${f.numero}${f.borrador ? ' (borrador)' : ''}${f.isp ? ' ISP' : ''} ret ${f.retentionPct} %: ${f.lineas.map((l) => `${l.obra} ${l.base} EUR`).join(' + ')}`,
    );
  }
  for (const r of RECTIFICATIVAS) {
    console.log(
      `  Rectificativa ${r.clase} de ${r.original} (borrador)${r.delta !== undefined ? `: ${r.delta} EUR en ${r.obra}` : ': líneas negadas de la original'}`,
    );
  }
  for (const o of OBRAS) {
    const n = PARTES_PERSONAL.filter((x) => x.obra === o.code).length;
    const m = PARTES_MAQUINARIA.filter((x) => x.obra === o.code).length;
    console.log(`  Partes en ${o.code}: ${n} de personal, ${m} de maquinaria`);
  }
  console.log(
    '  Albaranes cruzados A/B: ALB-010 (A) + ALB-011 (B) en la factura C-X-003',
  );
  for (const u of PERFILES_USUARIO_CAMPO) {
    console.log(
      `  Usuario ${u.email} rol ${u.role}${u.obras.length ? ` obras ${u.obras.join(', ')}` : ''} (contraseña aleatoria, solo al fichero de credenciales)`,
    );
  }
}

// ─── Limpieza (--limpiar) ───────────────────────────────────────────────────

/**
 * Lista (y con 'escribir' borra) las filas de campo. Todo en una transacción:
 * en 'simular' es de solo lectura y termina en ROLLBACK. Aborta sin borrar si
 * alguna fila que no es de campo depende de una de campo.
 */
async function limpiarCampo(modo: ModoSeedCampo): Promise<void> {
  const errOrden = validarOrdenBorrado();
  if (errOrden.length > 0) throw new Error(errOrden.join('; '));
  const cliente = new Client({ connectionString: process.env.DATABASE_URL });
  await cliente.connect();
  try {
    await cliente.query(
      modo === 'escribir' ? 'BEGIN' : 'BEGIN TRANSACTION READ ONLY',
    );
    const conteos: Record<string, number> = {};
    const ids: Record<string, string[] | null> = {};
    for (const t of ORDEN_BORRADO_CAMPO) {
      const cond = condicionSqlCampo(t.tabla);
      const cols = columnasIdentificador(t);
      if (cols.length > 0) {
        const res = await cliente.query(
          `SELECT id, ${cols.join(', ')} FROM ${t.tabla} WHERE ${cond}`,
        );
        // Defensa en profundidad: la condición SQL y el filtro puro deben coincidir.
        exigirSoloFilasCampo(t, res.rows);
        ids[t.tabla] = res.rows.map((r) => String(r.id));
        conteos[t.tabla] = res.rowCount ?? 0;
      } else {
        const res = await cliente.query(
          `SELECT count(*)::int AS n FROM ${t.tabla} WHERE ${cond}`,
        );
        ids[t.tabla] = null;
        conteos[t.tabla] = res.rows[0].n as number;
      }
    }

    // Auditoría: ids exactos de las filas CAMPO- (también las de tablas hijas
    // con columna id) y empresas de las raíces CAMPO-; sin condiciones amplias.
    const conId = await cliente.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND column_name = 'id'
          AND data_type = 'uuid' AND table_name = ANY($1)`,
      [ORDEN_BORRADO_CAMPO.map((t) => t.tabla)],
    );
    const idsAudit: Record<string, string[] | null> = { ...ids };
    for (const { table_name } of conId.rows) {
      if (idsAudit[table_name] != null) continue;
      const r = await cliente.query(
        `SELECT id FROM ${table_name} WHERE ${condicionSqlCampo(table_name)}`,
      );
      idsAudit[table_name] = r.rows.map((x) => String(x.id));
    }
    const idsEntidad = idsAuditoriaCampo(idsAudit);
    const empresas = new Set<string>();
    for (const raiz of ['projects', 'contacts', 'users']) {
      const r = await cliente.query(
        `SELECT DISTINCT company_id FROM ${raiz} WHERE ${condicionSqlCampo(raiz)}`,
      );
      for (const x of r.rows) empresas.add(String(x.company_id));
    }
    const idsEmpresa = [...empresas];
    const auditoria =
      idsEntidad.length === 0 || idsEmpresa.length === 0
        ? []
        : (
            await cliente.query<{ entity_id: string; company_id: string }>(
              `SELECT entity_id, company_id FROM ${TABLA_AUDITORIA_CAMPO}
                WHERE entity_id = ANY($1::uuid[]) AND company_id = ANY($2::uuid[])`,
              [idsEntidad, idsEmpresa],
            )
          ).rows;
    exigirSoloAuditoriaCampo(auditoria, idsEntidad, idsEmpresa);
    conteos[TABLA_AUDITORIA_CAMPO] = auditoria.length;

    // Filas ajenas que dependen de filas de campo (cualquier tabla de la BD).
    const nombres = ORDEN_BORRADO_CAMPO.map((t) => t.tabla);
    const fks = await cliente.query<{
      hijo: string;
      columna: string;
      padre: string;
      tipo: string;
      n_cols: number;
      col_padre: string;
    }>(
      `SELECT c.conrelid::regclass::text AS hijo, a.attname AS columna,
              c.confrelid::regclass::text AS padre, c.confdeltype AS tipo,
              array_length(c.conkey, 1) AS n_cols, ap.attname AS col_padre
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
         JOIN pg_attribute ap ON ap.attrelid = c.confrelid AND ap.attnum = c.confkey[1]
        WHERE c.contype = 'f' AND c.confrelid::regclass::text = ANY($1)`,
      [nombres],
    );
    const bloqueos: BloqueoLimpiezaCampo[] = [];
    for (const fk of fks.rows) {
      if (fk.n_cols !== 1 || fk.col_padre !== 'id') {
        throw new Error(
          `FK no soportada por la limpieza: ${fk.hijo}.${fk.columna} -> ${fk.padre}.${fk.col_padre}.`,
        );
      }
      const condPadre = condicionSqlCampo(fk.padre);
      const enLista = nombres.includes(fk.hijo);
      const propias = enLista ? ` AND NOT ${condicionSqlCampo(fk.hijo)}` : '';
      const res = await cliente.query(
        `SELECT count(*)::int AS n FROM ${fk.hijo}
          WHERE ${fk.columna} IN (SELECT id FROM ${fk.padre} WHERE ${condPadre})${propias}`,
      );
      const n = res.rows[0].n as number;
      if (n === 0) continue;
      if (fk.tipo === 'n' || fk.tipo === 'd') {
        // SET NULL / SET DEFAULT: la fila ajena sobrevive (p. ej. audit_log.user_id).
        console.log(
          `aviso: ${fk.hijo}.${fk.columna} de ${n} fila(s) ajena(s) quedará sin referencia.`,
        );
      } else {
        bloqueos.push({
          tablaDependiente: fk.hijo,
          columna: fk.columna,
          tablaReferenciada: fk.padre,
          filas: n,
        });
      }
    }
    const aborto = motivoAbortoPorDependientes(bloqueos);
    if (aborto) throw new Error(aborto);

    const lineas = resumenLimpieza(conteos);
    console.log(
      lineas.length === 0
        ? 'Limpieza: no hay datos de campo que borrar.'
        : `Limpieza (${modo === 'escribir' ? 'se borra, hijos antes que padres' : 'simulación, nada se borra'}):`,
    );
    for (const l of lineas) console.log(`  ${l}`);

    if (modo === 'escribir') {
      // Primero la auditoría (orden seguro: antes de borrar las entidades).
      if (conteos[TABLA_AUDITORIA_CAMPO] > 0) {
        const res = await cliente.query(
          `DELETE FROM ${TABLA_AUDITORIA_CAMPO}
            WHERE entity_id = ANY($1::uuid[]) AND company_id = ANY($2::uuid[])`,
          [idsEntidad, idsEmpresa],
        );
        if (res.rowCount !== conteos[TABLA_AUDITORIA_CAMPO]) {
          throw new Error(
            `${TABLA_AUDITORIA_CAMPO}: se esperaban ${conteos[TABLA_AUDITORIA_CAMPO]} borrados y fueron ${res.rowCount}.`,
          );
        }
      }
      for (const t of ORDEN_BORRADO_CAMPO) {
        if ((conteos[t.tabla] ?? 0) === 0) continue;
        const porIds = ids[t.tabla];
        const res = porIds
          ? await cliente.query(
              `DELETE FROM ${t.tabla} WHERE id = ANY($1::uuid[])`,
              [porIds],
            )
          : await cliente.query(
              `DELETE FROM ${t.tabla} WHERE ${condicionSqlCampo(t.tabla)}`,
            );
        if (res.rowCount !== conteos[t.tabla]) {
          throw new Error(
            `${t.tabla}: se esperaban ${conteos[t.tabla]} borrados y fueron ${res.rowCount}.`,
          );
        }
      }
      await cliente.query('COMMIT');
      console.log('Limpieza confirmada (transacción cerrada).');
    } else {
      await cliente.query('ROLLBACK');
    }
  } catch (err) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await cliente.end();
  }
}

// ─── Escritura (solo con --confirmar) ───────────────────────────────────────

interface Fila {
  id: string;
}

function fechaDesdeHoy(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

async function escribirTodo(
  modo: ModoSeedCampo,
  api: string,
  limpiar: boolean,
): Promise<void> {
  const email = process.env.SEED_EMAIL;
  const password = process.env.SEED_PASSWORD;
  if (!email || !password) {
    throw new Error('Define SEED_EMAIL y SEED_PASSWORD (admin existente).');
  }
  const rutaCreds = process.env.SEED_CAMPO_CREDENCIALES;
  if (!rutaCreds) {
    throw new Error(
      'Define SEED_CAMPO_CREDENCIALES (fichero de credenciales fuera del repo).',
    );
  }
  const rel = relative(process.cwd(), resolve(rutaCreds));
  if (!rel.startsWith('..') && !isAbsolute(rel)) {
    throw new Error('SEED_CAMPO_CREDENCIALES no puede estar dentro del repo.');
  }
  const erroresPerfiles = validarAsignacionesCampo(PERFILES_USUARIO_CAMPO);
  if (erroresPerfiles.length > 0) throw new Error(erroresPerfiles.join('; '));
  let token = '';

  async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
    if (init?.method && init.method !== 'GET') exigirEscritura(modo);
    const res = await fetch(`${api}${ruta}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (res.status === 204) return undefined as T;
    const cuerpo: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(
        `${init?.method ?? 'GET'} ${ruta} -> ${res.status}: ${JSON.stringify(cuerpo)}`,
      );
    }
    return cuerpo as T;
  }
  const enviar = <T>(metodo: string, ruta: string, cuerpo?: unknown) =>
    pedir<T>(ruta, {
      method: metodo,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });

  await pedir('/health');
  // El login es un POST, pero no escribe datos de negocio.
  const sesion = await fetch(`${api}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!sesion.ok) throw new Error(`Login fallido (${sesion.status}).`);
  token = ((await sesion.json()) as { accessToken: string }).accessToken;

  // Solo tras validar entorno, API y login: borrar y sembrar van juntos.
  if (limpiar) await limpiarCampo(modo);

  // Idempotencia: si ya hay datos de campo, no se reejecuta.
  const previas = await pedir<{ code: string }[]>('/projects');
  const aborto = motivoAbortoPorExistentes(previas.map((x) => x.code));
  if (aborto) throw new Error(aborto);

  async function asegurar<T extends Fila>(
    listar: () => Promise<T[]>,
    existe: (x: T) => boolean,
    crear: () => Promise<T>,
    etiqueta: string,
  ): Promise<T> {
    const hallado = (await listar()).find(existe);
    if (hallado) return hallado;
    const nuevo = await crear();
    console.log(`creado: ${etiqueta}`);
    return nuevo;
  }

  // Contactos (proveedores con documentación al día, o la compra no se aprueba).
  const contactos: Record<string, Fila> = {};
  const listaContactos: [string, Prov][] = [
    ['cliente', CLIENTE],
    ['proveedor', PROV_HORMIGON],
    ['proveedor', PROV_ESTRUCT],
  ];
  for (const [kind, c] of listaContactos) {
    const fila = await asegurar(
      () => pedir<(Fila & { taxId: string | null })[]>('/contacts'),
      (x) => x.taxId === c.taxId,
      () =>
        enviar<Fila & { taxId: string | null }>('POST', '/contacts', {
          kind,
          legalName: c.legalName,
          taxId: c.taxId,
          paymentTermsDays: 30,
        }),
      c.legalName,
    );
    contactos[c.taxId] = fila;
    if (kind === 'proveedor') {
      const resumen = await pedir<{ docs: unknown[] }>(
        `/contacts/${fila.id}/cumplimiento`,
      );
      if (resumen.docs.length === 0) {
        await enviar('POST', `/contacts/${fila.id}/cumplimiento/exigir`, {
          required: true,
        });
        for (const docType of BLOCKING_COMPLIANCE_DOC_TYPES) {
          await enviar('POST', `/contacts/${fila.id}/cumplimiento/documentos`, {
            docType,
            issuedAt: fechaDesdeHoy(-300),
            expiresAt: fechaDesdeHoy(300),
          });
        }
      }
    }
  }

  // Obras y partidas.
  const obras: Record<string, Fila> = {};
  const partidas: Record<string, Fila> = {};
  for (const o of OBRAS) {
    obras[o.code] = await asegurar(
      () => pedir<(Fila & { code: string })[]>('/projects'),
      (x) => x.code === o.code,
      () =>
        enviar<Fila & { code: string }>('POST', '/projects', {
          ...o,
          status: 'en_curso',
          startDate: fechaDesdeHoy(-120),
          expectedEnd: fechaDesdeHoy(240),
        }),
      o.code,
    );
    for (const p of PARTIDAS[o.code]) {
      partidas[`${o.code}|${p.code}`] = await asegurar(
        () =>
          pedir<(Fila & { code: string })[]>(
            `/projects/${obras[o.code].id}/phases`,
          ),
        (x) => x.code === p.code,
        () =>
          enviar<Fila & { code: string }>(
            'POST',
            `/projects/${obras[o.code].id}/phases`,
            {
              code: p.code,
              name: p.name,
              budgetAmount: p.importe,
              plannedStartDate: fechaDesdeHoy(-100),
              plannedEndDate: fechaDesdeHoy(200),
            },
          ),
        `${o.code} ${p.code}`,
      );
    }
  }

  // Presupuesto activo en A (coste previsto = suma de partidas).
  const nombrePres = P('Presupuesto A');
  await asegurar(
    () =>
      pedir<(Fila & { name: string })[]>(
        `/projects/${obras[P('A')].id}/budgets`,
      ),
    (x) => x.name === nombrePres,
    async () => {
      const b = await enviar<Fila & { name: string }>(
        'POST',
        `/projects/${obras[P('A')].id}/budgets`,
        { name: nombrePres },
      );
      for (const [i, p] of PARTIDAS[P('A')].entries()) {
        await enviar('POST', `/budgets/${b.id}/items`, {
          code: p.code,
          name: p.name,
          unit: 'ud',
          unitPrice: p.importe,
          quantity: 1,
          phaseId: partidas[`${P('A')}|${p.code}`].id,
          sortOrder: i,
        });
      }
      await enviar('PATCH', `/budgets/${b.id}`, { status: 'activo' });
      return b;
    },
    nombrePres,
  );

  // Certificaciones (y venta con retención las facturadas).
  for (const c of CERTIFICACIONES) {
    const lista = await pedir<
      (Fila & { cumulativePct: number; invoiceId: string | null })[]
    >(`/certifications?projectId=${obras[c.obra].id}`);
    let cert = lista.find((x) => x.cumulativePct === c.pct);
    if (!cert) {
      cert = await enviar<
        Fila & { cumulativePct: number; invoiceId: string | null }
      >('POST', '/certifications', {
        projectId: obras[c.obra].id,
        certDate: fechaDesdeHoy(-20),
        cumulativePct: c.pct,
        notes: P('certificación'),
      });
      console.log(`creada: certificación ${c.obra} al ${c.pct} %`);
    }
    if (c.facturar && !cert.invoiceId) {
      await enviar('POST', `/certifications/${cert.id}/facturar`, {
        contactId: contactos[CLIENTE.taxId].id,
        invoiceNumber: c.factura,
        issueDate: fechaDesdeHoy(-10),
        isp: false,
        retentionReleaseDate: fechaDesdeHoy(c.dias),
      });
      console.log(`creada y aprobada: venta ${c.factura}`);
    }
  }

  // Pedidos y albaranes.
  const pedidos: Record<string, Fila> = {};
  for (const p of PEDIDOS) {
    pedidos[p.clave] = await asegurar(
      () =>
        pedir<(Fila & { description: string })[]>(
          `/purchase-orders?projectId=${obras[p.obra].id}`,
        ),
      (x) => x.description === p.clave,
      () =>
        enviar<Fila & { description: string }>('POST', '/purchase-orders', {
          projectId: obras[p.obra].id,
          contactId: contactos[p.prov.taxId].id,
          orderDate: fechaDesdeHoy(-60),
          description: p.clave,
          amount: p.importe,
        }),
      p.clave,
    );
  }
  const albaranes: Record<string, Fila> = {};
  type Nota = Fila & { noteNumber: string; status?: string };
  for (const a of ALBARANES) {
    const nota = await asegurar<Nota>(
      () => pedir<Nota[]>('/delivery-notes'),
      (x) => x.noteNumber === a.numero,
      () =>
        enviar<Nota>('POST', '/delivery-notes', {
          contactId: contactos[a.prov.taxId].id,
          projectId: obras[a.obra].id,
          orderId: a.pedido ? pedidos[a.pedido].id : null,
          noteNumber: a.numero,
          noteDate: fechaDesdeHoy(-40),
          amount: a.importe,
        }),
      a.numero,
    );
    albaranes[a.numero] = nota;
    if (
      a.validar &&
      nota.status !== 'validado' &&
      nota.status !== 'facturado'
    ) {
      await enviar('POST', `/delivery-notes/${nota.id}/validar`);
    }
  }

  // Facturas de compra (aprobadas salvo el borrador).
  for (const f of FACTURAS_COMPRA) {
    const factura = await asegurar(
      () =>
        pedir<(Fila & { invoiceNumber: string; status?: string })[]>(
          '/invoices',
        ),
      (x) => x.invoiceNumber === f.numero,
      () =>
        enviar<Fila & { invoiceNumber: string; status?: string }>(
          'POST',
          '/invoices',
          {
            kind: 'compra',
            contactId: contactos[f.prov.taxId].id,
            invoiceNumber: f.numero,
            issueDate: fechaDesdeHoy(-5),
            isp: f.isp,
            retentionPct: f.retentionPct,
            retentionReleaseDate:
              f.dias === null ? null : fechaDesdeHoy(f.dias),
            lines: f.lineas.map((l) => ({
              description: `${f.numero} ${l.obra}`,
              baseAmount: l.base,
              vatPct: 21,
              projectId: obras[l.obra].id,
            })),
            deliveryNoteIds: f.albaranes.map((n) => albaranes[n].id),
          },
        ),
      f.numero,
    );
    if (
      !f.borrador &&
      (factura.status === undefined || factura.status === 'borrador')
    ) {
      await enviar('POST', `/invoices/${factura.id}/aprobar`);
    }
  }

  // Rectificativas sobre ventas ya aprobadas (la API valida estado y clase).
  type FacturaFila = Fila & { invoiceNumber: string; status: string };
  const todas = await pedir<FacturaFila[]>('/invoices');
  for (const r of RECTIFICATIVAS) {
    const orig = todas.find((x) => x.invoiceNumber === r.original);
    if (!orig) throw new Error(`No existe la factura ${r.original}.`);
    if (orig.status !== 'aprobada') {
      throw new Error(
        `${r.original} debe estar aprobada (está ${orig.status}).`,
      );
    }
    const nueva = await enviar<FacturaFila>(
      'POST',
      `/invoices/${orig.id}/rectificar`,
      {
        clase: r.clase,
        // Dato de prueba: la API exige motivo/tipo coherentes (total ⇔ S, diferencias ⇔ I).
        rectificationMotive: 'R4',
        rectificationType: r.clase === 'total' ? 'S' : 'I',
        issueDate: fechaDesdeHoy(-1),
        motivo: r.motivo,
        ...(r.delta !== undefined && r.obra
          ? {
              lines: [
                {
                  description: `${r.motivo} ${r.obra}`,
                  baseAmount: r.delta,
                  vatPct: 21,
                  projectId: obras[r.obra].id,
                },
              ],
            }
          : {}),
      },
    );
    console.log(
      `creada: rectificativa ${r.clase} ${nueva.invoiceNumber} de ${r.original}`,
    );
  }

  // Partes de trabajo (personal y maquinaria) de A y B.
  for (const x of PARTES_PERSONAL) {
    await enviar('POST', '/partes-diarios/personal', {
      projectId: obras[x.obra].id,
      phaseId: partidas[`${x.obra}|${x.partida}`].id,
      workerName: x.operario,
      workDate: fechaDesdeHoy(x.dias),
      ordinaryHours: x.ord,
      overtimeHours: x.extra,
      ordinaryRate: x.tarifa,
      overtimeRate: x.tarifaExtra,
      notes: P('parte de personal'),
    });
  }
  for (const x of PARTES_MAQUINARIA) {
    await enviar('POST', '/partes-diarios/maquinaria', {
      projectId: obras[x.obra].id,
      phaseId: partidas[`${x.obra}|${x.partida}`].id,
      machineName: x.maquina,
      ownership: x.propiedad,
      workDate: fechaDesdeHoy(x.dias),
      hoursUsed: x.horas,
      hourlyRate: x.tarifa,
      notes: P('parte de maquinaria'),
    });
  }
  console.log(
    `creados: ${PARTES_PERSONAL.length} partes de personal y ${PARTES_MAQUINARIA.length} de maquinaria`,
  );

  // Usuarios de prueba. Las contraseñas solo van al fichero de credenciales.
  const credenciales: { email: string; password: string; role: string }[] = [];
  const guardar = () => {
    mkdirSync(dirname(resolve(rutaCreds)), { recursive: true });
    writeFileSync(resolve(rutaCreds), JSON.stringify(credenciales, null, 2), {
      mode: 0o600,
    });
  };
  for (const u of PERFILES_USUARIO_CAMPO) {
    const password = generarPasswordCampo(randomBytes(32));
    const usuario = await enviar<Fila>('POST', '/users', {
      email: u.email,
      password,
      fullName: u.fullName,
      role: u.role,
    });
    credenciales.push({ email: u.email, password, role: u.role });
    guardar();
    if (u.obras.length > 0) {
      await enviar('PUT', `/users/${usuario.id}/acceso-obras`, {
        projectIds: u.obras.map((o) => obras[o].id),
      });
    }
    console.log(`creado: usuario ${u.email} (${u.role})`);
  }
  console.log(
    'Credenciales guardadas en el fichero de SEED_CAMPO_CREDENCIALES.',
  );

  // Comprobación: el lector no puede mutar.
  const lector = credenciales.find((c) => c.role === 'lector');
  if (lector) {
    const ses = await fetch(`${api}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: lector.email, password: lector.password }),
    });
    const tokenLector = ((await ses.json()) as { accessToken: string })
      .accessToken;
    const intento = await fetch(`${api}/contacts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenLector}`,
      },
      body: JSON.stringify({
        kind: 'cliente',
        legalName: P('no debe crearse'),
      }),
    });
    console.log(`lector POST /contacts -> ${intento.status} (esperado 403)`);
    if (intento.status !== 403)
      throw new Error('El lector no quedó en solo lectura.');
  }
  console.log('Seed de campo: completo.');
}

// ─── Entrada ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const decision = decidirEjecucionSeedCampo({
    args: parsearArgsSeedCampo(process.argv.slice(2)),
    databaseUrl: process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
  });
  if (!decision.ok) {
    console.error(`Abortado: ${decision.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Base de datos: ${decision.bd}. Modo: ${decision.modo}.`);
  if (decision.modo === 'simular') {
    if (decision.limpiar) await limpiarCampo('simular');
    imprimirPlan();
    console.log(
      '\nSimulación terminada. Añade --api <url> --confirmar para escribir.',
    );
    return;
  }
  console.log(`API destino: ${decision.api}`);
  await escribirTodo('escribir', decision.api, decision.limpiar);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
