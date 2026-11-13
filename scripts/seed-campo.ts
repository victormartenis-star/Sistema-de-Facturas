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
 *
 * Credenciales de un admin existente: SEED_EMAIL y SEED_PASSWORD (entorno).
 * Idempotente: cada entidad se busca por su clave natural antes de crearla.
 * Requiere Node >= 22.18 (ejecuta TypeScript directamente) y `build:packages`.
 */
import {
  conPrefijoCampo,
  decidirEjecucionSeedCampo,
  exigirEscritura,
  parsearArgsSeedCampo,
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
  // Borrador: aparece como «sin aprobar» en el KPI de costes.
  fac('C-A-002', PROV_HORMIGON, { borrador: true }, [['A', 2500]], []),
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

async function escribirTodo(modo: ModoSeedCampo, api: string): Promise<void> {
  const email = process.env.SEED_EMAIL;
  const password = process.env.SEED_PASSWORD;
  if (!email || !password) {
    throw new Error('Define SEED_EMAIL y SEED_PASSWORD (admin existente).');
  }
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
        for (const docType of ['plan_seguridad', 'seguro_rc']) {
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
    imprimirPlan();
    console.log(
      '\nSimulación terminada. Añade --api <url> --confirmar para escribir.',
    );
    return;
  }
  console.log(`API destino: ${decision.api}`);
  await escribirTodo('escribir', decision.api);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
